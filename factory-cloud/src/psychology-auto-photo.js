import { backupPhoto, restorePhotoCheckpoints } from './psychology-photo-recovery.js';
import { stagePublishItem } from './psychology-publish-groups.js';
import { assertAutoJobAccess, loadAutoUser } from './psychology-auto-publish.js';
import { assertOfficialPublishAccess } from './official.js';
import { importRenderedPhoto, normalizePhotoPublishPayload, buildPhotoBatchRequest, buildPhotoPublishRecord, proxyStockPhoto } from './photo-publishing.js';
import { mergeAndStorePublishRecords } from './publish-records-store.js';
import { signalDesk } from './signal-desk.js';
import { json, readJson, sha256Hex } from './http.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
// Called only after handleWorkerApi has authenticated the worker token.
export async function handleAutoPhotoWorker(request, env, url) {
  const match = url.pathname.match(/^\/api\/worker\/psychology-auto\/([^/]+)\/(state|upload|publish|image\/\d+)$/);
  if (!match) return null;
  const job = await env.DB.prepare('SELECT * FROM factory_jobs WHERE id=?').bind(match[1]).first();
  const payload = JSON.parse(job?.payload_json || '{}');
  if (!job || !payload.photoAutomation || !payload.psychologyAutomation) fail('图文任务不存在。', 404);
  if (job.status !== 'running' || job.worker_id !== request.headers.get('x-factory-worker')) fail('只能由接单工人处理正在运行的任务。', 409);
  const item = await env.DB.prepare('SELECT * FROM psychology_publish_items WHERE id=? AND job_id=?')
    .bind(payload.psychologyAutomation.id, job.id).first();
  if (!item) fail('自动发布任务不存在。', 404);
  await assertAutoJobAccess(env, job, {fresh:false});
  const assets = JSON.parse(item.photo_assets_json || '{}');
  const receipt = JSON.parse(item.receipt_json || '{}');
  if (match[2] === 'state' && request.method === 'GET') return json({ assets:receipt.batchId?assets:await restorePhotoCheckpoints(env,item,assets), receipt });
  if (match[2].startsWith('image/') && request.method === 'GET') {
    const page = payload.pages?.[Number(match[2].split('/')[1])];
    if (!page || page.template !== 'stock') fail('没有该素材图片。', 404);
    return proxyStockPhoto(env, page.imageUrl);
  }
  if (request.method !== 'POST') fail('只支持 POST。', 405);
  if (match[2] === 'upload') {
    const input = await readJson(request);
    const index = Number(input.index);
    if (!Number.isInteger(index) || index < 0 || index >= payload.pages.length || index > 5) fail('图片序号无效。');
    if (assets[index]) return json(assets[index]);
    if (receipt.batchId) fail('图文已提交，不能替换图片。', 409);
    await backupPhoto(env,item,index,{dataUrl:input.dataUrl});
    const asset = await importRenderedPhoto(env, env.DB, { dataUrl: input.dataUrl, fileName: item.id + '-' + index + '.jpg' });
    // JSON_SET updates only this page, preserving concurrent uploads.
    await env.DB.prepare("UPDATE psychology_publish_items SET photo_assets_json=json_set(photo_assets_json,?,json(?)) WHERE id=?")
      .bind('$.' + index, JSON.stringify(asset), item.id).run();
    return json(asset, 201);
  }
  if (match[2] !== 'publish') fail('接口不存在。', 404);
  if (receipt.batchId) return json(receipt);
  const user = await loadAutoUser(env.DB, job.created_by);
  if(!item.publish_group_id)await assertOfficialPublishAccess(env, user, { module: 'psychology', connectionIds: [item.connection_id] });
  const photos = payload.pages.map((_, index) => assets[index]);
  if (photos.some(photo => !photo)) fail('图片尚未全部上传，不会提交部分图集。', 409);
  const hash = await sha256Hex(item.id);
  const requestId = [hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20,32)].join('-');
  const publish = normalizePhotoPublishPayload({
    requestId, module: 'psychology', connectionId: item.connection_id, assets: photos,
    title: String(payload.plan?.title || job.title).slice(0,90), caption: String(payload.plan?.caption || '').slice(0,4000),
    // An explicit pool song disables TikTok's auto recommendation for this post.
    scheduleAt: item.schedule_at * 1000, photoCoverIndex: 0, autoAddMusic: true,
    musicSoundId: String(payload.psychologyAutomation.musicSoundId || ''),
  });
  if(item.publish_group_id){
    const remoteItem=buildPhotoBatchRequest(publish).items[0];
    return json(await stagePublishItem(env,item,{mediaType:'photo',title:publish.title,item:remoteItem}),202);
  }
  const batch = await signalDesk(env, env.DB, '/api/v1/publish/batches', { method:'POST', body: buildPhotoBatchRequest(publish) });
  const record = {...buildPhotoPublishRecord(publish, batch),id:'psychology:'+item.id,autoBatchId:item.batch_id,nextRetryAt:0};
  if (!record.batchId) fail('发布中台未返回批次编号，请重试确认提交状态。', 502);
  await mergeAndStorePublishRecords(env.DB, [{ ...record, autoTaskId: item.id }]);
  const next = { batchId: record.batchId, recordId: record.id, submittedAt: Date.now() };
  await env.DB.prepare('UPDATE psychology_publish_items SET receipt_json=? WHERE id=?').bind(JSON.stringify(next), item.id).run();
  return json(next, 202);
}
