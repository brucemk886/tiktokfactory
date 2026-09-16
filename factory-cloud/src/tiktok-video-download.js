import { resolveTikTokVideoSource, validateTikTokPageUrl, validateTikTokVideoFileUrl, TIKTOK_USER_AGENT } from './tikhub-video-source.js';

const MAX_BYTES = 300 * 1024 * 1024;
const PART_BYTES = 8 * 1024 * 1024;

export async function downloadTikTokToR2(env, { url, videoFileUrl, source, r2Key, jobId }) {
  validateTikTokPageUrl(url);
  const resolved = source || await resolveTikTokVideoSource(env, { url, videoFileUrl });
  let lastError;
  // Reuse the same paid resolution for alternative CDN addresses.
  for (const candidate of resolved.urls.slice(0, 3)) {
    try {
      const response = await fetchVideo(env, candidate);
      const stored = await storeVideo(env.ARCHIVE, response, r2Key, jobId);
      return { ...stored, provider: resolved.provider, videoId: resolved.videoId || '', requestId: resolved.requestId || '' };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('TikTok 没有可下载的视频直链。');
}

async function fetchVideo(env, initialUrl) {
  let url = validateTikTokVideoFileUrl(initialUrl);
  const signal = AbortSignal.timeout(120000);
  for (let hop = 0; hop <= 3; hop += 1) {
    let response;
    try {
      response = await (env.fetch || fetch)(url, {
        headers: { 'user-agent': TIKTOK_USER_AGENT, accept: 'video/mp4,application/octet-stream;q=0.9,*/*;q=0.5' },
        redirect: 'manual', signal
      });
    } catch { throw new Error('TikTok 视频下载连接失败或超时。'); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || hop === 3) throw new Error('TikTok 视频直链重定向异常。');
      url = validateTikTokVideoFileUrl(new URL(location, url).href);
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`TikTok 视频下载失败：HTTP ${response.status}。`);
    }
    return response;
  }
}

async function storeVideo(archive, response, key, jobId) {
  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const lengthHeader = response.headers.get('content-length');
  const declared = lengthHeader == null ? null : Number(lengthHeader);
  const metadata = {
    httpMetadata: { contentType: 'video/mp4' },
    customMetadata: { kind: 'psychology-recreation-source', jobId: String(jobId) }
  };
  let upload = null, reader = null, total = 0, used = 0, partNumber = 0, checked = false;
  let buffer = new Uint8Array(PART_BYTES);
  const parts = [];
  const checkHeader = () => {
    if (!checked) {
      if (used < 12 || String.fromCharCode(...buffer.subarray(4, 8)) !== 'ftyp') {
        throw new Error('TikTok 视频下载内容无效：不是 MP4 文件。');
      }
      checked = true;
    }
  };
  const uploadPart = async (bytes) => {
    checkHeader();
    if (!upload) upload = await archive.createMultipartUpload(key, metadata);
    parts.push(await upload.uploadPart(++partNumber, bytes));
  };
  try {
    if (!['video/mp4', 'video/x-m4v', 'application/octet-stream'].includes(contentType)) {
      throw new Error('TikTok 视频下载内容无效：返回的不是视频文件。');
    }
    if (declared != null && (!Number.isSafeInteger(declared) || declared < 1024 || declared > MAX_BYTES)) {
      throw new Error(declared > MAX_BYTES ? 'TikTok 原视频超过 300 MB。' : 'TikTok 视频下载内容无效。');
    }
    reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error('TikTok 原视频超过 300 MB。');
      let offset = 0;
      while (offset < value.byteLength) {
        const length = Math.min(PART_BYTES - used, value.byteLength - offset);
        buffer.set(value.subarray(offset, offset + length), used);
        used += length;
        offset += length;
        if (!checked && used >= 12) checkHeader();
        if (used === PART_BYTES) {
          await uploadPart(buffer);
          buffer = new Uint8Array(PART_BYTES);
          used = 0;
        }
      }
    }
    if (total < 1024 || (declared != null && total !== declared)) throw new Error('TikTok 视频下载不完整，请重试。');
    checkHeader();
    let object;
    if (upload) {
      if (used) await uploadPart(buffer.subarray(0, used));
      object = await upload.complete(parts);
    } else {
      object = await archive.put(key, buffer.subarray(0, used), metadata);
    }
    if (Number(object?.size) !== total) throw new Error('TikTok 视频存储不完整，请重试。');
    return { size: total, mimeType: 'video/mp4' };
  } catch (error) {
    if (upload) await upload.abort().catch(() => {});
    await archive.delete(key);
    throw error;
  } finally {
    if (reader) await reader.cancel().catch(() => {});
    else await response.body?.cancel().catch(() => {});
  }
}
