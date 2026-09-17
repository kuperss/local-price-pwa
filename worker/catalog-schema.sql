CREATE TABLE IF NOT EXISTS product_metadata (
 snapshot TEXT NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL,
 sale TEXT NOT NULL, discontinued TEXT NOT NULL,
 shipping REAL, a2 REAL, available REAL, incoming REAL,
 eta TEXT NOT NULL, transfer TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '',
 issue TEXT NOT NULL DEFAULT '', PRIMARY KEY(snapshot,sku)
);
CREATE TABLE IF NOT EXISTS catalog_rules (
 sku TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 note TEXT NOT NULL DEFAULT '', targets TEXT NOT NULL DEFAULT '[]',
 replace_old INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_members (
 version TEXT NOT NULL, sku TEXT NOT NULL, PRIMARY KEY(version,sku)
);
CREATE TABLE IF NOT EXISTS catalog_publications (
 version TEXT PRIMARY KEY, revision TEXT NOT NULL, report TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_catalog_audit_time ON admin_audit(created_at);
