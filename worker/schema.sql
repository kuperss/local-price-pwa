CREATE TABLE IF NOT EXISTS devices (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revoked')),
 created_at TEXT NOT NULL, approved_at TEXT, revoked_at TEXT, last_seen TEXT,
 user_agent TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS nonces(device_id TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(device_id,nonce));
CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires);
CREATE TABLE IF NOT EXISTS events (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL, kind TEXT NOT NULL,
 query TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL DEFAULT '', result_count INTEGER,
 occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, offline INTEGER NOT NULL DEFAULT 0,
 version TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_device_time ON events(device_id,occurred_at);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL, sku TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT,
 UNIQUE(device_id,sku)
);
CREATE INDEX IF NOT EXISTS idx_requests_sku ON requests(sku);
CREATE TABLE IF NOT EXISTS catalog (
 sku TEXT PRIMARY KEY, source TEXT NOT NULL, approved_at TEXT NOT NULL,
 included_version TEXT, resolution TEXT NOT NULL DEFAULT 'awaiting', resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS bundles (
 version TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, published_at TEXT NOT NULL,
 product_count INTEGER NOT NULL, key_b64 TEXT NOT NULL, iv_b64 TEXT NOT NULL,
 content_hash TEXT NOT NULL, chunks INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bundle_chunks(version TEXT NOT NULL, seq INTEGER NOT NULL, content TEXT NOT NULL, PRIMARY KEY(version,seq));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_audit(id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registration_limits(bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
