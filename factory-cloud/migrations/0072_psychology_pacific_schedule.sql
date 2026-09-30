ALTER TABLE psychology_task_group_policies ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE psychology_task_group_policies ADD COLUMN prestart_cutoff_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE psychology_autopilots ADD COLUMN schedule_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE psychology_autopilots ADD COLUMN pending_schedule_timezone TEXT NOT NULL DEFAULT '';
-- beijing_date is the legacy column name; new claims contain the policy-local date.
ALTER TABLE psychology_task_group_allocations ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
