import { json, errorJson, sha256Hex } from './http.js';
import { psychologyPeerHitFromRow } from './psychology-peer-hits-store.js';
import { publicJob } from './jobs.js';
import { peerProductionPayload, PEER_TEMPLATES } from '../../scripts/psychology-peer-production.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };

export async function handlePeerProduction(request, env, url, user) {
  const base = '/api/psychology-peer-hits/production';
  if (url.pathname !== base) return null;
  if (request.method === 'GET') {
    const rows = await env.DB.prepare("SELECT * FROM factory_jobs WHERE created_by = ? AND json_extract(payload_json, '$.peerSource.id') IS NOT NULL ORDER BY created_at DESC LIMIT 30").bind(user.username).all();
    return json({ jobs: (rows.results || []).map(row => ({ ...publicJob(row), source: JSON.parse(row.payload_json).peerSource })) });
  }
  if (request.method !== 'POST') return errorJson('不支持此请求方法。', 405);
  const input = await request.json().catch(() => fail('请提交有效 JSON。'));
  const target = PEER_TEMPLATES[input?.template];
  if (!target || !user.sidebarModules.includes(target.module)) fail('没有所选模板的制作权限。', 403);
  if (!/^[0-9a-f-]{36}$/i.test(String(input.requestId || ''))) fail('提交编号无效，请刷新页面后重试。');
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 5 || new Set(input.ids).size !== input.ids.length || input.ids.some(id => !/^psy-[a-f0-9]{32}$/i.test(id))) fail('每次请选择 1–5 条不同的同行爆款。');
  const key = await sha256Hex(JSON.stringify({ username: user.username, requestId: input.requestId }));
  const rows = await env.DB.prepare(`SELECT * FROM psychology_peer_hits WHERE id IN (${input.ids.map(() => '?').join(',')})`).bind(...input.ids).all();
  if (rows.results.length !== input.ids.length) fail('部分选题已经删除，请刷新列表。', 409);
  const stamp = Date.now();
  const jobs = input.ids.map((id, index) => {
    const item = psychologyPeerHitFromRow(rows.results.find(row => row.id === id));
    return { id: `peer-${key.slice(0, 32)}-${index}`, payload: peerProductionPayload(item, input.template) };
  });
  const existing = await env.DB.prepare("SELECT id, type, payload_json FROM factory_jobs WHERE id LIKE ? AND created_by = ?").bind(`peer-${key.slice(0, 32)}-%`, user.username).all();
  if (existing.results.length) {
    if (existing.results.length !== jobs.length || existing.results.some(row => row.type !== input.template || !jobs.some(job => job.id === row.id && job.payload.peerSource.id === JSON.parse(row.payload_json).peerSource.id))) fail('这个提交编号已用于其他选题，请重新选择后提交。', 409);
    return json({ accepted: true, duplicate: true, jobIds: jobs.map(job => job.id) }, 200);
  }
  // Validate all sources before atomically enqueuing the batch. A repeated
  // request id cannot create another paid generation job after a network retry.
  await env.DB.batch(jobs.map(job => env.DB.prepare(`INSERT INTO factory_jobs (
    id,type,status,title,percent,message,payload_json,result_json,error,created_by,worker_id,claimed_at,completed_at,created_at,updated_at
    ) VALUES (?,?,'queued',?,1,?,?,'{}','',?,'',0,0,?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(job.id, input.template, job.payload.topic, '等待制作：文案 → 分镜 → 生图 → 成品', JSON.stringify(job.payload), user.username, stamp, stamp)));
  return json({ accepted: true, jobIds: jobs.map(job => job.id) }, 202);
}
