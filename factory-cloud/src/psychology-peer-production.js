import { json, errorJson, sha256Hex } from './http.js';
import { psychologyPeerHitFromRow } from './psychology-peer-hits-store.js';
import { publicJob } from './jobs.js';
import { validateTikTokPageUrl, validateTikTokVideoFileUrl } from './tikhub-video-source.js';
import { peerProductionPayload } from '../../scripts/psychology-peer-production.js';

const VIDEO_TYPE = 'psychology-recreation';
const PHOTO_TYPE = 'psychology-photo-story';
export const PSYCHOLOGY_RECREATION_VOICE_IDS = Object.freeze({
  male: 'Gubgw9l4dtIoQA9YZHgx',
  female: 'vChnJZ1Cu89g2XXumPfT'
});
export const PSYCHOLOGY_RECREATION_VOICE_ID = PSYCHOLOGY_RECREATION_VOICE_IDS.male;
const BASE = '/api/psychology-peer-hits/production';
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

async function dispatchJobs(env, jobs, type) {
  const ids = jobs.map(job => job.id);
  const pending = await env.DB.prepare(`SELECT id FROM factory_jobs WHERE id IN (${ids.map(() => '?').join(',')}) AND type=? AND status='queued'`)
    .bind(...ids, type).all();
  if (!pending.results.length) return;
  const workflow = type === PHOTO_TYPE ? env.PEER_PHOTO_WORKFLOW : env.PSYCHOLOGY_RECREATION_WORKFLOW;
  try {
    await workflow.createBatch(
      pending.results.map(row => ({ id: row.id, params: { jobId: row.id } }))
    );
  } catch {
    fail('云端复刻任务启动暂时失败，请再次点击爆款复刻重试；不会重复创建任务。', 503);
  }
}

export async function handlePeerProduction(request, env, url, user) {
  const assetMatch = url.pathname.match(/^\/api\/psychology-peer-hits\/production\/([^/]+)\/assets\/(image|audio)\/(\d+)$/);
  if (assetMatch) return serveAsset(request, env, user, assetMatch);
  if (url.pathname !== BASE) return null;

  if (request.method === 'GET') {
    const jobId = url.searchParams.get('jobId');
    const requestedMediaType = url.searchParams.get('mediaType');
    if (requestedMediaType && !['video','photo'].includes(requestedMediaType)) return errorJson('内容类型无效。', 400);
    const requestedJobType = requestedMediaType === 'photo' ? PHOTO_TYPE : requestedMediaType === 'video' ? VIDEO_TYPE : '';
    const offset = Math.max(0, Math.min(100000, Number.parseInt(url.searchParams.get('offset'), 10) || 0));
    const rows = jobId
      ? await env.DB.prepare("SELECT * FROM factory_jobs WHERE created_by=? AND id=? AND json_extract(payload_json,'$.peerSource.id') IS NOT NULL").bind(user.username, jobId).all()
      : requestedJobType
        ? await env.DB.prepare("SELECT * FROM factory_jobs WHERE created_by=? AND type=? AND json_extract(payload_json,'$.peerSource.id') IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(user.username, requestedJobType, offset).all()
        : await env.DB.prepare("SELECT * FROM factory_jobs WHERE created_by=? AND json_extract(payload_json,'$.peerSource.id') IS NOT NULL ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?").bind(user.username, offset).all();
    if (jobId && !rows.results.length) return errorJson('找不到这条爆款复刻任务。', 404);
    const counts = requestedJobType
      ? await env.DB.prepare("SELECT status,COUNT(*) AS count FROM factory_jobs WHERE created_by=? AND type=? AND json_extract(payload_json,'$.peerSource.id') IS NOT NULL GROUP BY status").bind(user.username, requestedJobType).all()
      : await env.DB.prepare("SELECT status,COUNT(*) AS count FROM factory_jobs WHERE created_by=? AND json_extract(payload_json,'$.peerSource.id') IS NOT NULL GROUP BY status").bind(user.username).all();
    return json({
      jobs: (rows.results || []).slice(0, 30).map(row => {
        const payload = JSON.parse(row.payload_json || '{}');
        return { ...publicJob(row), title: row.title, source: payload.peerSource };
      }),
      counts: counts.results,
      hasMore: rows.results.length > 30,
      offset
    });
  }

  if (request.method !== 'POST') return errorJson('不支持此请求方法。', 405);
  const input = await request.json().catch(() => fail('请提交有效 JSON。'));
  if (!/^[0-9a-f-]{36}$/i.test(String(input.requestId || ''))) fail('提交编号无效，请刷新页面后重试。');
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 5 || new Set(input.ids).size !== input.ids.length || input.ids.some(id => !/^psy-[a-f0-9]{32}$/i.test(id))) {
    fail('每次请选择 1–5 条不同的同行爆款。');
  }
  const mediaType = String(input.mediaType || 'video').trim().toLowerCase();
  if (!['video','photo'].includes(mediaType)) fail('内容类型无效。');
  const type = mediaType === 'photo' ? PHOTO_TYPE : VIDEO_TYPE;
  if (mediaType === 'video' && (!env.PSYCHOLOGY_RECREATION_WORKFLOW || !env.ARCHIVE)) fail('线上视频复刻服务尚未配置完成。', 503);
  if (mediaType === 'photo' && !env.PEER_PHOTO_WORKFLOW) fail('线上图文复刻服务尚未配置完成。', 503);
  if (!String(env.KIE_API_KEY || '').trim()) fail('Kie 与 Z-Image 服务尚未配置。', 503);
  if (mediaType === 'video' && !String(env.ELEVENLABS_API_KEY || '').trim()) fail('ElevenLabs 配音服务尚未配置。', 503);

  const key = await sha256Hex(JSON.stringify({ username: user.username, requestId: input.requestId, mediaType }));
  const rows = await env.DB.prepare(`SELECT * FROM psychology_peer_hits WHERE id IN (${input.ids.map(() => '?').join(',')})`)
    .bind(...input.ids).all();
  if (rows.results.length !== input.ids.length) fail('部分内容已经删除，请刷新列表。', 409);
  const stamp = Date.now();
  const jobs = input.ids.map((id, index) => {
    const item = psychologyPeerHitFromRow(rows.results.find(row => row.id === id));
    if (item.mediaType !== mediaType) fail('所选内容类型已经变化，请刷新列表。', 409);
    if (mediaType === 'photo') {
      return {
        id: `peer-${key.slice(0, 32)}-${index}`,
        payload: { ...peerProductionPayload(item, PHOTO_TYPE), createdFrom: 'psychology-peer-hits' }
      };
    }
    if (item.platform !== 'tiktok') fail('爆款复刻目前只支持 TikTok 视频链接。');
    validateTikTokPageUrl(item.videoUrl);
    if (!String(env.TIKHUB_API_KEY || '').trim() && !item.videoData?.videoFileUrl) {
      fail('TikTok 视频解析服务尚未配置，请配置 TikHub API Key。', 503);
    }
    return {
      id: `peer-${key.slice(0, 32)}-${index}`,
      payload: {
        peerSource: {
          id: item.id,
          videoUrl: item.videoUrl,
          videoFileUrl: item.videoData?.videoFileUrl ? validateTikTokVideoFileUrl(item.videoData.videoFileUrl) : '',
          videoId: item.videoId || '',
          title: item.title || 'TikTok 爆款复刻',
          accountName: item.accountName || '',
          accountUsername: item.accountUsername || '',
          durationSeconds: Number(item.durationSeconds || 0),
          collectedAt: item.collectedAt
        },
        voiceGender: item.voiceGender,
        voiceId: PSYCHOLOGY_RECREATION_VOICE_IDS[item.voiceGender] || PSYCHOLOGY_RECREATION_VOICE_IDS.male,
        createdFrom: 'psychology-peer-hits'
      }
    };
  });

  const existing = await env.DB.prepare("SELECT id,type,payload_json FROM factory_jobs WHERE id LIKE ? AND created_by=?")
    .bind(`peer-${key.slice(0, 32)}-%`, user.username).all();
  if (existing.results.length) {
    const valid = existing.results.length === jobs.length && existing.results.every(row => {
      const payload = JSON.parse(row.payload_json || '{}');
      return row.type === type && jobs.some(job => job.id === row.id && job.payload.peerSource.id === payload.peerSource?.id);
    });
    if (!valid) fail('这个提交编号已用于其他内容，请重新选择后提交。', 409);
    await dispatchJobs(env, jobs, type);
    return json({ accepted: true, duplicate: true, execution: 'cloud', mediaType, jobIds: jobs.map(job => job.id) });
  }

  await env.DB.batch(jobs.map(job => env.DB.prepare(`INSERT INTO factory_jobs (
    id,type,status,title,percent,message,payload_json,result_json,error,created_by,worker_id,claimed_at,completed_at,created_at,updated_at
  ) VALUES (?,?,'queued',?,?,?,?,'{}','',?,'',0,0,?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(
      job.id, type, job.payload.peerSource.title, 1,
      mediaType === 'photo' ? '等待云端改编文案并生成图文分镜' : '等待云端下载原视频并拆解分镜', JSON.stringify(job.payload),
      user.username, stamp, stamp
    )));
  await dispatchJobs(env, jobs, type);
  return json({ accepted: true, execution: 'cloud', mediaType, jobIds: jobs.map(job => job.id) }, 202);
}

async function serveAsset(request, env, user, match) {
  if (!['GET', 'HEAD'].includes(request.method)) return errorJson('只支持读取复刻素材。', 405);
  const [, rawJobId, kind, indexText] = match;
  const jobId = decodeURIComponent(rawJobId);
  const job = await env.DB.prepare('SELECT type,created_by FROM factory_jobs WHERE id=?').bind(jobId).first();
  if (!job || job.type !== VIDEO_TYPE || job.created_by !== user.username) return errorJson('找不到该复刻素材。', 404);
  const index = Number(indexText);
  if (!Number.isSafeInteger(index) || index < 0 || index > 23) return errorJson('素材编号无效。', 400);
  const key = `psychology-recreation/${jobId}/scene-${index}.${kind === 'audio' ? 'mp3' : 'image'}`;
  if (request.method === 'HEAD') {
    const object = await env.ARCHIVE.head(key);
    if (!object) return errorJson('素材尚未生成。', 404);
    return new Response(null, { headers: assetHeaders(object, kind) });
  }
  const object = request.headers.get('range')
    ? await env.ARCHIVE.get(key, { range: request.headers })
    : await env.ARCHIVE.get(key);
  if (!object?.body) return errorJson('素材尚未生成。', 404);
  const headers = assetHeaders(object, kind);
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  if (object.range) {
    const offset = Number(object.range.offset || 0), length = Number(object.range.length || 0);
    headers.set('content-range', `bytes ${offset}-${Math.max(offset, offset + length - 1)}/${Number(object.size || offset + length)}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { headers });
}

function assetHeaders(object, kind) {
  const headers = new Headers({
    'content-type': object.httpMetadata?.contentType || (kind === 'audio' ? 'audio/mpeg' : 'image/webp'),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes'
  });
  if (Number(object.size || 0) > 0) headers.set('content-length', String(object.size));
  return headers;
}
