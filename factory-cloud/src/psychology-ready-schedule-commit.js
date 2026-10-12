// Commit ready-material reservations and scheduler ownership in one transaction.
export function readyScheduleStatements(db, internal, batchId, connectionIds, stamp) {
 if (!internal.scheduleWork) return [];
 const {id,token}=internal.scheduleWork;
 return [
  db.prepare('INSERT INTO psychology_schedule_commits(batch_id,work_id,lease_token,checked_at) VALUES(?,?,?,?)').bind(batchId,id,token,stamp),
  ...connectionIds.map((connectionId,index)=>db.prepare("UPDATE psychology_schedule_members SET status='created',item_id=?,reason='',updated_at=? WHERE work_id=? AND connection_id=? AND status='pending'").bind(batchId+'-'+String(index).padStart(3,'0'),stamp,id,connectionId)),
  db.prepare("UPDATE psychology_autopilot_slots SET batch_id=CASE WHEN batch_id='' THEN ? WHEN instr(','||batch_id||',',','||?||',')>0 THEN batch_id ELSE batch_id||','||? END,updated_at=? WHERE (autopilot_id,slot_at)=(SELECT pilot_id,slot_at FROM psychology_schedule_work WHERE id=?)").bind(batchId,batchId,batchId,stamp,id),
 ];
}
