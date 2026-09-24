import { psychologyItemStatus } from './psychology-item-status.js';
import { parseObject } from '../../scripts/psychology-operations.js';

const DAY = 86400000;
export const pilotMembership = `EXISTS (SELECT 1 FROM psychology_autopilot_slots s WHERE s.autopilot_id=? AND instr(','||s.batch_id||',', ','||psychology_publish_items.batch_id||',')>0)`;
// A submission lease or frozen request is an irreversible boundary for local cancellation.
const cancellable = `deleted_at=0 AND receipt_json='{}' AND publish_group_id<>''
  AND EXISTS (SELECT 1 FROM psychology_publish_groups g WHERE g.id=publish_group_id AND g.status IN ('waiting','failed') AND g.request_json='{}' AND g.response_json='{}')
  AND NOT EXISTS (SELECT 1 FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=psychology_publish_items.id AND (COALESCE(json_extract(r.value_json,'$.batchId'),'')<>'' OR lower(COALESCE(json_extract(r.value_json,'$.officialRemoteStatus'),json_extract(r.value_json,'$.status'),'')) IN ('published','publish_complete')))`;

export async function stopImpact(db, pilotId, connectionId = '') {
  const row = await db.prepare(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN ${cancellable} THEN 1 ELSE 0 END),0) stoppable
    FROM psychology_publish_items WHERE ${pilotMembership} AND deleted_at=0 AND (?='' OR connection_id=?)
    AND ((${cancellable}) OR NOT EXISTS (SELECT 1 FROM factory_publish_records r WHERE json_extract(r.value_json,'$.autoTaskId')=psychology_publish_items.id
      AND lower(COALESCE(NULLIF(json_extract(r.value_json,'$.officialRemoteStatus'),''),json_extract(r.value_json,'$.status'))) IN ('published','publish_complete','failed','rejected','canceled','cancelled')))`)
    .bind(pilotId, connectionId, connectionId).first();
  return { stoppable: Number(row.stoppable), protected: Number(row.total) - Number(row.stoppable) };
}

export async function stopPending(db, pilotId, connectionId = '', now = Date.now()) {
  const results = await db.batch([
    db.prepare(`UPDATE psychology_publish_items SET deleted_at=? WHERE ${pilotMembership} AND (?='' OR connection_id=?) AND ${cancellable}`)
      .bind(now, pilotId, connectionId, connectionId),
    // Running generation is allowed to finish; tombstones exclude its output from submission.
    db.prepare(`UPDATE factory_jobs SET status='cancelled',message='自动运营已停止尚未提交的任务',updated_at=? WHERE status='queued'
      AND id IN (SELECT job_id FROM psychology_publish_items WHERE ${pilotMembership} AND deleted_at=? AND (?='' OR connection_id=?))`)
      .bind(now, pilotId, now, connectionId, connectionId),
  ]);
  return Number(results[0].meta?.changes || 0);
}

export function nextAutopilotCheck(now = Date.now()) {
  const start = Math.floor((now + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
  return [start, start + 8 * 3600000, start + DAY].find(t => t > now);
}
export function executionCounts(items) {
  const counts = { planned: items.length, queued: 0, producing: 0, pending: 0, published: 0, failed: 0, stopped: 0, unknown: 0 };
  for (const i of items) {
    const key = { queued:'queued', producing:'producing', publishing:'pending', scheduled:'pending', published:'published', production_failed:'failed', publish_failed:'failed', cancelled:'stopped' }[i.state] || 'unknown';
    counts[key]++;
  }
  return counts;
}

export async function slotExecution(db, slots, labels = new Map()) {
  const batchSlots = new Map();
  for (const slot of slots) for (const id of String(slot.batch_id || '').split(',').filter(Boolean)) batchSlots.set(id, slot.slot_at);
  if (!batchSlots.size) return [];
  const ids = JSON.stringify([...batchSlots.keys()]);
  const [rows, groups, stored] = await db.batch([
    db.prepare(`SELECT i.id,i.batch_id,i.connection_id,i.schedule_at,i.source_id,i.deleted_at,i.publish_group_id,
      i.execution_status,i.execution_type,i.execution_error,
      json_object('batchId',json_extract(i.receipt_json,'$.batchId')) receipt_json,
      CASE WHEN i.ready_json='{}' THEN '{}' ELSE json_object('title',json_extract(i.ready_json,'$.title')) END ready_json,
      c.variant_id,json_object('title',json_extract(c.copy_json,'$.title')) copy_json,
      j.status,j.type,j.title,j.error,json_object('publishFailed',json_extract(j.result_json,'$.publishFailed')) result_json,j.available_at,j.auto_retry_count FROM psychology_publish_items i
      LEFT JOIN factory_jobs j ON j.id=i.job_id LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id WHERE i.batch_id IN (SELECT value FROM json_each(?)) ORDER BY i.schedule_at,i.id`).bind(ids),
    db.prepare(`SELECT g.id,g.status,g.error,j.status retry_status,j.available_at retry_at FROM psychology_publish_groups g
      LEFT JOIN factory_jobs j ON j.id=g.id||'-submit' WHERE g.batch_id IN (SELECT value FROM json_each(?))`).bind(ids),
    db.prepare(`SELECT value_json FROM factory_publish_records WHERE json_extract(value_json,'$.autoTaskId') IN
      (SELECT id FROM psychology_publish_items WHERE batch_id IN (SELECT value FROM json_each(?))) ORDER BY COALESCE(json_extract(value_json,'$.updatedAt'),0)`).bind(ids),
  ]);
  const records = new Map(stored.results.map(r => { const v = parseObject(r.value_json); return [v.autoTaskId, v]; }));
  const groupMap = new Map(groups.results.map(g => [g.id, g]));
  return rows.results.map(row => {
    const raw = records.get(row.id) || {}, record = raw.autoBatchId && raw.autoBatchId !== row.batch_id ? {} : raw;
    const group = groupMap.get(row.publish_group_id) || {};
    const status = row.deleted_at ? { displayStatus:'cancelled',failureReason:'' } : psychologyItemStatus(row, record, group);
    const retrying = !row.deleted_at && !parseObject(row.receipt_json).batchId && !record.batchId &&
      ((row.status==='queued' && row.auto_retry_count>0) || ['queued','running'].includes(group.retry_status));
    return { id:row.id, batchId:row.batch_id, slotAt:batchSlots.get(row.batch_id), connectionId:row.connection_id,
      account:labels.get(row.connection_id)||row.connection_id, title:row.title||parseObject(row.ready_json).title||parseObject(row.copy_json).title||row.source_id,
      version:row.variant_id ? '改写 · '+row.variant_id : row.variant_id === '' ? '原版' : '未记录',
      scheduleAt:row.schedule_at*1000, state:status.displayStatus, error:String(status.failureReason||'').slice(0,600),
      retrying:Boolean(retrying), retryAt:retrying ? (group.retry_at||row.available_at||0) : 0,
      videoId:String(record.videoId||record.tiktokVideoId||''),
      recordUrl:'/psychology-publish-sources',
    };
  });
}
