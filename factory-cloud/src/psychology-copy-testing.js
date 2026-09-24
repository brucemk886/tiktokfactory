import { EVOLUTION, loadCopyStats, seededRandom } from './psychology-copy-evolution.js';
import { psychologyItemStatus } from './psychology-item-status.js';
import { parseObject } from '../../scripts/psychology-operations.js';

export const TEST_POLICY = 'balanced-v1';
export const TEST_RULES = Object.freeze({ samples: 3, activeRewrites: 2 });
const keyOf = (source, variant = '') => source + '|' + variant;
const judged = stat => stat.mature >= TEST_RULES.samples && stat.avgViews != null;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 409 }); };

// Unknown remote outcomes still reserve a sample. Only confirmed terminal
// failures/cancellations release it; a live retry keeps the reservation.
export function occupiesTest(row, record = {}, group = {}) {
  const remote = String(record.officialRemoteStatus || record.status || '').toLowerCase();
  if (['published', 'publish_complete'].includes(remote)) return true;
  if (['queued','running'].includes(row.status) || ['queued','running'].includes(group.retry_status) || group.status === 'submitting') return true;
  if (['status_timeout','needs_review'].includes(remote)) return true;
  if (['failed','rejected','canceled','cancelled','enqueue_failed'].includes(remote)) return false;
  if (record.batchId || parseObject(row.receipt_json).batchId || (group.request_json && group.request_json !== '{}')) return true;
  return !['cancelled','production_failed','publish_failed'].includes(psychologyItemStatus(row, record, group).displayStatus);
}

export async function loadTestState(db, owner, now = Date.now()) {
  // Read before the snapshot: a concurrent allocator invalidates our revision.
  const revision = Number((await db.prepare('SELECT COALESCE(MAX(revision),0)+1 n FROM psychology_copy_test_allocations WHERE owner=?').bind(owner).first()).n);
  const stats = await loadCopyStats(db, owner);
  const rows = (await db.prepare(`SELECT i.*,c.source_key,c.variant_id,j.status,j.type,j.result_json,
      g.status group_status,g.request_json,r.status retry_status
    FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
    JOIN psychology_creative_snapshots c ON c.item_id=i.id
    LEFT JOIN factory_jobs j ON j.id=i.job_id
    LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id
    LEFT JOIN factory_jobs r ON r.id=g.id||'-submit'
    WHERE b.created_by=? AND b.created_at>=? AND json_extract(b.config_json,'$.mediaType')='photo'
    ORDER BY b.created_at DESC,i.id LIMIT 20001`).bind(owner, now - EVOLUTION.windowDays * 86400000).all()).results;
  if (rows.length > 20000) fail('测试记录超过本次核对上限，请先缩小测试范围。');
  const records = rows.length ? (await db.prepare(`SELECT value_json FROM factory_publish_records WHERE
    json_extract(value_json,'$.autoTaskId') IN (SELECT value FROM json_each(?))
    ORDER BY COALESCE(json_extract(value_json,'$.updatedAt'),0)`).bind(JSON.stringify(rows.map(r => r.id))).all()).results : [];
  const byItem = new Map(records.map(r => { const v = parseObject(r.value_json); return [v.autoTaskId, v]; }));
  const occupied = new Map();
  for (const row of rows) {
    const raw = byItem.get(row.id) || {}, record = raw.autoBatchId && raw.autoBatchId !== row.batch_id ? {} : raw;
    if (!occupiesTest(row, record, { status:row.group_status, request_json:row.request_json, retry_status:row.retry_status })) continue;
    const key = keyOf(row.source_key, row.variant_id);
    occupied.set(key, (occupied.get(key) || 0) + 1);
  }
  // Keep the mature rollup conservative when a record has been removed or failed.
  for (const key of new Set([...stats.keys(), ...occupied.keys()])) {
    const prior = stats.get(key) || { mature:0, avgViews:null }, count = occupied.get(key) || 0;
    stats.set(key, { ...prior, posts:count, mature:Math.min(prior.mature, count) });
  }
  return { revision, stats };
}

export function testAllocationStatement(db, owner, revision, batchId, now) {
  // This unique revision and all item reservations commit in one D1 batch.
  return db.prepare('INSERT INTO psychology_copy_test_allocations(owner,revision,batch_id,created_at) VALUES(?,?,?,?)').bind(owner,revision,batchId,now);
}

export function planFairLibraryDraw({ posts, stats = new Map(), slots, used = new Map(), strategy = 'evolve', pairSeed = '', random = Math.random }) {
  const extra = new Map(), taken = new Set(), plan = [];
  const stat = (post, id) => {
    const saved = stats.get(keyOf(post.sourceKey,id)) || { posts:0, mature:0, avgViews:null };
    return { ...saved, posts:saved.posts + (extra.get(keyOf(post.sourceKey,id)) || 0) };
  };
  // Shared, strategy-independent order for staggered groups in the same daily round.
  const ordered = [...posts].sort((a,b) => a.createdAt-b.createdAt || a.sourceKey.localeCompare(b.sourceKey));
  const rnd = pairSeed ? seededRandom(pairSeed) : random;
  for (let i=ordered.length-1; i>0; i--) { const j=Math.floor(rnd()*(i+1)); [ordered[i],ordered[j]]=[ordered[j],ordered[i]]; }
  let originalTrials=0, rewriteTrials=0;
  for (const slot of slots) {
    const seen = used.get(slot.connectionId) || new Set(), trial=[], proven=[];
    for (const [rank,post] of ordered.entries()) {
      if (seen.has(post.sourceKey)) continue;
      const original = post.original ? { id:'', row:post.original, stat:stat(post,'') } : null;
      const rewrites = post.rewrites.map(row => ({ id:row.external_id,row,stat:stat(post,row.external_id) }));
      const active = rewrites.filter(v => !judged(v.stat)).sort((a,b) => Number(b.stat.posts>0)-Number(a.stat.posts>0) || (a.row.created_at||0)-(b.row.created_at||0) || a.id.localeCompare(b.id)).slice(0,TEST_RULES.activeRewrites);
      const available = strategy==='original' ? [original].filter(Boolean) : strategy==='rewrite' ? [...active,...rewrites.filter(v=>judged(v.stat))] : [original,...active,...rewrites.filter(v=>judged(v.stat))].filter(Boolean);
      for (const version of available) {
        if (taken.has(keyOf(post.sourceKey,version.id))) continue;
        if (strategy==='evolve' && version.id && original && judged(original.stat) && judged(version.stat) && version.stat.avgViews < original.stat.avgViews*EVOLUTION.retireRatio) continue;
        const candidate={post,version,rank};
        if (judged(version.stat)) proven.push(candidate);
        else if (version.stat.posts < TEST_RULES.samples) trial.push(candidate);
      }
    }
    // Complete active experiments first. A alternates original/rewrite while
    // cold; C rotates least-used versions without ever substituting originals.
    trial.sort((a,b) => {
      if (strategy==='evolve') {
        const preferOriginal=originalTrials<=rewriteTrials;
        const mismatch=v=>Number(Boolean(v.version.id)===preferOriginal);
        const type=mismatch(a)-mismatch(b); if(type)return type;
      }
      const started=v=>Number(v.version.stat.posts>0);
      return started(b)-started(a) || a.version.stat.posts-b.version.stat.posts || a.rank-b.rank || a.version.id.localeCompare(b.version.id);
    });
    proven.sort((a,b) => strategy==='evolve' ? b.version.stat.avgViews-a.version.stat.avgViews || a.rank-b.rank : a.version.stat.posts-b.version.stat.posts || a.rank-b.rank);
    const exploit=proven.length && (!trial.length || (strategy==='evolve' && random()<EVOLUTION.exploitShare));
    const pick=exploit ? proven[0] : trial[0];
    if(!pick)fail('可用测试版本不足：每版先占用 3 个测试名额，等待满 24 小时且有数据后再评估；请补充对应版本或减少账号。本批未创建，改写组不会用原版补足。');
    const key=keyOf(pick.post.sourceKey,pick.version.id);
    taken.add(key);extra.set(key,(extra.get(key)||0)+1);seen.add(pick.post.sourceKey);used.set(slot.connectionId,seen);
    if(!judged(pick.version.stat)){if(pick.version.id)rewriteTrials++;else originalTrials++;}
    plan.push({...slot,post:pick.post,variantId:pick.version.id,row:pick.version.row});
  }
  return plan;
}
