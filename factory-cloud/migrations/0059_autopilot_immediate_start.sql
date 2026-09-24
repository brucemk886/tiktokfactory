-- Explicit first-day short-notice start; normal days retain the two-hour lead.
ALTER TABLE psychology_autopilots ADD COLUMN start_now INTEGER NOT NULL DEFAULT 0 CHECK(start_now IN (0,1));
