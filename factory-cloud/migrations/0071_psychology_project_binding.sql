ALTER TABLE psychology_task_group_policies ADD COLUMN enrollment_mode TEXT NOT NULL DEFAULT 'selected' CHECK(enrollment_mode IN ('selected','project'));
ALTER TABLE psychology_task_group_accounts ADD COLUMN legacy_member INTEGER NOT NULL DEFAULT 0 CHECK(legacy_member IN (0,1));
-- Only the original enrolled cohort may continue its old pre-cycle delivery.
UPDATE psychology_task_group_accounts SET legacy_member=1 WHERE enrolled=1 AND excluded=0
 AND EXISTS(SELECT 1 FROM psychology_task_group_policies p JOIN psychology_task_group_snapshots s ON s.policy_id=p.id
  WHERE p.id=psychology_task_group_accounts.policy_id AND s.connection_id=psychology_task_group_accounts.connection_id
   AND s.revision=1 AND s.effective_at=p.starts_at AND psychology_task_group_accounts.first_seen_at<=p.created_at);
