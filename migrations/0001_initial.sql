-- Initial schema for the .co.uk Domain Drop Research Tool.
-- All timestamps are ISO-8601 UTC strings; dates are YYYY-MM-DD (UTC).

-- ---------------------------------------------------------------------------
-- Import batches: one row per attempted drop-list import.
-- ---------------------------------------------------------------------------
CREATE TABLE import_batches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source            TEXT    NOT NULL,              -- 'nominet' | 'upload'
  source_url        TEXT,
  checksum          TEXT,                          -- sha256 (hex) of the raw file
  r2_key            TEXT,                          -- archived raw file, if stored
  drop_date         TEXT,                          -- earliest drop date in the file
  total_records     INTEGER NOT NULL DEFAULT 0,    -- data rows in the file
  inserted_records  INTEGER NOT NULL DEFAULT 0,    -- domains new to the database
  duplicate_records INTEGER NOT NULL DEFAULT 0,    -- already known or repeated in file
  failed_records    INTEGER NOT NULL DEFAULT 0,    -- rows that failed validation
  skipped_records   INTEGER NOT NULL DEFAULT 0,    -- valid rows outside supported TLDs
  removed_records   INTEGER NOT NULL DEFAULT 0,    -- domains no longer on the list
  status            TEXT    NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  error_message     TEXT,
  started_at        TEXT    NOT NULL,
  completed_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Checksum lookup for idempotency (a file already completed is skipped unless forced;
-- domains.domain UNIQUE guarantees re-imports never duplicate rows).
CREATE INDEX idx_import_batches_checksum ON import_batches (checksum, status);
-- Only one import may run at a time (acts as a lock).
CREATE UNIQUE INDEX idx_import_batches_single_running
  ON import_batches (status) WHERE status = 'running';
CREATE INDEX idx_import_batches_created_at ON import_batches (created_at DESC);

-- ---------------------------------------------------------------------------
-- Domains: one row per unique domain ever seen on a drop list.
-- Lexical features and the latest research metrics are denormalised here so
-- the main table can be filtered and sorted with indexes and without joins.
-- ---------------------------------------------------------------------------
CREATE TABLE domains (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  domain                   TEXT    NOT NULL UNIQUE,
  tld                      TEXT    NOT NULL,          -- e.g. 'co.uk'
  sld                      TEXT    NOT NULL,          -- label before the TLD
  length                   INTEGER NOT NULL,          -- characters in sld
  hyphens                  INTEGER NOT NULL,
  digits                   INTEGER NOT NULL,
  roid                     TEXT,
  drop_date                TEXT,                      -- YYYY-MM-DD (UTC)
  drop_time                TEXT,                      -- full UTC timestamp when known
  status                   TEXT    NOT NULL DEFAULT 'listed'
                           CHECK (status IN ('listed', 'removed', 'dropped')),
  user_status              TEXT    NOT NULL DEFAULT 'none'
                           CHECK (user_status IN ('none', 'shortlisted', 'ignored', 'registered', 'sold')),
  research_status          TEXT    NOT NULL DEFAULT 'none'
                           CHECK (research_status IN ('none', 'pending', 'processing', 'completed', 'failed')),
  last_researched_at       TEXT,
  latest_metrics_id        INTEGER,
  latest_backlinks         INTEGER,
  latest_referring_domains INTEGER,
  latest_referring_pages   INTEGER,
  latest_organic_traffic   REAL,
  latest_organic_keywords  INTEGER,
  latest_traffic_value     REAL,
  latest_authority         REAL,
  research_score           INTEGER,
  first_seen_at            TEXT    NOT NULL,
  last_seen_at             TEXT    NOT NULL,
  last_import_batch_id     INTEGER,
  created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Default listing: by drop date, then alphabetical.
CREATE INDEX idx_domains_drop_date_domain ON domains (drop_date, domain);
CREATE INDEX idx_domains_status ON domains (status, drop_date);
CREATE INDEX idx_domains_created_at ON domains (created_at);
CREATE INDEX idx_domains_user_status ON domains (user_status);
CREATE INDEX idx_domains_research_status ON domains (research_status, last_researched_at);
CREATE INDEX idx_domains_length ON domains (length);
CREATE INDEX idx_domains_last_import_batch ON domains (last_import_batch_id);
-- Sortable SEO columns (latest snapshot).
CREATE INDEX idx_domains_latest_rd ON domains (latest_referring_domains);
CREATE INDEX idx_domains_latest_backlinks ON domains (latest_backlinks);
CREATE INDEX idx_domains_latest_traffic ON domains (latest_organic_traffic);
CREATE INDEX idx_domains_latest_keywords ON domains (latest_organic_keywords);
CREATE INDEX idx_domains_research_score ON domains (research_score);

-- ---------------------------------------------------------------------------
-- Dated metric snapshots. Never overwritten: every research run inserts a row.
-- ---------------------------------------------------------------------------
CREATE TABLE domain_metrics (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id         INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,
  metric_date       TEXT    NOT NULL,          -- YYYY-MM-DD (UTC)
  backlinks         INTEGER,
  referring_domains INTEGER,
  referring_pages   INTEGER,
  organic_traffic   REAL,
  organic_keywords  INTEGER,
  traffic_value     REAL,
  visibility        REAL,
  authority_metric  REAL,
  spam_score        REAL,
  research_score    INTEGER,
  score_breakdown   TEXT,                      -- JSON
  raw_response      TEXT,                      -- JSON (trimmed provider payloads)
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_domain_metrics_domain_date ON domain_metrics (domain_id, metric_date DESC, id DESC);
CREATE INDEX idx_domain_metrics_referring_domains ON domain_metrics (referring_domains);
CREATE INDEX idx_domain_metrics_backlinks ON domain_metrics (backlinks);
CREATE INDEX idx_domain_metrics_organic_traffic ON domain_metrics (organic_traffic);
CREATE INDEX idx_domain_metrics_organic_keywords ON domain_metrics (organic_keywords);

-- Top ranking keywords captured with a snapshot.
CREATE TABLE domain_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  metrics_id    INTEGER NOT NULL REFERENCES domain_metrics (id) ON DELETE CASCADE,
  domain_id     INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  keyword       TEXT    NOT NULL,
  position      INTEGER,
  search_volume INTEGER,
  etv           REAL,
  url           TEXT
);
CREATE INDEX idx_domain_keywords_metrics ON domain_keywords (metrics_id);

-- Sample of backlinks captured with a snapshot.
CREATE TABLE domain_backlinks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  metrics_id       INTEGER NOT NULL REFERENCES domain_metrics (id) ON DELETE CASCADE,
  domain_id        INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  referring_domain TEXT,
  source_url       TEXT,
  target_url       TEXT,
  anchor           TEXT,
  link_type        TEXT,                        -- 'dofollow' | 'nofollow'
  domain_rank      REAL,
  first_seen       TEXT
);
CREATE INDEX idx_domain_backlinks_metrics ON domain_backlinks (metrics_id);

-- Provider-reported monthly history (e.g. historical organic traffic).
CREATE TABLE domain_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id         INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  provider          TEXT    NOT NULL,
  month             TEXT    NOT NULL,          -- YYYY-MM
  organic_traffic   REAL,
  organic_keywords  INTEGER,
  backlinks         INTEGER,
  referring_domains INTEGER,
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (domain_id, provider, month)
);

-- ---------------------------------------------------------------------------
-- Research queue.
-- ---------------------------------------------------------------------------
CREATE TABLE research_jobs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id        INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  job_type         TEXT    NOT NULL DEFAULT 'full',
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority         INTEGER NOT NULL DEFAULT 0,
  attempts         INTEGER NOT NULL DEFAULT 0,
  provider_task_id TEXT,                        -- reserved for task-based provider endpoints
  error_message    TEXT,
  next_attempt_at  TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at       TEXT,
  completed_at     TEXT
);

-- Dequeue order.
CREATE INDEX idx_research_jobs_dequeue ON research_jobs (status, priority DESC, created_at);
CREATE INDEX idx_research_jobs_created_at ON research_jobs (created_at);
CREATE INDEX idx_research_jobs_domain ON research_jobs (domain_id);
-- At most one active job per domain.
CREATE UNIQUE INDEX idx_research_jobs_one_active
  ON research_jobs (domain_id) WHERE status IN ('pending', 'processing');

-- Daily usage counters used to enforce the configurable daily limit.
CREATE TABLE research_usage (
  day            TEXT PRIMARY KEY,            -- YYYY-MM-DD (UTC)
  domains        INTEGER NOT NULL DEFAULT 0,
  provider_calls INTEGER NOT NULL DEFAULT 0,
  cost           REAL    NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- User curation.
-- ---------------------------------------------------------------------------
CREATE TABLE favourites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id  INTEGER NOT NULL UNIQUE REFERENCES domains (id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id  INTEGER NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  note       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_notes_domain ON notes (domain_id, created_at DESC);

CREATE TABLE saved_filters (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  configuration_json TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- Application settings (queue state, limits, scoring weights). JSON values.
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Starter saved filters.
INSERT INTO saved_filters (name, configuration_json) VALUES
  ('Short Domains', '{"maxLength":8,"maxHyphens":0,"hasNumbers":false}'),
  ('Brandable', '{"minLength":4,"maxLength":10,"maxHyphens":0,"hasNumbers":false}'),
  ('Backlink Rich', '{"minReferringDomains":50,"research":"completed"}'),
  ('High Authority', '{"minReferringDomains":100,"minBacklinks":500,"research":"completed"}'),
  ('Traffic Drops', '{"minOrganicTraffic":100,"research":"completed"}');
