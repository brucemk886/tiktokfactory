ALTER TABLE factory_users ADD COLUMN allowed_account_groups_json TEXT NOT NULL DEFAULT '[]';
