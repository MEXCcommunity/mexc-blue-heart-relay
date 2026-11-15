ALTER TABLE relay_pixels ADD COLUMN mexc_uid_at INTEGER;

CREATE TABLE campaign_visitors (
  browser TEXT PRIMARY KEY,
  arrived_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('direct', 'x', 'telegram', 'discord', 'email', 'community', 'partner', 'other', 'relay')),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  clicked_at INTEGER
) WITHOUT ROWID;

CREATE INDEX campaign_visitors_arrived_at ON campaign_visitors (arrived_at);
