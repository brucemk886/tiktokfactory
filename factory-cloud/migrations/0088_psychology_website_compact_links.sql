-- Random five-character public aliases; original codes remain the analytics identity.
CREATE TABLE psychology_website_link_aliases (
 code TEXT PRIMARY KEY REFERENCES psychology_website_links(code),
 short_code TEXT UNIQUE CHECK(short_code IS NULL OR (length(short_code)=5 AND short_code GLOB '[1-9][0-9a-z][0-9a-z][0-9a-z][0-9a-z]'))
);
-- Allocate inside the insert transaction, retry collisions, never save an incomplete alias.
CREATE TRIGGER psychology_website_link_alias_allocate
AFTER INSERT ON psychology_website_link_aliases WHEN NEW.short_code IS NULL BEGIN
 UPDATE OR IGNORE psychology_website_link_aliases SET short_code=CAST(1+abs(random()%9) AS TEXT) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1)
 WHERE code=NEW.code AND short_code IS NULL;
 UPDATE OR IGNORE psychology_website_link_aliases SET short_code=CAST(1+abs(random()%9) AS TEXT) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1)
 WHERE code=NEW.code AND short_code IS NULL;
 UPDATE OR IGNORE psychology_website_link_aliases SET short_code=CAST(1+abs(random()%9) AS TEXT) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1)
 WHERE code=NEW.code AND short_code IS NULL;
 UPDATE OR IGNORE psychology_website_link_aliases SET short_code=CAST(1+abs(random()%9) AS TEXT) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1)
 WHERE code=NEW.code AND short_code IS NULL;
 UPDATE OR IGNORE psychology_website_link_aliases SET short_code=CAST(1+abs(random()%9) AS TEXT) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1) || substr('0123456789abcdefghijklmnopqrstuvwxyz',1+abs(random()%36),1)
 WHERE code=NEW.code AND short_code IS NULL;
 SELECT RAISE(ABORT,'Short link allocation failed') WHERE EXISTS(SELECT 1 FROM psychology_website_link_aliases WHERE code=NEW.code AND short_code IS NULL);
END;
INSERT INTO psychology_website_link_aliases(code)
 SELECT code FROM psychology_website_links ORDER BY created_at,code;
CREATE TRIGGER psychology_website_link_alias_insert
AFTER INSERT ON psychology_website_links BEGIN
 INSERT INTO psychology_website_link_aliases(code) VALUES(NEW.code);
END;
