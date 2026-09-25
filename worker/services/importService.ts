import type { ImportBatchDto } from "../../shared/api";
import { lexicalFeatures, parseDomain, SUPPORTED_TLDS, type TldPolicy } from "../../shared/domain";
import { londonDate } from "../../shared/time";
import { refreshImportStats } from "./settings";
import { countWords } from "./wordSegmenter";
import { toImportBatchDto, type ImportBatchDbRow } from "../db/rows";
import { parseDropListBatches, readLineBatches, toTextStream } from "../providers/nominet/parse";
import type { DropListProvider, DropListSource } from "../providers/types";
import { sha256Hex } from "../utils/crypto";
import { AppError, errorMessage } from "../utils/errors";
import { logger } from "../utils/logger";

/**
 * Drop-list import pipeline, split into bounded steps so a large list never
 * has to fit into a single Worker invocation:
 *
 *  1. prepare   checksum check → download → verify → archive (R2) → stream-parse
 *               once → normalise/validate/dedupe → stage rows in `import_chunks`
 *  2. load      upsert one staged chunk at a time (`continueImport`), recording
 *               progress; runs within a time budget and resumes on the next cron tick
 *  3. finalise  mark missing domains, record statistics, complete the batch
 *
 * Idempotent: a file whose checksum already has a completed batch is skipped,
 * domains are upserted on their UNIQUE name, and re-loading a chunk is harmless.
 */

/** Rows per upsert statement (sent as one JSON parameter). */
const ROWS_PER_STATEMENT = 500;
/** Statements per D1 batch round-trip. */
const STATEMENTS_PER_BATCH = 10;
/** Rows staged per chunk (~230 KB of JSON; D1 rows may be up to 2 MB). */
const DEFAULT_CHUNK_ROWS = 2_000;
/** Chunk rows written per D1 batch while staging (~1 MB per request). */
const CHUNK_INSERTS_PER_BATCH = 5;
/** Parsed rows between prepare-phase heartbeats. */
const PREPARE_HEARTBEAT_ROWS = 50_000;
/** A running batch with no progress for this long is assumed dead (e.g. Worker evicted). */
const STALE_RUNNING_MS = 30 * 60 * 1000;
/** Default wall-time budget for loading chunks in one invocation. */
export const DEFAULT_LOAD_BUDGET_MS = 40_000;

export type ImportOutcome = "imported" | "started" | "unchanged";

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
  /** Rows per staged chunk (tests use small values). */
  chunkRows?: number;
  /**
   * How long to keep loading chunks in this invocation after preparing.
   * `undefined` loads everything (tests, small uploads); `0` only prepares.
   */
  loadBudgetMs?: number;
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
  wordCount: number | null,
];

const UPSERT_SQL = `
INSERT INTO domains (domain, tld, sld, length, hyphens, digits, roid, drop_date, drop_time, word_count, status,
                     first_seen_at, last_seen_at, last_import_batch_id, created_at, updated_at)
SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
       json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'),
       json_extract(j.value, '$[6]'), json_extract(j.value, '$[7]'), json_extract(j.value, '$[8]'),
       json_extract(j.value, '$[9]'),
       'listed', ?2, ?2, ?3, ?2, ?2
FROM json_each(?1) AS j
WHERE true
ON CONFLICT(domain) DO UPDATE SET
  roid = COALESCE(excluded.roid, domains.roid),
  drop_date = COALESCE(excluded.drop_date, domains.drop_date),
  drop_time = COALESCE(excluded.drop_time, domains.drop_time),
  word_count = excluded.word_count,
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
  await db.batch([
    db
      .prepare(
        `UPDATE import_batches SET status = 'failed', phase = NULL, completed_at = ?1,
           error_message = 'Import did not finish (worker stopped). Previous data remains available.'
         WHERE status = 'running' AND COALESCE(heartbeat_at, started_at) < ?2`,
      )
      .bind(now.toISOString(), cutoff),
    db.prepare(
      "DELETE FROM import_chunks WHERE batch_id IN (SELECT id FROM import_batches WHERE status != 'running')",
    ),
  ]);
}

async function createBatch(db: D1Database, source: string, sourceUrl: string | null, now: Date): Promise<number> {
  try {
    const row = await db
      .prepare(
        `INSERT INTO import_batches (source, source_url, status, phase, started_at, created_at, heartbeat_at)
         VALUES (?1, ?2, 'running', 'preparing', ?3, ?3, ?3) RETURNING id`,
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

/** Downloads from the provider, prepares the import, and loads within the time budget. */
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
  return prepareAndLoad(deps, batchId, source, options);
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
  return prepareAndLoad(deps, batchId, source, options);
}

function toImportFailure(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(502, "import_failed", "Import failed. Previous data remains available.", {
    reason: errorMessage(error),
  });
}

async function failBatch(db: D1Database, batchId: number, error: unknown, now: Date): Promise<void> {
  logger.error("import.failed", { batchId, error });
  await db.batch([
    db
      .prepare(
        "UPDATE import_batches SET status = 'failed', phase = NULL, error_message = ?2, completed_at = ?3 WHERE id = ?1",
      )
      .bind(batchId, errorMessage(error).slice(0, 1000), now.toISOString()),
    db.prepare("DELETE FROM import_chunks WHERE batch_id = ?").bind(batchId),
  ]);
}

async function prepareAndLoad(
  deps: ImportDeps,
  batchId: number,
  source: DropListSource,
  options: ImportOptions,
): Promise<ImportResult> {
  const prepared = await prepareImport(deps, batchId, source, options);
  if (prepared) return prepared;
  const progress = await continueImport(deps.db, { now: options.now, budgetMs: options.loadBudgetMs });
  const batch = await getImportBatch(deps.db, batchId);
  if (batch?.status === "completed") {
    return {
      outcome: "imported",
      message: `Imported ${(batch.validRecords ?? 0).toLocaleString("en-GB")} domains.`,
      batch,
    };
  }
  if (batch?.status === "failed") {
    throw toImportFailure(new Error(batch.errorMessage ?? "Import failed."));
  }
  logger.info("import.loading_in_background", { batchId, chunksDone: progress?.chunksDone ?? 0 });
  return {
    outcome: "started",
    message: `Import started: ${(batch?.validRecords ?? 0).toLocaleString("en-GB")} domains are loading in the background.`,
    batch,
  };
}

/**
 * Step 1: verify and archive the file, then parse it once and stage the valid
 * rows as chunks. Returns a final result when there is nothing to load
 * (unchanged file); otherwise null and the batch is left in phase 'loading'.
 */
async function prepareImport(
  deps: ImportDeps,
  batchId: number,
  source: DropListSource,
  options: ImportOptions,
): Promise<ImportResult | null> {
  const { db } = deps;
  const now = options.now ?? (() => new Date());
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
    const domainsBefore = await countDomains(db);
    const stats = await stageChunks(
      db,
      batchId,
      source.bytes,
      options.tlds ?? SUPPORTED_TLDS,
      options.chunkRows ?? DEFAULT_CHUNK_ROWS,
      now,
    );

    const timestamp = now().toISOString();
    await db
      .prepare(
        `UPDATE import_batches SET r2_key = ?2, phase = 'loading', chunk_count = ?3, chunks_done = 0,
           total_records = ?4, valid_records = ?5, in_file_duplicates = ?6, failed_records = ?7,
           skipped_records = ?8, drop_date = ?9, domains_before = ?10, mark_missing = ?11,
           import_timestamp = ?12, heartbeat_at = ?12
         WHERE id = ?1`,
      )
      .bind(
        batchId,
        r2Key,
        stats.chunks,
        stats.total,
        stats.valid,
        stats.inFileDuplicates,
        stats.invalid,
        stats.unsupported,
        stats.minDropDate,
        domainsBefore,
        options.markMissing === false ? 0 : 1,
        timestamp,
      )
      .run();
    logger.info("import.prepared", { batchId, ...stats });
    return null;
  } catch (error) {
    await failBatch(db, batchId, error, now());
    throw toImportFailure(error);
  }
}

interface LoadingBatchRow {
  id: number;
  chunk_count: number;
  chunks_done: number;
  import_timestamp: string;
}

export interface ContinueImportOptions {
  now?: () => Date;
  /** Stop starting new chunks after this much wall time; `undefined` = no limit. */
  budgetMs?: number;
}

export interface ImportProgress {
  batchId: number;
  chunksDone: number;
  chunkCount: number;
  completed: boolean;
}

/**
 * Steps 2–3: load staged chunks for the running import until done or out of
 * budget, then finalise. Safe to call from several invocations: upserts are
 * idempotent and progress only moves forward.
 */
export async function continueImport(db: D1Database, options: ContinueImportOptions = {}): Promise<ImportProgress | null> {
  const now = options.now ?? (() => new Date());
  const started = Date.now();
  const batch = await db
    .prepare(
      `SELECT id, chunk_count, chunks_done, import_timestamp FROM import_batches
       WHERE status = 'running' AND phase = 'loading' ORDER BY id LIMIT 1`,
    )
    .first<LoadingBatchRow>();
  if (!batch) return null;

  let chunksDone = batch.chunks_done;
  try {
    while (chunksDone < batch.chunk_count) {
      if (options.budgetMs !== undefined && Date.now() - started >= options.budgetMs) break;
      const chunk = await db
        .prepare("SELECT rows_json FROM import_chunks WHERE batch_id = ? AND chunk_index = ?")
        .bind(batch.id, chunksDone)
        .first<{ rows_json: string }>();
      if (chunk) await upsertRows(db, batch.id, JSON.parse(chunk.rows_json) as DomainTuple[], batch.import_timestamp);
      chunksDone += 1;
      await db
        .prepare(
          "UPDATE import_batches SET chunks_done = MAX(chunks_done, ?2), heartbeat_at = ?3 WHERE id = ?1 AND status = 'running'",
        )
        .bind(batch.id, chunksDone, now().toISOString())
        .run();
    }
    if (chunksDone >= batch.chunk_count) {
      await finaliseImport(db, batch.id, now());
      return { batchId: batch.id, chunksDone, chunkCount: batch.chunk_count, completed: true };
    }
    return { batchId: batch.id, chunksDone, chunkCount: batch.chunk_count, completed: false };
  } catch (error) {
    await failBatch(db, batch.id, error, now());
    return { batchId: batch.id, chunksDone, chunkCount: batch.chunk_count, completed: false };
  }
}

async function upsertRows(db: D1Database, batchId: number, rows: DomainTuple[], timestamp: string): Promise<void> {
  const statement = db.prepare(UPSERT_SQL);
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
    statements.push(statement.bind(JSON.stringify(rows.slice(i, i + ROWS_PER_STATEMENT)), timestamp, batchId));
  }
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH));
  }
}

async function finaliseImport(db: D1Database, batchId: number, now: Date): Promise<void> {
  const row = await db
    .prepare(
      "SELECT domains_before, valid_records, in_file_duplicates, mark_missing FROM import_batches WHERE id = ? AND status = 'running'",
    )
    .bind(batchId)
    .first<{ domains_before: number; valid_records: number; in_file_duplicates: number; mark_missing: number }>();
  if (!row) return; // already finalised or failed by another invocation

  let removed = 0;
  if (row.mark_missing) {
    const result = await db
      .prepare(
        `UPDATE domains
           SET status = CASE WHEN drop_time IS NOT NULL AND drop_time <= ?2 THEN 'dropped' ELSE 'removed' END,
               updated_at = ?2
         WHERE status = 'listed' AND (last_import_batch_id IS NULL OR last_import_batch_id != ?1)`,
      )
      .bind(batchId, now.toISOString())
      .run();
    removed = result.meta.changes ?? 0;
  }
  const inserted = Math.max(0, (await countDomains(db)) - row.domains_before);

  await db.batch([
    db
      .prepare(
        `UPDATE import_batches SET status = 'completed', phase = NULL, inserted_records = ?2,
           duplicate_records = ?3, removed_records = ?4, completed_at = ?5, heartbeat_at = ?5, error_message = NULL
         WHERE id = ?1 AND status = 'running'`,
      )
      .bind(batchId, inserted, row.valid_records - inserted + row.in_file_duplicates, removed, now.toISOString()),
    db.prepare("DELETE FROM import_chunks WHERE batch_id = ?").bind(batchId),
  ]);
  await refreshImportStats(db, now);
  logger.info("import.completed", { batchId, inserted, removed, valid: row.valid_records });
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

interface StageStats {
  total: number;
  valid: number;
  invalid: number;
  unsupported: number;
  inFileDuplicates: number;
  minDropDate: string | null;
  chunks: number;
}

/** Parses the file once and stores validated, deduplicated rows as chunks. */
async function stageChunks(
  db: D1Database,
  batchId: number,
  bytes: Uint8Array,
  tlds: readonly TldPolicy[],
  chunkRows: number,
  now: () => Date,
): Promise<StageStats> {
  const stats: StageStats = {
    total: 0,
    valid: 0,
    invalid: 0,
    unsupported: 0,
    inFileDuplicates: 0,
    minDropDate: null,
    chunks: 0,
  };
  const seen = new Set<string>();
  const insert = db.prepare("INSERT INTO import_chunks (batch_id, chunk_index, rows_json) VALUES (?1, ?2, ?3)");
  let rows: DomainTuple[] = [];
  let pending: D1PreparedStatement[] = [];

  const flushInserts = async () => {
    if (pending.length === 0) return;
    await db.batch(pending);
    pending = [];
  };
  const flushChunk = async () => {
    if (rows.length === 0) return;
    pending.push(insert.bind(batchId, stats.chunks, JSON.stringify(rows)));
    stats.chunks += 1;
    rows = [];
    if (pending.length >= CHUNK_INSERTS_PER_BATCH) await flushInserts();
  };

  let nextHeartbeat = PREPARE_HEARTBEAT_ROWS;
  for await (const records of parseDropListBatches(readLineBatches(toTextStream(bytes)))) {
    for (const record of records) {
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

      // Drop dates are UK calendar days; the exact instant stays in drop_time (UTC).
      const dropDate = record.dropTime ? londonDate(record.dropTime) : null;
      if (dropDate && (stats.minDropDate === null || dropDate < stats.minDropDate)) stats.minDropDate = dropDate;
      const { length, hyphens, digits } = lexicalFeatures(sld);
      rows.push([domain, tld, sld, length, hyphens, digits, record.roid, dropDate, record.dropTime, countWords(sld)]);
      if (rows.length >= chunkRows) await flushChunk();
    }
    if (stats.total >= nextHeartbeat) {
      nextHeartbeat += PREPARE_HEARTBEAT_ROWS;
      await db
        .prepare("UPDATE import_batches SET heartbeat_at = ?2, total_records = ?3 WHERE id = ?1")
        .bind(batchId, now().toISOString(), stats.total)
        .run();
    }
  }
  await flushChunk();
  await flushInserts();
  return stats;
}

export const IMPORT_CHUNKING = { ROWS_PER_STATEMENT, STATEMENTS_PER_BATCH, DEFAULT_CHUNK_ROWS } as const;
