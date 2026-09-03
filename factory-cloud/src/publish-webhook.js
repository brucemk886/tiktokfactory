import { kvGet, kvSet } from "./kv.js";
import { signalDesk } from "./signal-desk.js";
import { applyPublishReceipt, publishReceiptStats, receiptFromWebhookPayload } from "./publish-records-store.js";

export const PUBLISH_WEBHOOK_PATH = "/api/integrations/signal-desk/publish-events";
const WEBHOOK_EVENTS = ["publish.completed", "publish.failed"];
// Signed timestamps older than this are replays.
const MAX_SIGNATURE_SKEW_MS = 10 * 60 * 1000;
const SETTINGS_KEY = "official-settings";

export function factoryPublicBaseUrl(env, requestUrl) {
  const configured = String(env?.FACTORY_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  if (requestUrl) {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  }
  return "";
}

export async function readPublishWebhookState(db, env, now = Date.now()) {
  const settings = await kvGet(db, SETTINGS_KEY, {});
  const stats = await publishReceiptStats(db, now);
  return {
    registered: Boolean(settings.webhookSecret && settings.webhookEndpointId),
    // Same precedence as handlePublishWebhook, surfaced so a 401 can be traced
    // to the right secret without reading code.
    secretSource: settings.webhookSecret ? "settings" : (String(env?.SIGNAL_DESK_WEBHOOK_SECRET || "").trim() ? "env" : "none"),
    url: String(settings.webhookUrl || ""),
    endpointId: String(settings.webhookEndpointId || ""),
    registeredAt: Number(settings.webhookRegisteredAt) || 0,
    lastReceiptAt: Number(settings.webhookLastReceiptAt) || 0,
    receipts: stats,
  };
}

// Registers (or re-registers) this factory as a hub webhook endpoint through
// the hub's machine-key API and keeps the signing secret in settings.
export async function ensurePublishWebhook(env, db, { force = false, verify = false, requestUrl = "" } = {}) {
  const settings = await kvGet(db, SETTINGS_KEY, {});
  const baseUrl = factoryPublicBaseUrl(env, requestUrl);
  if (!baseUrl) return { ok: false, registered: false, reason: "factory-base-url-missing" };
  const url = `${baseUrl}${PUBLISH_WEBHOOK_PATH}`;
  const alreadyCurrent = settings.webhookSecret && settings.webhookEndpointId && settings.webhookUrl === url;
  if (alreadyCurrent && !force) {
    // The hub switches an endpoint off after a long run of failed deliveries
    // (e.g. a factory outage). Local settings would still look current, so the
    // daily check asks the hub whether our endpoint is still active.
    if (!verify || await hubEndpointActive(env, db, settings.webhookEndpointId)) {
      return { ok: true, registered: true, url, endpointId: settings.webhookEndpointId, changed: false };
    }
    console.warn(JSON.stringify({ event: "publish-webhook-endpoint-inactive", endpointId: settings.webhookEndpointId }));
  }
  const result = await signalDesk(env, db, "/api/v1/webhooks", {
    method: "POST",
    body: { name: "tiktok-factory", url, events: WEBHOOK_EVENTS },
  });
  if (!result?.id || !result?.secret) throw Object.assign(new Error("主站没有返回 webhook 密钥。"), { statusCode: 502 });
  const now = Date.now();
  await kvSet(db, SETTINGS_KEY, {
    ...settings,
    webhookUrl: url,
    webhookEndpointId: String(result.id),
    webhookSecret: String(result.secret),
    webhookRegisteredAt: now,
  });
  return { ok: true, registered: true, url, endpointId: String(result.id), changed: true, replaced: Number(result.replaced || 0) };
}

// GET /api/v1/webhooks lists only active endpoints. A hub error is treated as
// "still active" so a transient outage never triggers a needless re-register.
async function hubEndpointActive(env, db, endpointId) {
  try {
    const result = await signalDesk(env, db, "/api/v1/webhooks");
    const endpoints = Array.isArray(result?.endpoints) ? result.endpoints : [];
    return endpoints.some((endpoint) => String(endpoint?.id || "") === String(endpointId));
  } catch (error) {
    console.warn("publish webhook verification skipped", error?.message || error);
    return true;
  }
}

// Failed registration attempts back off this long before the next lazy retry.
const LAZY_REGISTER_RETRY_MS = 60 * 60 * 1000;

// Called from hot worker paths (record uploads). Cheap when already registered;
// otherwise attempts registration at most once per hour so a hub outage never
// makes the worker sync slower or noisier.
export async function ensurePublishWebhookLazily(env, db, { requestUrl = "", now = Date.now() } = {}) {
  const settings = await kvGet(db, SETTINGS_KEY, {});
  if (settings.webhookSecret && settings.webhookEndpointId) return { ok: true, registered: true, changed: false };
  if (now - (Number(settings.webhookLastAttemptAt) || 0) < LAZY_REGISTER_RETRY_MS) {
    return { ok: false, registered: false, reason: "backoff" };
  }
  await kvSet(db, SETTINGS_KEY, { ...settings, webhookLastAttemptAt: now });
  try {
    return await ensurePublishWebhook(env, db, { requestUrl });
  } catch (error) {
    console.warn("publish webhook lazy registration failed", error?.message || error);
    return { ok: false, registered: false, reason: String(error?.message || error) };
  }
}

export async function verifyPublishWebhookSignature(request, rawBody, secret, now = Date.now()) {
  const timestamp = String(request.headers.get("x-signal-timestamp") || "").trim();
  const signature = String(request.headers.get("x-signal-signature") || "").trim();
  if (!secret || !timestamp || !signature.startsWith("v1=")) return false;
  const stampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(stampMs) || Math.abs(now - stampMs) > MAX_SIGNATURE_SKEW_MS) return false;
  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  return constantTimeEqual(signature.slice(3).toLowerCase(), expected);
}

export async function handlePublishWebhook(request, env, db) {
  if (request.method !== "POST") return { status: 405, body: { error: "仅接受 POST。" } };
  const settings = await kvGet(db, SETTINGS_KEY, {});
  const secret = String(settings.webhookSecret || env.SIGNAL_DESK_WEBHOOK_SECRET || "").trim();
  if (!secret) return { status: 503, body: { error: "工厂尚未注册主站回执。" } };
  const rawBody = await request.text();
  if (!await verifyPublishWebhookSignature(request, rawBody, secret)) {
    return { status: 401, body: { error: "回执签名无效。" } };
  }
  let payload = {};
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return { status: 400, body: { error: "回执不是合法 JSON。" } };
  }
  const receipt = receiptFromWebhookPayload(payload);
  if (!receipt) return { status: 200, body: { ok: true, ignored: true, reason: "no-task" } };
  const result = await applyPublishReceipt(db, receipt);
  await kvSet(db, SETTINGS_KEY, { ...settings, webhookLastReceiptAt: receipt.receivedAt });
  return { status: 200, body: { ok: true, ...result, event: receipt.eventType, taskId: receipt.taskId } };
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}
