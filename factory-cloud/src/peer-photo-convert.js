import { errorJson } from './http.js';
import { photoTranscodeCandidates, photoUrlFormatScore } from '../../scripts/psychology-peer-production.js';
import { TIKTOK_USER_AGENT } from './tikhub-video-source.js';
import { validateTikTokPhotoFileUrl } from './tikhub-photo-source.js';

export const KIE_PHOTO_SOURCE_PATH = '/api/integrations/kie-photo-source/';
const MAX_URL_LIFETIME_SECONDS = 2 * 60 * 60;
const MAX_BYTES = 12 * 1024 * 1024;
const KIE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

export function sniffImageFormat(bytes) {
  if (!bytes || bytes.length < 12) return '';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') return '';
  const brands = String.fromCharCode(...bytes.subarray(8, Math.min(bytes.length, 32))).toLowerCase();
  return /(heic|heix|heif|heim|heis|mif1|msf1)/.test(brands) ? 'heic' : '';
}

export async function convertImageBytes(bytes, { heicToJpeg } = {}) {
  const format = sniffImageFormat(bytes);
  if (KIE_FORMATS.has(format)) return { bytes, format, mime: MIME[format], converted: false };
  if (format !== 'heic') throw new Error('原图格式 Gemini 无法识别，且无法转成 JPEG。');
  const jpeg = await (heicToJpeg || defaultHeicToJpeg)(bytes);
  if (sniffImageFormat(jpeg) !== 'jpeg') throw new Error('HEIC 转 JPEG 后文件仍无法识别。');
  return { bytes: jpeg, format: 'jpeg', mime: 'image/jpeg', converted: true };
}

export async function preparePeerPhotosForKie(env, jobId, urls, options = {}) {
  const id = String(jobId || '').trim();
  if (!id || !Array.isArray(urls) || !urls.length) throw new Error('没有可转码的原帖图片。');
  const keys = [];
  try {
    const prepared = [];
    for (let index = 0; index < urls.length; index += 1) {
      const loaded = await loadKiePhoto(env, urls[index], options);
      const key = photoObjectKey(id, index, loaded.format);
      await env.ARCHIVE.put(key, loaded.bytes, {
        httpMetadata: { contentType: loaded.mime },
        customMetadata: { kind: 'psychology-photo-kie-source', jobId: id }
      });
      keys.push(key);
      prepared.push({
        url: await createKiePhotoSourceUrl({
          baseUrl: env.FACTORY_PUBLIC_BASE_URL || 'https://factory.tiktokaitool.com',
          jobId: id,
          index,
          ext: loaded.format === 'jpeg' ? 'jpeg' : loaded.format,
          secret: env.KIE_API_KEY,
          expiresAt: Date.now() + 60 * 60 * 1000
        }),
        key
      });
    }
    return { urls: prepared.map((item) => item.url), keys };
  } catch (error) {
    await deletePeerPhotoSources(env, keys);
    throw error;
  }
}

export async function deletePeerPhotoSources(env, keys = []) {
  for (const key of keys) await env.ARCHIVE.delete(key).catch(() => {});
}

export async function createKiePhotoSourceUrl({ baseUrl, jobId, index, ext, secret, expiresAt }) {
  const id = String(jobId || '').trim();
  const key = String(secret || '').trim();
  const suffix = String(ext || 'jpeg').toLowerCase();
  const expires = Math.floor(Number(expiresAt || 0) / 1000);
  if (!id || !key || !Number.isSafeInteger(index) || index < 0 || !KIE_FORMATS.has(suffix === 'jpg' ? 'jpeg' : suffix) || !Number.isSafeInteger(expires)) {
    throw new Error('无法创建 Gemini 图片读取地址。');
  }
  const format = suffix === 'jpg' ? 'jpeg' : suffix;
  const signature = await hmacHex(key, `${id}.${index}.${format}.${expires}`);
  return `${String(baseUrl || '').replace(/\/$/, '')}${KIE_PHOTO_SOURCE_PATH}${encodeURIComponent(id)}/${index}.${format}?expires=${expires}&signature=${signature}`;
}

export async function handleKiePhotoSource(request, env, url, now = Date.now()) {
  if (!url.pathname.startsWith(KIE_PHOTO_SOURCE_PATH)) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return errorJson('仅支持读取图片。', 405);
  const match = url.pathname.slice(KIE_PHOTO_SOURCE_PATH.length).match(/^([^/]+)\/(\d+)\.(jpeg|jpg|png|webp|gif)$/i);
  if (!match) return errorJson('图片读取地址无效。', 400);
  const jobId = decodeURIComponent(match[1]);
  const index = Number(match[2]);
  const format = match[3].toLowerCase() === 'jpg' ? 'jpeg' : match[3].toLowerCase();
  const expires = Number(url.searchParams.get('expires') || 0);
  const signature = String(url.searchParams.get('signature') || '').toLowerCase();
  const nowSeconds = Math.floor(now / 1000);
  const secret = String(env.KIE_API_KEY || '').trim();
  if (!jobId || !secret || !Number.isSafeInteger(expires) || expires < nowSeconds || expires > nowSeconds + MAX_URL_LIFETIME_SECONDS) {
    return errorJson('图片读取地址无效或已过期。', 401);
  }
  const expected = await hmacHex(secret, `${jobId}.${index}.${format}.${expires}`);
  if (!constantTimeEqual(signature, expected)) return errorJson('图片读取地址签名无效。', 401);
  const key = photoObjectKey(jobId, index, format);
  if (request.method === 'HEAD') {
    const object = await env.ARCHIVE.head(key);
    if (!object) return errorJson('图片已不存在。', 404);
    return new Response(null, { status: 200, headers: photoHeaders(MIME[format], Number(object.size || 0)) });
  }
  const object = await env.ARCHIVE.get(key);
  if (!object) return errorJson('图片已不存在。', 404);
  const body = object.body || object;
  const size = Number(object.size || (body?.byteLength) || 0);
  return new Response(body, { status: 200, headers: photoHeaders(MIME[format], size) });
}

export async function loadKiePhoto(env, sourceUrl, options = {}) {
  const candidates = photoTranscodeCandidates(sourceUrl)
    .slice()
    .sort((left, right) => photoUrlFormatScore(right) - photoUrlFormatScore(left));
  let heicBytes = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const bytes = await fetchPhotoBytes(env, candidate);
      const format = sniffImageFormat(bytes);
      if (KIE_FORMATS.has(format)) return convertImageBytes(bytes, options);
      if (format === 'heic') heicBytes = bytes;
    } catch (error) {
      lastError = error;
    }
  }
  if (heicBytes) return convertImageBytes(heicBytes, options);
  throw lastError || new Error('无法下载原帖图片并转成 Gemini 可识别的格式。');
}

function photoObjectKey(jobId, index, format) {
  return `psychology-photo-story-sources/${jobId}/${index}.${format}`;
}

function photoHeaders(mimeType, size) {
  const headers = new Headers({
    'content-type': String(mimeType || 'application/octet-stream'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff'
  });
  if (size > 0) headers.set('content-length', String(size));
  return headers;
}

async function fetchPhotoBytes(env, initialUrl) {
  let url = validateTikTokPhotoFileUrl(initialUrl);
  const signal = AbortSignal.timeout(60000);
  for (let hop = 0; hop <= 3; hop += 1) {
    let response;
    try {
      response = await (env.fetch || fetch)(url, {
        headers: {
          'user-agent': TIKTOK_USER_AGENT,
          accept: 'image/jpeg,image/jpg,image/png,image/webp,image/gif,image/*;q=0.8,*/*;q=0.5'
        },
        redirect: 'manual',
        signal
      });
    } catch {
      throw new Error('原帖图片下载连接失败或超时。');
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || hop === 3) throw new Error('原帖图片直链重定向异常。');
      url = validateTikTokPhotoFileUrl(new URL(location, url).href);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`原帖图片下载失败：HTTP ${response.status}。`);
    }
    return readBoundedBytes(response, MAX_BYTES);
  }
}

async function readBoundedBytes(response, limit) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) {
    await response.body?.cancel();
    throw new Error('原帖图片超过 12 MB。');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('原帖图片超过 12 MB。');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function defaultHeicToJpeg(bytes) {
  try {
    const decodeHeic = (await import('heic-decode')).default;
    const jpegJs = await import('jpeg-js');
    const encode = jpegJs.encode || jpegJs.default?.encode;
    const decoded = await decodeHeic({ buffer: bytes });
    const encoded = encode({ data: decoded.data, width: decoded.width, height: decoded.height }, 85);
    const jpeg = encoded?.data;
    if (!jpeg) throw new Error('JPEG 编码器没有返回数据');
    return jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  } catch (error) {
    throw new Error(`HEIC 原图转 JPEG 失败：${String(error.message || error).slice(0, 180)}`);
  }
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(out, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}
