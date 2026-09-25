-- Heuristic word count per domain label (NULL = could not be segmented).
-- Filled in by the importer; existing rows get it on the next full import.
ALTER TABLE domains ADD COLUMN word_count INTEGER;
CREATE INDEX idx_domains_word_count ON domains (word_count, drop_date);
