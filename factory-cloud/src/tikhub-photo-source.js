import { pickTikTokPhotoUrl } from '../../scripts/psychology-peer-production.js';
import { TIKTOK_USER_AGENT, validateTikTokPageUrl } from './tikhub-video-source.js';

const ENDPOINT = 'https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_one_video_by_share_url';
const PHOTO_DOMAINS = ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteimg.com', 'ibytedtos.com', 'muscdn.com'];
const fail = (message, statusCode = 502) => { throw Object.assign(new Error(message), { statusCode }); };

export function validateTikTokPhotoFileUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { fail('TikTok 图片文件地址无效。', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !PHOTO_DOMAINS.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    fail('只支持 TikTok CDN 的 HTTPS 图片文件地址。', 400);
  }
  return url.href;
}

export async function resolveTikTokPhotoSource(env, { url, imageUrls = [] }) {
  const pageUrl = validateTikTokPageUrl(url);
  const direct = orderedSafeUrls(imageUrls);
  if (direct.length) return { urls: direct, provider: 'stored' };
  const key = String(env.TIKHUB_API_KEY || '').trim();
  if (!key) fail('TikTok 图文解析服务尚未配置，请配置 TikHub API Key。', 503);
  const apiUrl = new URL(ENDPOINT);
  apiUrl.searchParams.set('share_url', pageUrl);
  let response;
  try {
    response = await (env.fetch || fetch)(apiUrl.href, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': TIKTOK_USER_AGENT },
      redirect: 'manual', signal: AbortSignal.timeout(90000)
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'tikhub-photo-fetch-failed', type: error?.name, message: String(error?.message || '').replaceAll(key, '[redacted]').slice(0, 300) }));
    fail('TikHub 图文解析请求失败或超时，请稍后重试。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) fail('TikHub API Key 无效，请检查服务器配置。');
    if (response.status === 402) fail('TikHub 额度不足，请充值后重试。');
    fail(`TikHub 图文解析失败：HTTP ${response.status}。`);
  }
  const payload = await readBoundedJson(response);
  if (Number(payload?.code) !== 200) fail(`TikHub 图文解析失败（状态 ${Number(payload?.code) || '未知'}）。`);
  const item = payload.data?.aweme_detail;
  if (!item || Number(payload.data?.status_code || 0) !== 0) fail('TikHub 未返回图文内容，帖子可能已删除、设为私密或受到地区限制。');
  const groups = [item.images, item.image_post_info?.images, item.photo_mode_image_info?.images];
  const images = groups.find(Array.isArray) || [];
  const urls = orderedSafeUrls(images.map(firstImageUrl));
  if (!urls.length) fail('TikHub 没有返回受支持的原帖图片。');
  return { urls, provider: 'tikhub', postId: String(item.aweme_id || ''), requestId: String(payload.request_id || ''), sourceCopy: String(item.desc || '') };
}

function firstImageUrl(image) {
  if (typeof image === 'string') return pickTikTokPhotoUrl([image]);
  const candidates = [];
  const nested = [image?.display_image, image?.displayImage, image?.origin_image, image?.originImage, image?.image, image?.download_addr, image?.downloadAddr, image];
  for (const value of nested) {
    const urls = value?.url_list || value?.urlList || value?.download_url_list || value?.downloadUrlList;
    if (Array.isArray(urls)) candidates.push(...urls);
    candidates.push(value?.url, value?.image_url, value?.imageUrl, value?.src);
  }
  return pickTikTokPhotoUrl(candidates);
}

function orderedSafeUrls(values) {
  const urls = [];
  for (const value of Array.isArray(values) ? values : []) {
    const picked = pickTikTokPhotoUrl([value]);
    if (picked && !urls.includes(picked)) urls.push(picked);
  }
  return urls.slice(0, 6);
}

async function readBoundedJson(response) {
  const limit = 4 * 1024 * 1024;
  if (!response.body || Number(response.headers.get('content-length') || 0) > limit) {
    await response.body?.cancel();
    fail('TikHub 返回的数据大小异常。');
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) fail('TikHub 返回的数据大小异常。');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('TikHub 返回的不是有效 JSON。'); }
}
