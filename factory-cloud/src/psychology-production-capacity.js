const MINUTE = 60000, HOUR = 60 * MINUTE;

// Plan with half the 20 physical consumers. These conservative budgets do not
// assert that the hub or TikTok guarantees the corresponding throughput.
export const PRODUCTION_POLICY = Object.freeze({
  version: 'adaptive-v1', minLeadMs: 2 * HOUR, maxLeadMs: 3 * HOUR,
  roundMs: 15 * MINUTE, effectiveParallel: 10, bufferMs: 45 * MINUTE,
  minServiceMs: MINUTE, fallbackServiceMs: 5 * MINUTE,
  minSamples: 20, maxSamples: 200, sampleWindowMs: 7 * 24 * HOUR,
  slotWindowMs: 90 * MINUTE,
});

function integer(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError(name + ' must be a non-negative safe integer');
  return value;
}
const validDuration = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const safeSum = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);

// Count only the item's current job_id, never both source and render child.
// The second branch includes other work using the same physical cloud queue.
export async function readProductionLoad(db, now = Date.now()) {
  integer(now, 'now');
  const [pending, samples] = await Promise.all([
    db.prepare("SELECT DISTINCT j.id,j.created_by owner,j.status,j.available_at availableAt,i.schedule_at*1000 scheduleAt FROM factory_jobs j JOIN psychology_publish_items i ON i.job_id=j.id LEFT JOIN psychology_publish_groups g ON g.id=i.publish_group_id WHERE j.status IN ('queued','running') AND i.deleted_at=0 AND i.ready_json='{}' AND i.receipt_json='{}' AND (g.id IS NULL OR (g.request_json='{}' AND g.response_json='{}' AND g.status='waiting')) AND (json_extract(j.payload_json,'$.cloudPhotoRender')=1 OR (j.type='psychology-photo-story' AND json_extract(j.payload_json,'$.psychologyAutomation.cloudPhotoRender')=1)) UNION ALL SELECT j.id,j.created_by owner,j.status,j.available_at availableAt,COALESCE(json_extract(j.payload_json,'$.psychologyAutomation.scheduleAt')*1000,0) scheduleAt FROM factory_jobs j WHERE j.status IN ('queued','running') AND json_extract(j.payload_json,'$.cloudPhotoRender')=1 AND NOT EXISTS(SELECT 1 FROM psychology_publish_items i WHERE i.job_id=j.id OR i.id=j.id OR i.id=json_extract(j.payload_json,'$.psychologyAutomation.id'))").all(),
    db.prepare("SELECT json_extract(result_json,'$.elapsedMs') elapsedMs FROM factory_jobs WHERE status='done' AND error='' AND completed_at>=? AND completed_at<=? AND json_extract(payload_json,'$.cloudPhotoRender')=1 AND json_extract(payload_json,'$.photoAutomation')=1 AND json_type(result_json,'$.elapsedMs') IN ('integer','real') AND json_extract(result_json,'$.elapsedMs')>0 AND json_extract(result_json,'$.elapsedMs')<=? ORDER BY completed_at DESC,id DESC LIMIT ?")
      .bind(Math.max(0, now - PRODUCTION_POLICY.sampleWindowMs), now, Number.MAX_SAFE_INTEGER, PRODUCTION_POLICY.maxSamples).all(),
  ]);
  const jobs = [...new Map(pending.results.map(row => [row.id, {
    id: row.id, owner: String(row.owner || ''), status: row.status,
    availableAt: Number(row.availableAt) || 0, scheduleAt: Number(row.scheduleAt) || 0,
  }])).values()];
  const sampleMs = samples.results.map(row => row.elapsedMs).filter(validDuration);
  return { asOf: now, jobs, sampleMs, sampleCount: sampleMs.length };
}

// Local membership is a conservative forecast, not publishing authorization.
export async function readProductionAccountCounts(db, now = Date.now()) {
  integer(now, 'now');
  const rows = await db.prepare("WITH members AS (SELECT p.owner,a.connection_id FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.status='active' AND p.ends_at>? AND a.status='active' UNION SELECT p.owner,a.connection_id FROM psychology_task_group_accounts a JOIN psychology_task_group_policies p ON p.id=a.policy_id WHERE p.enabled=1 AND p.ends_at>? AND a.enrolled=1 AND a.excluded=0 AND a.paused=0) SELECT m.owner,COUNT(*) accountCount FROM members m WHERE COALESCE((SELECT a.status FROM psychology_autopilot_accounts a JOIN psychology_autopilots p ON p.id=a.autopilot_id WHERE p.owner=m.owner AND a.connection_id=m.connection_id ORDER BY a.updated_at DESC,p.updated_at DESC,a.autopilot_id LIMIT 1),'active')<>'paused' AND NOT EXISTS(SELECT 1 FROM psychology_task_group_accounts a JOIN psychology_task_group_policies p ON p.id=a.policy_id WHERE p.owner=m.owner AND p.enabled=1 AND p.ends_at>? AND a.connection_id=m.connection_id AND a.paused=1) GROUP BY m.owner ORDER BY m.owner").bind(now, now, now).all();
  return Object.fromEntries(rows.results.map(row => [row.owner, Number(row.accountCount)]));
}

// Forecast rows represent independent group/rounds; callers avoid duplicates.
// accountCount is this owner's whole-round population, not the current chunk.
export function estimateProductionLead(load = {}, { accountCount = 0, slotAt = 0, owner = '', now = Date.now() } = {}) {
  integer(now, 'now'); integer(slotAt, 'slotAt'); integer(accountCount, 'accountCount');
  if (typeof owner !== 'string') throw new TypeError('owner must be a string');
  const center = slotAt || now + PRODUCTION_POLICY.maxLeadMs;
  const start = center - PRODUCTION_POLICY.slotWindowMs, end = center + PRODUCTION_POLICY.slotWindowMs;
  const scheduled = new Map(), forecast = new Map();
  let backlogJobs = 0;
  const seen = new Set();
  for (const job of load.jobs || []) {
    if (!job || !job.id || seen.has(job.id) || !['queued', 'running'].includes(job.status)) continue;
    seen.add(job.id);
    const at = Number(job.scheduleAt) || 0, who = String(job.owner || '');
    if (at >= start && at <= end) scheduled.set(who, safeSum(scheduled.get(who) || 0, 1));
    else if (!Number.isFinite(at) || at <= 0 || at < start || job.status === 'running' || Number(job.availableAt) <= now) backlogJobs++;
  }
  if (Array.isArray(load.forecasts)) {
    for (const item of load.forecasts) {
      if (!item) continue;
      integer(item.slotAt, 'forecast.slotAt'); integer(item.accountCount, 'forecast.accountCount');
      if (item.slotAt < start || item.slotAt > end) continue;
      const who = String(item.owner || '');
      forecast.set(who, safeSum(forecast.get(who) || 0, item.accountCount));
    }
  } else {
    for (const [who, value] of Object.entries(load.accountCounts || {})) forecast.set(who, integer(value, 'accountCounts'));
  }
  forecast.set(owner, Math.max(forecast.get(owner) || 0, accountCount));
  let forecastJobs = 0;
  for (const who of new Set([...scheduled.keys(), ...forecast.keys()])) {
    forecastJobs = safeSum(forecastJobs, Math.max(scheduled.get(who) || 0, forecast.get(who) || 0));
  }
  const durations = (load.sampleMs || []).filter(validDuration).slice(0, PRODUCTION_POLICY.maxSamples).sort((a, b) => a - b);
  const sampleCount = durations.length, p95 = sampleCount ? durations[Math.ceil(sampleCount * 0.95) - 1] : 0;
  const serviceMs = Math.max(PRODUCTION_POLICY.minServiceMs, p95, sampleCount < PRODUCTION_POLICY.minSamples ? PRODUCTION_POLICY.fallbackServiceMs : 0);
  const waves = Math.ceil(safeSum(backlogJobs, forecastJobs) / PRODUCTION_POLICY.effectiveParallel);
  const rawLead = Math.min(Number.MAX_SAFE_INTEGER, waves * serviceMs + PRODUCTION_POLICY.bufferMs);
  const requiredLeadMs = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(Math.max(PRODUCTION_POLICY.minLeadMs, rawLead) / PRODUCTION_POLICY.roundMs) * PRODUCTION_POLICY.roundMs);
  const leadMs = Math.min(PRODUCTION_POLICY.maxLeadMs, requiredLeadMs);
  const capacityRisk = requiredLeadMs > PRODUCTION_POLICY.maxLeadMs;
  const shortLead = slotAt > 0 && slotAt - now < requiredLeadMs;
  const reason = [sampleCount < PRODUCTION_POLICY.minSamples ? '历史样本不足，使用保守制作预算' : '按近期制作与上传耗时 P95 估算',
    capacityRisk ? '预计制作需求超过 3 小时提前上限' : '', shortLead ? '距离发布不足预计制作时间' : ''].filter(Boolean).join('；');
  return { policy: PRODUCTION_POLICY.version, asOf: now, leadMs, requiredLeadMs, forecastJobs, backlogJobs,
    accountCount, sampleCount, serviceMs, capacityRisk, shortLead, reason };
}
