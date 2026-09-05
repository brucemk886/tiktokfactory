import { errorJson, json } from "./http.js";
import { applySourcedPublishRecordEvents } from "./publish-records-store.js";
import { ensurePublishWebhookLazily } from "./publish-webhook.js";

export const PUBLISH_RECORD_SYNC_PROTOCOL = 2;
export const PUBLISH_RECORD_SYNC_PAGE_LIMIT = 200;
export const PUBLISH_RECORD_SYNC_MAX_BYTES = 512 * 1024;

export function validatePublishRecordSyncV2(body, { maxEvents = PUBLISH_RECORD_SYNC_PAGE_LIMIT, maxBytes = PUBLISH_RECORD_SYNC_MAX_BYTES } = {}) {
  if (!body || typeof body !== "object") return { ok: false, error: "请求体无效。", status: 400 };
  if (Number(body.protocolVersion) !== PUBLISH_RECORD_SYNC_PROTOCOL) {
    return { ok: false, error: "protocolVersion must be 2.", status: 400 };
  }
  const sourceStoreId = String(body.sourceStoreId || "").trim();
  const workerId = String(body.workerId || "").trim();
  if (!sourceStoreId) return { ok: false, error: "sourceStoreId is required.", status: 400 };
  if (!workerId) return { ok: false, error: "workerId is required.", status: 400 };
  const events = Array.isArray(body.events) ? body.events : null;
  if (!events) return { ok: false, error: "events must be an array.", status: 400 };
  if (events.length > maxEvents) return { ok: false, error: `events exceeds ${maxEvents}.`, status: 400 };
  const afterSeq = Number(body.afterSeq);
  const throughSeq = Number(body.throughSeq);
  if (!Number.isFinite(afterSeq) || afterSeq < 0) return { ok: false, error: "afterSeq is invalid.", status: 400 };
  if (!Number.isFinite(throughSeq) || throughSeq < afterSeq) return { ok: false, error: "throughSeq is invalid.", status: 400 };
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (bytes > maxBytes + 8_192) return { ok: false, error: "sync page exceeds size limit.", status: 413 };
  let previousSeq = afterSeq;
  for (const event of events) {
    const seq = Number(event?.seq);
    if (!Number.isFinite(seq) || seq <= previousSeq) return { ok: false, error: "events must be ordered by increasing seq.", status: 400 };
    if (seq > throughSeq) return { ok: false, error: "event seq exceeds throughSeq.", status: 400 };
    if (!event?.record || typeof event.record !== "object") return { ok: false, error: "event.record is required.", status: 400 };
    previousSeq = seq;
  }
  if (events.length && Number(events[events.length - 1].seq) !== throughSeq) {
    return { ok: false, error: "throughSeq must match the last event seq.", status: 400 };
  }
  if (!events.length && throughSeq !== afterSeq) {
    return { ok: false, error: "empty page throughSeq must equal afterSeq.", status: 400 };
  }
  return { ok: true, sourceStoreId, workerId, afterSeq, throughSeq, events, bytes };
}

export async function handlePublishRecordsSyncV2(env, body, ctx, request) {
  const validated = validatePublishRecordSyncV2(body);
  if (!validated.ok) return errorJson(validated.error, validated.status);
  const result = await applySourcedPublishRecordEvents(env.DB, {
    sourceStoreId: validated.sourceStoreId,
    events: validated.events,
  });
  const registration = ensurePublishWebhookLazily(env, env.DB, { requestUrl: request.url });
  if (ctx?.waitUntil) ctx.waitUntil(registration);
  else await registration;
  return json({
    protocolVersion: PUBLISH_RECORD_SYNC_PROTOCOL,
    sourceStoreId: validated.sourceStoreId,
    ackedThroughSeq: validated.throughSeq,
    acceptedEventCount: validated.events.length,
    applied: result.applied,
    ignored: result.ignored,
  });
}
