import type { ImportBatchDto } from "../../shared/api";
import { lexicalFeatures, parseDomain, SUPPORTED_TLDS, type TldPolicy } from "../../shared/domain";
import { toImportBatchDto, type ImportBatchDbRow } from "../db/rows";
import { parseDropListLines, readLines, toTextStream } from "../providers/nominet/parse";
import type { DropListProvider, DropListSource } from "../providers/types";
import { sha256Hex } from "../utils/crypto";
import { AppError, errorMessage } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Drop-list import pipeline:
 * checksum check → download → verify → archive (R2) → stream-parse →
 * normalise/validate/dedupe → chunked upserts → mark missing → complete batch.
 *
 * Idempotent: a file whose checksum already has a completed batch is skipped,
 * and domains are upserted on their UNIQUE name, so re-imports never duplicate.
 */

/** Rows per upsert statement (sent as one JSON parameter). */
const ROWS_PER_STATEMENT = 500;
/** Statements per D1 batch round-trip. */
const STATEMENTS_PER_BATCH = 8;
/** A running batch older than this is assumed dead (e.g. Worker evicted). */
const STALE_RUNNING_MS = 30 * 60 * 1000;

export type ImportOutcome = "imported" | "unchanged";

export interface ImportResult {
  outcome: ImportOutcome;
  message: string;
  batch: ImportBatchDto | null;
}

export interface ImportOptions {
  /** Import even if this checksum was already imported. */
  force?: boolean;
  /** Mark listed domains absent from this file as removed/dropped (true for full lists). */
  markMissing?: boolean;
  tlds?: readonly TldPolicy[];
  now?: () => Date;
}

interface ImportDeps {
  db: D1Database;
  archive?: R2Bucket;
}

type DomainTuple = [
  domain: string,
  tld: string,
  sld: string,
  length: number,
  hyphens: number,
  digits: number,
  roid: string | null,
  dropDate: string | null,
  dropTime: string | null,
];

const UPSERT_SQL = `
INSERT INTO domains (domain, tld, sld, length, hyphens, digits, roid, drop_date, drop_time, status,
                     first_seen_at, last_seen_at, last_import_batch_id, created_at, updated_at)
SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
       json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'),
       json_extract(j.value, '$[6]'), json_extract(j.value, '$[7]'), json_extract(j.value, '$[8]'),
       'listed', ?2, ?2, ?3, ?2, ?2
FROM json_each(?1) AS j
WHERE true
ON CONFLICT(domain) DO UPDATE SET
  roid = COALESCE(excluded.roid, domains.roid),
  drop_date = COALESCE(excluded.drop_date, domains.drop_date),
  drop_time = COALESCE(excluded.drop_time, domains.drop_time),
  status = 'listed',
  last_seen_at = excluded.last_seen_at,
  last_import_batch_id = excluded.last_import_batch_id,
  updated_at = excluded.updated_at`;

export async function getImportBatch(db: D1Database, id: number): Promise<ImportBatchDto | null> {
  const row = await db.prepare("SELECT * FROM import_batches WHERE id = ?").bind(id).first<ImportBatchDbRow>();
  return row ? toImportBatchDto(row) : null;
}

export async function listImportBatches(db: D1Database, limit = 50, offset = 0): Promise<ImportBatchDto[]> {
  const { results } = await db
    .prepare("SELECT * FROM import_batches ORDER BY id DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<ImportBatchDbRow>();
  return results.map(toImportBatchDto);
}

export async function getLastCompletedImport(db: D1Database): Promise<ImportBatchDto | null> {
  const row = await db
    .prepare("SELECT * FROM import_batches WHERE status = 'completed' ORDER BY id DESC LIMIT 1")
    .first<ImportBatchDbRow>();
  return row ? toImportBatchDto(row) : null;
}

async function checksumAlreadyImported(db: D1Database, checksum: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM import_batches WHERE checksum = ? AND status = 'completed' LIMIT 1")
    .bind(checksum)
    .first();
  return row !== null;
}

async function failStaleBatches(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_RUNNING_MS).toISOString();
  await db
    .prepare(
      `UPDATE import_batches SET status = 'failed', completed_at = ?1,
         error_message = 'Import did not finish (worker stopped). Previous data remains available.'
       WHERE status = 'running' AND started_at < ?2`,
    )
    .bind(now.toISOString(), cutoff)
    .run();
}

async function createBatch(db: D1Database, source: string, sourceUrl: string | null, now: Date): Promise<number> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO import_batches (source, source_url, status, started_at, created_at)
         VALUES (?1, ?2, 'running', ?3, ?3) RETURNING id`,
      )
      .bind(source, sourceUrl, now.toISOString())
      .first<{ id: number }>();
    if (!row) throw new Error("Failed to create import batch");
    return row.id;
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(errorMessage(error))) {
      throw new AppError(409, "import_running", "An import is already running. Please wait for it to finish.");
    }
    throw error;
  }
}

async function countDomains(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM domains").first<{ n: number }>();
  return row?.n ?? 0;
}

/** Cheap pre-check used by the cron: is there a list we have not imported yet? */
export async function hasNewDropList(db: D1Database, provider: DropListProvider): Promise<boolean> {
  const checksum = await provider.getLatestChecksum();
  if (!checksum) return true; // cannot tell cheaply; the full import will dedupe by content hash
  return !(await checksumAlreadyImported(db, checksum));
}

/** Downloads from the provider and imports. */
export async function importFromProvider(
  deps: ImportDeps,
  provider: DropListProvider,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const now = options.now ?? (() => new Date());
  if (!options.force) {
    let isNew: boolean;
    try {
      isNew = await hasNewDropList(deps.db, provider);
    } catch (error) {
      // Record the failure so it is visible in import history, then surface a safe error.
      await failStaleBatches(deps.db, now());
      const batchId = await createBatch(deps.db, provider.source, null, now());
      await failBatch(deps.db, batchId, error, now());
      throw toImportFailure(error);
    }
    if (!isNew) {
      logger.info("import.unchanged", { source: provider.source });
      return { outcome: "unchanged", message: "The current drop list has already been imported.", batch: null };
    }
  }
  await failStaleBatches(deps.db, now());
  const batchId = await createBatch(deps.db, provider.source, null, now());
  let source: DropListSource;
  try {
    source = await provider.getLatest();
  } catch (error) {
    await failBatch(deps.db, batchId, error, now());
    throw toImportFailure(error);
  }
  return runImport(deps, batchId, source, options);
}

/** Imports a file supplied directly (manual upload). */
export async function importFromSource(
  deps: ImportDeps,
  source: DropListSource,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const now = options.now ?? (() => new Date());
  await failStaleBatches(deps.db, now());
  const batchId = await createBatch(deps.db, source.source, source.url, now());
  return runImport(deps, batchId, source, options);
}

function toImportFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(502, "import_failed", "Import failed. Previous data remains available.", {
    reason: errorMessage(error),
  });
}

async function failBatch(db: D1Database, batchId: number, error: unknown, now: Date): Promise<void> {
  logger.error("import.failed", { batchId, error });
  await db
    .prepare("UPDATE import_batches SET status = 'failed', error_message = ?2, completed_at = ?3 WHERE id = ?1")
    .bind(batchId, errorMessage(error).slice(0, 1000), now.toISOString())
    .run();
}

async function runImport(
  deps: ImportDeps,
  batchId: number,
  source: DropListSource,
  options: ImportOptions,
): Promise<ImportResult> {
  const { db } = deps;
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  logger.info("import.started", { batchId, source: source.source, bytes: source.bytes.length });

  try {
    const checksum = await sha256Hex(source.bytes);
    if (source.publishedChecksum && source.publishedChecksum !== checksum) {
      throw new Error(
        `Checksum mismatch: published ${source.publishedChecksum.slice(0, 12)}…, computed ${checksum.slice(0, 12)}…`,
      );
    }
    await db.prepare("UPDATE import_batches SET checksum = ? WHERE id = ?").bind(checksum, batchId).run();

    if (!options.force && (await checksumAlreadyImported(db, checksum))) {
      await db
        .prepare(
          `UPDATE import_batches SET status = 'skipped', completed_at = ?2,
             error_message = 'File already imported (same checksum).' WHERE id = ?1`,
        )
        .bind(batchId, now().toISOString())
        .run();
      logger.info("import.unchanged", { batchId, checksum });
      return {
        outcome: "unchanged",
        message: "This file has already been imported.",
        batch: await getImportBatch(db, batchId),
      };
    }

    const r2Key = await archive(deps.archive, source, checksum, now());
    if (r2Key) await db.prepare("UPDATE import_batches SET r2_key = ? WHERE id = ?").bind(r2Key, batchId).run();

    const before = await countDomains(db);
    const stats = await ingest(db, batchId, source.bytes, options.tlds ?? SUPPORTED_TLDS, startedAt);
    const after = await countDomains(db);
    const inserted = after - before;

    let removed = 0;
    if (options.markMissing !== false) {
      const result = await db
        .prepare(
          `UPDATE domains
             SET status = CASE WHEN drop_time IS NOT NULL AND drop_time <= ?2 THEN 'dropped' ELSE 'removed' END,
                 updated_at = ?2
           WHERE status = 'listed' AND (last_import_batch_id IS NULL OR last_import_batch_id != ?1)`,
        )
        .bind(batchId, now().toISOString())
        .run();
      removed = result.meta.changes ?? 0;
    }

    await db
      .prepare(
        `UPDATE import_batches SET status = 'completed', drop_date = ?2, total_records = ?3, inserted_records = ?4,
           duplicate_records = ?5, failed_records = ?6, skipped_records = ?7, removed_records = ?8,
           completed_at = ?9, error_message = NULL
         WHERE id = ?1`,
      )
      .bind(
        batchId,
        stats.minDropDate,
        stats.total,
        inserted,
        stats.valid - inserted + stats.inFileDuplicates,
        stats.invalid,
        stats.unsupported,
        removed,
        now().toISOString(),
      )
      .run();

    const batch = await getImportBatch(db, batchId);
    logger.info("import.completed", { batchId, ...stats, inserted, removed });
    return { outcome: "imported", message: `Imported ${stats.valid.toLocaleString("en-GB")} domains.`, batch };
  } catch (error) {
    await failBatch(db, batchId, error, now());
    throw toImportFailure(error);
  }
}

async function archive(
  bucket: R2Bucket | undefined,
  source: DropListSource,
  checksum: string,
  now: Date,
): Promise<string | null> {
  if (!bucket) return null;
  const extension = source.compressed ? "csv.gz" : "csv";
  const key = `${source.source}/${now.toISOString().slice(0, 10)}/${checksum}.${extension}`;
  try {
    await bucket.put(key, source.bytes, {
      httpMetadata: { contentType: source.compressed ? "application/gzip" : "text/csv" },
      customMetadata: { source: source.source, sha256: checksum },
    });
    return key;
  } catch (error) {
    // Archiving is best-effort; the import itself can proceed.
    logger.warn("import.archive_failed", { key, error });
    return null;
  }
}

interface IngestStats {
  total: number;
  valid: number;
  invalid: number;
  unsupported: number;
  inFileDuplicates: number;
  minDropDate: string | null;
}

async function ingest(
  db: D1Database,
  batchId: number,
  bytes: Uint8Array,
  tlds: readonly TldPolicy[],
  timestamp: string,
): Promise<IngestStats> {
  const stats: IngestStats = { total: 0, valid: 0, invalid: 0, unsupported: 0, inFileDuplicates: 0, minDropDate: null };
  const seen = new Set<string>();
  let pendingRows: DomainTuple[] = [];
  let pendingStatements: D1PreparedStatement[] = [];
  const statement = db.prepare(UPSERT_SQL);

  const flushStatements = async () => {
    if (pendingStatements.length === 0) return;
    await db.batch(pendingStatements);
    pendingStatements = [];
  };
  const flushRows = async () => {
    if (pendingRows.length === 0) return;
    pendingStatements.push(statement.bind(JSON.stringify(pendingRows), timestamp, batchId));
    pendingRows = [];
    if (pendingStatements.length >= STATEMENTS_PER_BATCH) await flushStatements();
  };

  for await (const record of parseDropListLines(readLines(toTextStream(bytes)))) {
    stats.total += 1;
    const parsed = parseDomain(record.rawDomain, tlds);
    if (!parsed.ok) {
      if (parsed.reason === "unsupported_tld") stats.unsupported += 1;
      else stats.invalid += 1;
      continue;
    }
    const { domain, tld, sld } = parsed.value;
    if (seen.has(domain)) {
      stats.inFileDuplicates += 1;
      continue;
    }
    seen.add(domain);
    stats.valid += 1;

    const dropDate = record.dropTime ? record.dropTime.slice(0, 10) : null;
    if (dropDate && (stats.minDropDate === null || dropDate < stats.minDropDate)) stats.minDropDate = dropDate;
    const { length, hyphens, digits } = lexicalFeatures(sld);
    pendingRows.push([domain, tld, sld, length, hyphens, digits, record.roid, dropDate, record.dropTime]);
    if (pendingRows.length >= ROWS_PER_STATEMENT) await flushRows();
  }
  await flushRows();
  await flushStatements();
  return stats;
}

export const IMPORT_CHUNKING = { ROWS_PER_STATEMENT, STATEMENTS_PER_BATCH } as const;
