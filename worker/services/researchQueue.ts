import type {
  QueueState,
  ResearchEnqueueResult,
  ResearchJobDto,
  ResearchRequest,
  ResearchSettings,
} from "../../shared/api";
import type { DomainFilter } from "../../shared/filters";
import { toJobDto, type JobDbRow } from "../db/rows";
import { chunk } from "../utils/concurrency";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { todayUtc } from "../utils/time";
import { buildDomainWhere } from "./domainQuery";
import { getQueueControl, getResearchSettings, setQueueControl } from "./settings";

/**
 * D1-backed research job queue. Creating jobs never calls the provider;
 * jobs are processed in bounded batches by the cron tick (researchTick).
 */

const IDS_PER_STATEMENT = 500;
/** Skip domains researched this recently unless the request forces a refresh. */
const RECENT_RESEARCH_HOURS = 24;

async function resolveFilterIds(
  db: D1Database,
  filter: DomainFilter,
  confirmCount: number | undefined,
  settings: ResearchSettings,
  now: Date,
): Promise<number[]> {
  const where = buildDomainWhere(filter, now);
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM domains d ${where.sql}`)
    .bind(...where.params)
    .first<{ n: number }>();
  const total = countRow?.n ?? 0;
  if (total > settings.maxEnqueuePerRequest) {
    throw new AppError(
      422,
      "enqueue_limit",
      `This filter matches ${total.toLocaleString("en-GB")} domains; the per-request research limit is ` +
        `${settings.maxEnqueuePerRequest.toLocaleString("en-GB")}. Narrow the filter first.`,
      { total, limit: settings.maxEnqueuePerRequest },
    );
  }
  if (confirmCount === undefined || confirmCount !== total) {
    throw new AppError(409, "confirm_count_mismatch", "The number of matching domains changed. Please confirm again.", {
      total,
    });
  }
  const { results } = await db
    .prepare(`SELECT d.id FROM domains d ${where.sql} LIMIT ?`)
    .bind(...where.params, settings.maxEnqueuePerRequest)
    .all<{ id: number }>();
  return results.map((row) => row.id);
}

export async function enqueueResearch(
  db: D1Database,
  request: ResearchRequest,
  now: Date = new Date(),
): Promise<ResearchEnqueueResult> {
  const settings = await getResearchSettings(db);
  let ids: number[];
  if (request.domainIds) {
    ids = [...new Set(request.domainIds)];
    if (ids.length > settings.maxEnqueuePerRequest) {
      throw new AppError(
        422,
        "enqueue_limit",
        `You selected ${ids.length} domains; the per-request research limit is ${settings.maxEnqueuePerRequest}.`,
      );
    }
  } else {
    ids = await resolveFilterIds(db, request.filter ?? {}, request.confirmCount, settings, now);
  }

  const timestamp = now.toISOString();
  const recentCutoff = new Date(now.getTime() - RECENT_RESEARCH_HOURS * 3_600_000).toISOString();
  let enqueued = 0;
  let eligible = 0;

  for (const group of chunk(ids, IDS_PER_STATEMENT)) {
    const json = JSON.stringify(group);
    const recentClause = request.force
      ? ""
      : "AND NOT (d.research_status = 'completed' AND d.last_researched_at > ?4)";
    const eligibleSql = `SELECT d.id FROM domains d WHERE d.id IN (SELECT value FROM json_each(?1)) ${recentClause}`;
    const insert = db
      .prepare(
        `INSERT OR IGNORE INTO research_jobs (domain_id, job_type, status, priority, created_at)
         SELECT e.id, 'full', 'pending', ?2, ?3 FROM (${eligibleSql}) AS e`,
      )
      .bind(json, request.priority, timestamp, ...(request.force ? [] : [recentCutoff]));
    const countEligible = db
      .prepare(`SELECT COUNT(*) AS n FROM (${eligibleSql}) AS e`)
      .bind(json, ...(request.force ? [] : [null, null, recentCutoff]));
    const markPending = db
      .prepare(
        `UPDATE domains SET research_status = 'pending', updated_at = ?2
         WHERE id IN (SELECT domain_id FROM research_jobs WHERE status = 'pending' AND created_at = ?2
                      AND domain_id IN (SELECT value FROM json_each(?1)))`,
      )
      .bind(json, timestamp);
    const [countResult, insertResult] = await db.batch([countEligible, insert, markPending]);
    eligible += (countResult?.results?.[0] as { n: number } | undefined)?.n ?? 0;
    enqueued += insertResult?.meta.changes ?? 0;
  }

  const result: ResearchEnqueueResult = {
    requested: ids.length,
    enqueued,
    alreadyQueued: eligible - enqueued,
    skippedRecent: ids.length - eligible,
  };
  logger.info("research.enqueued", { ...result });
  return result;
}

export async function getQueueCounts(db: D1Database): Promise<QueueState["counts"]> {
  const { results } = await db
    .prepare("SELECT status, COUNT(*) AS n FROM research_jobs GROUP BY status")
    .all<{ status: string; n: number }>();
  const counts = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of results) {
    if (row.status in counts) counts[row.status as keyof typeof counts] = row.n;
  }
  return counts;
}

export async function getUsage(db: D1Database, day: string): Promise<QueueState["usageToday"]> {
  const row = await db
    .prepare("SELECT domains, provider_calls, cost FROM research_usage WHERE day = ?")
    .bind(day)
    .first<{ domains: number; provider_calls: number; cost: number }>();
  return { domains: row?.domains ?? 0, providerCalls: row?.provider_calls ?? 0, cost: row?.cost ?? 0 };
}

export async function recordUsage(
  db: D1Database,
  day: string,
  delta: { domains?: number; providerCalls?: number; cost?: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO research_usage (day, domains, provider_calls, cost) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(day) DO UPDATE SET domains = domains + excluded.domains,
         provider_calls = provider_calls + excluded.provider_calls, cost = cost + excluded.cost`,
    )
    .bind(day, delta.domains ?? 0, delta.providerCalls ?? 0, delta.cost ?? 0)
    .run();
}

export async function getQueueState(db: D1Database, providerConfigured: boolean, now = new Date()): Promise<QueueState> {
  const [counts, control, settings, usageToday] = await Promise.all([
    getQueueCounts(db),
    getQueueControl(db),
    getResearchSettings(db),
    getUsage(db, todayUtc(now)),
  ]);
  return {
    counts,
    paused: control.paused,
    pauseReason: control.pauseReason,
    usageToday,
    dailyLimit: settings.dailyDomainLimit,
    limitReached: usageToday.domains >= settings.dailyDomainLimit,
    providerConfigured,
  };
}

export async function listJobs(
  db: D1Database,
  options: { status?: string; limit: number; offset: number },
): Promise<{ items: ResearchJobDto[]; total: number }> {
  const where = options.status ? "WHERE j.status = ?" : "";
  const params = options.status ? [options.status] : [];
  const order = options.status === "pending" ? "j.priority DESC, j.created_at ASC" : "j.id DESC";
  const [rows, total] = await db.batch([
    db
      .prepare(
        `SELECT j.*, d.domain FROM research_jobs j JOIN domains d ON d.id = j.domain_id ${where}
         ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .bind(...params, options.limit, options.offset),
    db.prepare(`SELECT COUNT(*) AS n FROM research_jobs j ${where}`).bind(...params),
  ]);
  return {
    items: ((rows?.results ?? []) as JobDbRow[]).map(toJobDto),
    total: ((total?.results?.[0] as { n: number } | undefined)?.n ?? 0) as number,
  };
}

export async function pauseQueue(db: D1Database, reason: string | null): Promise<void> {
  await setQueueControl(db, { paused: true, pauseReason: reason });
  logger.info("research.queue_paused", { reason });
}

export async function resumeQueue(db: D1Database): Promise<void> {
  await setQueueControl(db, { paused: false, pauseReason: null });
  logger.info("research.queue_resumed");
}

/** Re-queues the most recent failed job per domain (only where no job is active). */
export async function retryFailedJobs(db: D1Database, jobId?: number, now = new Date()): Promise<number> {
  const timestamp = now.toISOString();
  const scope = jobId === undefined ? "" : "AND id = ?2";
  const result = await db
    .prepare(
      `UPDATE research_jobs
         SET status = 'pending', attempts = 0, error_message = NULL, next_attempt_at = NULL,
             started_at = NULL, completed_at = NULL, created_at = ?1
       WHERE status = 'failed' ${scope}
         AND id IN (SELECT MAX(id) FROM research_jobs WHERE status = 'failed' GROUP BY domain_id)
         AND domain_id NOT IN (SELECT domain_id FROM research_jobs WHERE status IN ('pending', 'processing'))`,
    )
    .bind(timestamp, ...(jobId === undefined ? [] : [jobId]))
    .run();
  await db
    .prepare(
      `UPDATE domains SET research_status = 'pending', updated_at = ?1
       WHERE id IN (SELECT domain_id FROM research_jobs WHERE status = 'pending' AND created_at = ?1)`,
    )
    .bind(timestamp)
    .run();
  return result.meta.changes ?? 0;
}

/** Deletes completed job records only; metric snapshots are untouched. */
export async function clearCompletedJobs(db: D1Database): Promise<number> {
  const result = await db.prepare("DELETE FROM research_jobs WHERE status = 'completed'").run();
  return result.meta.changes ?? 0;
}
