const ENDPOINT = 'https://api.tikhub.io/api/v1/tiktok/app/v3/fetch_one_video_by_share_url';
export const TIKTOK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const fail = (message, statusCode = 502) => { throw Object.assign(new Error(message), { statusCode }); };

export function validateTikTokPageUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { fail('请提供有效的 TikTok 视频链接。', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname)) {
    fail('只支持公开的 TikTok 视频链接。', 400);
  }
  return url.href;
}

export function validateTikTokVideoFileUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { fail('TikTok 视频文件地址无效。', 400); }
  const domains = ['tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    fail('只支持 TikTok CDN 的 HTTPS 视频文件地址。', 400);
  }
  return url.href;
}

export async function resolveTikTokVideoSource(env, { url, videoFileUrl }) {
  const pageUrl = validateTikTokPageUrl(url);
  const key = String(env.TIKHUB_API_KEY || '').trim();
  if (!key) {
    if (videoFileUrl) return { urls: [validateTikTokVideoFileUrl(videoFileUrl)], provider: 'direct' };
    fail('TikTok 视频解析服务尚未配置，请配置 TikHub API Key。', 503);
  }
  const apiUrl = new URL(ENDPOINT);
  apiUrl.searchParams.set('share_url', pageUrl);
  let response;
  try {
    response = await (env.fetch || fetch)(apiUrl.href, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': TIKTOK_USER_AGENT },
      redirect: 'manual', signal: AbortSignal.timeout(90000)
    });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'tikhub-fetch-failed', type: error?.name, message: String(error?.message || '').replaceAll(key, '[redacted]').slice(0, 300) }));
    fail('TikHub 视频解析请求失败或超时，请稍后重试。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401) fail('TikHub API Key 无效，请检查服务器配置。');
    if (response.status === 402) fail('TikHub 额度不足，请充值后重试。');
    fail(`TikHub 视频解析失败：HTTP ${response.status}。`);
  }
  const payload = await readBoundedJson(response);
  if (Number(payload?.code) !== 200) fail(`TikHub 视频解析失败（状态 ${Number(payload?.code) || '未知'}）。`);
  const item = payload.data?.aweme_detail;
  if (!item?.video || Number(payload.data?.status_code || 0) !== 0) {
    fail('TikHub 未返回可下载的视频，视频可能已删除、设为私密或受到地区限制。');
  }
  const video = item.video;
  const groups = [video.play_addr_h264, video.play_addr, video.download_addr,
    ...(Array.isArray(video.bit_rate) ? video.bit_rate.map(rate => rate.play_addr) : [])];
  const urls = [];
  for (const group of groups) {
    for (const candidate of Array.isArray(group?.url_list) ? group.url_list : []) {
      try {
        const value = validateTikTokVideoFileUrl(candidate);
        if (!urls.includes(value)) urls.push(value);
      } catch { /* Ignore unsafe host alternatives from the provider. */ }
    }
  }
  if (!urls.length) fail('TikHub 没有返回受支持的 TikTok 视频直链。');
  return { urls: urls.slice(0, 6), provider: 'tikhub', videoId: String(item.aweme_id || ''), requestId: String(payload.request_id || '') };
}

async function readBoundedJson(response) {
  const limit = 2 * 1024 * 1024;
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
