// Every photo job starts its own workflow the moment a batch is created, so a
// 70-post batch used to put 23 concurrent requests on DeepSeek and it answered
// none of them. Slots cap how many jobs may talk to the primary model at once.
export const ANALYSIS_CONCURRENCY = 3;
// Longer than one attempt's step budget, so a dead instance cannot hand its
// slot to someone else while its request may still be in flight.
export const ANALYSIS_LEASE_MS = 4 * 60000;

export async function claimAnalysisSlot(db, holder, now = Date.now()) {
  await db.prepare('DELETE FROM psychology_photo_analysis_slots WHERE lease_until<=?').bind(now).run();
  const result = await db.prepare(`INSERT INTO psychology_photo_analysis_slots(holder,lease_until)
    SELECT ?,? WHERE (SELECT COUNT(*) FROM psychology_photo_analysis_slots WHERE holder<>?) < ?
    ON CONFLICT(holder) DO UPDATE SET lease_until=excluded.lease_until`)
    .bind(holder, now + ANALYSIS_LEASE_MS, holder, ANALYSIS_CONCURRENCY).run();
  return Boolean(result.meta?.changes);
}

export async function releaseAnalysisSlot(db, holder) {
  await db.prepare('DELETE FROM psychology_photo_analysis_slots WHERE holder=?').bind(holder).run();
}
