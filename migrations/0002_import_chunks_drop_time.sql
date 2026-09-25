-- Resumable imports and drop-time ordering.
-- Additive only: safe to apply before deploying the code that uses it.

-- Import progress: a batch is prepared once, then loaded chunk by chunk
-- across several Worker invocations (cron ticks), then finalised.
ALTER TABLE import_batches ADD COLUMN phase TEXT;                         -- 'loading' | 'finalising' | NULL
ALTER TABLE import_batches ADD COLUMN chunk_count INTEGER;
ALTER TABLE import_batches ADD COLUMN chunks_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN valid_records INTEGER;
ALTER TABLE import_batches ADD COLUMN in_file_duplicates INTEGER;
ALTER TABLE import_batches ADD COLUMN domains_before INTEGER;
ALTER TABLE import_batches ADD COLUMN mark_missing INTEGER NOT NULL DEFAULT 1;
ALTER TABLE import_batches ADD COLUMN import_timestamp TEXT;             -- last_seen_at written for this import
ALTER TABLE import_batches ADD COLUMN heartbeat_at TEXT;                 -- last progress; used for stale detection

-- Parsed, validated rows waiting to be upserted (deleted when the batch finishes).
CREATE TABLE import_chunks (
  batch_id    INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  rows_json   TEXT    NOT NULL,
  PRIMARY KEY (batch_id, chunk_index)
);

-- List domains in the order they drop within a day.
CREATE INDEX idx_domains_drop_date_time ON domains (drop_date, drop_time);
