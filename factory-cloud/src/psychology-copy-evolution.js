import { photoCopyKey } from './peer-photo-copy-cache.js';
import { buildContentPerformance } from '../../scripts/psychology-content-performance.js';
import { parseObject } from '../../scripts/psychology-operations.js';
import { loadGroupStore, scopedAnalyticsAccounts } from './official.js';
import { listLatestArchiveAccounts, accountsFromLatestArchive, loadVideosForAccounts } from './official-archive-store.js';

// Thresholds the operator approved on 2026-09-23. A version is judged once it
// has `matureNeeded` posts that are 24h old with play data.
export const EVOLUTION = Object.freeze({ matureNeeded: 3, exploitShare: 0.7, retireRatio: 0.5, windowDays: 30 });

const statKey = (sourceKey, variantId) => sourceKey + '|' + (variantId || '');
const blank = Object.freeze({ posts: 0, mature: 0, avgViews: null });
const judged = stat => stat.mature >= EVOLUTION.matureNeeded && stat.avgViews != null;

// posts: [{ sourceKey, createdAt, original: row|null, rewrites: [variant rows] }]
// stats: Map statKey -> { posts, mature, avgViews }
// slots: [{ connectionId, scheduleAt }] in batch order
// used: Map connectionId -> Set of sourceKeys that account already posted
export function planLibraryDraw({ posts, stats = new Map(), slots, used = new Map(), reuse = false, random = Math.random }) {
  const batchUses = new Map();
  const stat = (post, variantId) => {
    const saved = stats.get(statKey(post.sourceKey, variantId)) || blank;
    return { ...saved, posts: saved.posts + (batchUses.get(statKey(post.sourceKey, variantId)) || 0) };
  };
  const fewestFirst = versions => [...versions].sort((a, b) => a.stat.posts - b.stat.posts);
  // Ordered version preference for one pick of one post.
  function preference(post) {
    const original = post.original ? { id: '', row: post.original, stat: stat(post, '') } : null;
    const rewrites = post.rewrites.map(row => ({ id: row.external_id, row, stat: stat(post, row.external_id) }));
    // The original always goes first until it has a baseline of its own.
    if (original && !judged(original.stat)) return [original, ...fewestFirst(rewrites)];
    const baseline = original ? original.stat.avgViews : null;
    const alive = rewrites.filter(v => !(judged(v.stat) && baseline != null && v.stat.avgViews < baseline * EVOLUTION.retireRatio));
    const proven = [original, ...alive].filter(v => v && judged(v.stat)).sort((a, b) => b.stat.avgViews - a.stat.avgViews);
    const trial = fewestFirst(alive.filter(v => !judged(v.stat)));
    const exploit = !trial.length || (proven.length > 0 && random() < EVOLUTION.exploitShare);
    return exploit ? [...proven, ...trial] : [...trial, ...proven];
  }
  const score = post => {
    const versions = [post.original ? stat(post, '') : null, ...post.rewrites.map(r => stat(post, r.external_id))].filter(Boolean);
    const best = versions.filter(judged).map(s => s.avgViews);
    return best.length ? Math.max(...best) : null;
  };
  const proven = posts.filter(p => score(p) != null).sort((a, b) => score(b) - score(a));
  const fresh = posts.filter(p => score(p) == null).sort((a, b) => a.createdAt - b.createdAt);
  const taken = new Set();
  const plan = [];
  for (const slot of slots) {
    const seen = used.get(slot.connectionId) || new Set();
    const buckets = random() < EVOLUTION.exploitShare ? [proven, fresh] : [fresh, proven];
    let pick = null;
    for (const bucket of buckets) {
      for (let index = 0; index < bucket.length && !pick; index++) {
        const post = bucket[index];
        if (!reuse && seen.has(post.sourceKey)) continue;
        const version = preference(post).find(v => !taken.has(statKey(post.sourceKey, v.id)));
        if (!version) continue;
        pick = { post, version };
        // Round-robin inside the bucket so one batch spreads over many posts.
        bucket.splice(index, 1); bucket.push(post);
      }
      if (pick) break;
    }
    if (!pick) throw Object.assign(new Error('文案库里这个账号能用的图文爆款不够了：同一账号不会重复发同一篇（原版或任一改写版本）。请补充文案、减少数量，或允许重复选题。'), { statusCode: 400 });
    const key = statKey(pick.post.sourceKey, pick.version.id);
    taken.add(key); batchUses.set(key, (batchUses.get(key) || 0) + 1);
    seen.add(pick.post.sourceKey); used.set(slot.connectionId, seen);
    plan.push({ ...slot, post: pick.post, variantId: pick.version.id, row: pick.version.row });
  }
  return plan;
}

// Library posts for one owner: completed originals of the media type plus that
// owner's enabled rewrites, grouped by the viral post they belong to.
export async function loadLibraryPosts(db, owner, mediaType, query = '', validOriginal = () => true) {
  const like = '%' + String(query || '') + '%';
  const [originals, rewrites] = await Promise.all([
    db.prepare("SELECT * FROM psychology_copy_library WHERE status='done' AND media_type=? AND (title LIKE ? OR source_url LIKE ? OR content_json LIKE ?) ORDER BY completed_at,id LIMIT 2000")
      .bind(mediaType, like, like, like).all(),
    db.prepare('SELECT * FROM psychology_copy_variants WHERE owner=? AND enabled=1 ORDER BY created_at,id LIMIT 10000').bind(owner).all(),
  ]);
  const posts = new Map();
  for (const row of originals.results) {
    if (!validOriginal(row)) continue;
    let sourceKey; try { sourceKey = photoCopyKey(row.source_url); } catch { sourceKey = row.id; }
    posts.set(sourceKey, { sourceKey, createdAt: row.completed_at || row.created_at, original: row, rewrites: [] });
  }
  const searching = String(query || '').trim().toLowerCase();
  for (const row of rewrites.results) {
    const post = posts.get(row.source_key);
    if (post) { post.rewrites.push(row); continue; }
    // A rewrite whose original is not extracted yet still counts as its own post.
    if (searching && !String(row.title).toLowerCase().includes(searching)) continue;
    posts.set(row.source_key, { sourceKey: row.source_key, createdAt: row.created_at, original: null, rewrites: [row] });
  }
  return [...posts.values()];
}

export async function loadCopyStats(db, owner) {
  const rows = (await db.prepare('SELECT source_key,variant_id,posts,mature,avg_views FROM psychology_copy_performance WHERE owner=?').bind(owner).all()).results;
  return new Map(rows.map(r => [statKey(r.source_key, r.variant_id), { posts: Number(r.posts) || 0, mature: Number(r.mature) || 0, avgViews: r.avg_views == null ? null : Number(r.avg_views) }]));
}

// Which viral posts each account has already published, covering usage rows
// keyed by post (new) as well as by original id or rewrite id (older batches).
export async function loadUsedPosts(db, connectionIds, posts) {
  const toPost = new Map();
  for (const post of posts) {
    toPost.set(post.sourceKey, post.sourceKey);
    if (post.original) toPost.set(post.original.id, post.sourceKey);
    for (const rewrite of post.rewrites) toPost.set(rewrite.id, post.sourceKey);
  }
  const rows = (await db.prepare('SELECT source_id,connection_id FROM psychology_peer_account_usage WHERE connection_id IN (SELECT value FROM json_each(?)) AND source_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(connectionIds), JSON.stringify([...toPost.keys()])).all()).results;
  const used = new Map();
  for (const row of rows) {
    const set = used.get(row.connection_id) || new Set();
    set.add(toPost.get(row.source_id)); used.set(row.connection_id, set);
  }
  return used;
}

// Rebuilds the rollup from the last 30 days of auto-published items. Views
// come from each account's archived videos, matched exactly like the content
// performance report.
// Auto-published items with the viral post and version they used. Newer items
// carry a creative snapshot; older ones fall back to the rewrite row or peer URL.
export async function loadResolvedItems(db, since) {
  const items = (await db.prepare(`SELECT i.id,i.connection_id,i.source_id,i.schedule_at,b.created_by AS owner,b.config_json,b.created_at,
      c.source_key AS snap_key,c.variant_id AS snap_variant,c.style_id,p.video_url AS peer_url,v.source_key AS var_key,v.external_id AS var_external
    FROM psychology_publish_items i JOIN psychology_publish_batches b ON b.id=i.batch_id
    LEFT JOIN psychology_creative_snapshots c ON c.item_id=i.id
    LEFT JOIN psychology_peer_hits p ON p.id=i.source_id
    LEFT JOIN psychology_copy_variants v ON v.id=i.source_id
    WHERE i.deleted_at=0 AND b.created_at>=? LIMIT 20000`).bind(since).all()).results;
  const mapped = [];
  for (const item of items) {
    let sourceKey = item.snap_key, variant = item.snap_variant || '';
    if (!sourceKey && item.var_key) { sourceKey = item.var_key; variant = item.var_external; }
    if (!sourceKey && item.peer_url) { try { sourceKey = photoCopyKey(item.peer_url); } catch { sourceKey = item.source_id; } variant = ''; }
    if (sourceKey) mapped.push({ ...item, source_key: sourceKey, variant_id: variant, style_id: item.style_id || '' });
  }
  return mapped;
}

export async function refreshCopyPerformance(env, now = Date.now(), deps = {}) {
  const db = env.DB, since = now - EVOLUTION.windowDays * 86400000;
  const mapped = await loadResolvedItems(db, since);
  const records = mapped.length ? (await db.prepare(`SELECT value_json FROM factory_publish_records
    WHERE json_extract(value_json,'$.autoTaskId') IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(mapped.map(i => i.id))).all()).results.map(r => parseObject(r.value_json)) : [];
  const accounts = deps.accounts || scopedAnalyticsAccounts(accountsFromLatestArchive(await listLatestArchiveAccounts(db)), await loadGroupStore(db), null, 'psychology');
  const needed = new Set(mapped.map(i => i.connection_id));
  const relevant = accounts.filter(a => [a.schema, a.connectionId, String(a.schema || '').replace(/^tiktok:/, '')].some(k => needed.has(k)));
  const videosByAccount = deps.videosByAccount || await loadVideosForAccounts(env, db, relevant.map(a => a.schema), 100);
  const { rows } = buildContentPerformance({ items: mapped, records, accounts: relevant, videosByAccount, now });
  const ownerOf = new Map(mapped.map(i => [i.id, i.owner]));
  const totals = new Map();
  for (const item of mapped) {
    const key = item.owner + '\u0000' + statKey(item.source_key, item.variant_id);
    const t = totals.get(key) || { owner: item.owner, sourceKey: item.source_key, variantId: item.variant_id, posts: 0, mature: 0, viewsSum: 0 };
    t.posts++; totals.set(key, t);
  }
  for (const row of rows) {
    if (!row.mature || row.views == null) continue;
    const t = totals.get(ownerOf.get(row.id) + '\u0000' + statKey(row.source, row.variant));
    if (t) { t.mature++; t.viewsSum += row.views; }
  }
  const values = [...totals.values()].map(t => ({ ...t, avgViews: t.mature ? t.viewsSum / t.mature : null }));
  await db.batch([
    db.prepare('DELETE FROM psychology_copy_performance'),
    db.prepare(`INSERT INTO psychology_copy_performance(owner,source_key,variant_id,posts,mature,views_sum,avg_views,updated_at)
      SELECT json_extract(value,'$.owner'),json_extract(value,'$.sourceKey'),json_extract(value,'$.variantId'),json_extract(value,'$.posts'),
        json_extract(value,'$.mature'),json_extract(value,'$.viewsSum'),json_extract(value,'$.avgViews'),? FROM json_each(?)`).bind(now, JSON.stringify(values)),
  ]);
  return { items: mapped.length, versions: values.length, judged: values.filter(v => v.mature >= EVOLUTION.matureNeeded).length };
}
