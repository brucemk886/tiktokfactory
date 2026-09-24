ALTER TABLE psychology_peer_hits ADD COLUMN comments_note TEXT NOT NULL DEFAULT '';
-- Store prospects only; no existing account should enter the external collection list.
UPDATE psychology_peer_watch_accounts SET enabled=0;
CREATE TRIGGER psychology_peer_watch_limit BEFORE INSERT ON psychology_peer_watch_accounts
WHEN (SELECT COUNT(*) FROM psychology_peer_watch_accounts)>=100 AND NOT EXISTS(SELECT 1 FROM psychology_peer_watch_accounts WHERE username=NEW.username)
BEGIN SELECT RAISE(ABORT,'对标账号最多 100 个。'); END;
