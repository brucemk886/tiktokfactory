export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("请求体不是有效 JSON。"), { statusCode: 400 });
  }
}

export function parseCookies(value) {
  return Object.fromEntries(String(value || "").split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    const key = index < 0 ? item : item.slice(0, index);
    const raw = index < 0 ? "" : item.slice(index + 1);
    try {
      return [decodeURIComponent(key), decodeURIComponent(raw)];
    } catch {
      return [key, raw];
    }
  }));
}

export function sessionCookie(token, secure) {
  const parts = [
    `lf_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${7 * 24 * 60 * 60}`
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(secure) {
  const parts = ["lf_session=", "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location, "cache-control": "no-store" } });
}

export function safeId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
}

export function now() {
  return Date.now();
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest));
}

export function hex(bytes) {
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return { salt: hex(salt), hash: hex(hash) };
}

export async function verifyPassword(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const salt = fromHex(saltHex);
  const actual = hex(await pbkdf2(password, salt));
  return timingEqual(actual, hashHex);
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return new Uint8Array(bits);
}

function fromHex(value) {
  const text = String(value || "");
  const bytes = new Uint8Array(text.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(text.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function timingEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
