CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX admin_sessions_expires_at ON admin_sessions (expires_at);

CREATE TABLE admin_login_limits (
  client_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX admin_login_limits_expires_at ON admin_login_limits (expires_at);
