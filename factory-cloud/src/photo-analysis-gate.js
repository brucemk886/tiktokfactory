// Every photo job starts its own workflow the moment a batch is created, so a
// 70-post batch used to put 23 concurrent requests on DeepSeek and it answered
// none of them. Slots cap how many jobs may talk to the primary model at once,
// and the queue is served oldest job first rather than whoever polls in time.
export const ANALYSIS_CONCURRENCY = 10;
export const ANALYSIS_LEASE_MS = 4 * 60000;
// A waiter that stops polling must not hold up every job created after it.
export const ANALYSIS_WAIT_LEASE_MS = 60000;

export async function claimAnalysisSlot(db, holder, rank = 0, now = Date.now()) {
  await db.prepare('DELETE FROM psychology_photo_analysis_slots WHERE lease_until<=?').bind(now).run();
  await db.prepare(`INSERT INTO psychology_photo_analysis_slots(holder,rank_at,running,lease_until) VALUES(?,?,0,?)
    ON CONFLICT(holder) DO UPDATE SET lease_until=CASE WHEN running=1 THEN lease_until ELSE excluded.lease_until END`)
    .bind(holder, rank, now + ANALYSIS_WAIT_LEASE_MS).run();
  const result = await db.prepare(`UPDATE psychology_photo_analysis_slots SET running=1,lease_until=?
    WHERE holder=?
      AND (SELECT COUNT(*) FROM psychology_photo_analysis_slots WHERE running=1 AND holder<>?) < ?
      AND NOT EXISTS (SELECT 1 FROM psychology_photo_analysis_slots waiting
        WHERE waiting.running=0 AND waiting.holder<>?
          AND (waiting.rank_at<? OR (waiting.rank_at=? AND waiting.holder<?)))`)
    .bind(now + ANALYSIS_LEASE_MS, holder, holder, ANALYSIS_CONCURRENCY, holder, rank, rank, holder).run();
  return Boolean(result.meta?.changes);
}

export async function releaseAnalysisSlot(db, holder) {
  await db.prepare('DELETE FROM psychology_photo_analysis_slots WHERE holder=?').bind(holder).run();
}
