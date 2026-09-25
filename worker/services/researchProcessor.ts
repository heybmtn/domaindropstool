import type { ResearchSettings } from "../../shared/api";
import { computeResearchScore, type ScoreWeights } from "../../shared/scoring";
import type {
  BacklinkData,
  BacklinkSummary,
  DomainOverview,
  HistoryData,
  KeywordData,
  ProviderCallResult,
  ResearchOptions,
  SeoProvider,
} from "../providers/types";
import { ProviderError } from "../providers/types";
import { mapWithConcurrency } from "../utils/concurrency";
import { errorMessage } from "../utils/errors";
import { logger } from "../utils/logger";
import { todayUtc } from "../utils/time";
import { recordUsage } from "./researchQueue";
import { getQueueControl, getResearchSettings, getScoreWeights, setQueueControl } from "./settings";

/**
 * Processes queued research jobs in bounded batches. Called from the cron
 * trigger only — never from a user request — so no HTTP request waits on the
 * provider. Enforces: pause flag, daily limit, batch size, concurrency,
 * retry limit with exponential backoff, and auto-pause on provider limits.
 */

const STALE_PROCESSING_MS = 15 * 60 * 1000;
const BASE_BACKOFF_SECONDS = 60;

interface ClaimedJob {
  id: number;
  domain_id: number;
  attempts: number;
}

interface JobDomain {
  id: number;
  domain: string;
  length: number;
  hyphens: number;
  digits: number;
}

export interface TickResult {
  skipped?: "paused" | "daily_limit" | "not_configured" | "empty";
  processed: number;
  completed: number;
  retried: number;
  failed: number;
  paused: boolean;
}

interface CollectedResearch {
  summary: BacklinkSummary | null;
  overview: DomainOverview | null;
  keywords: KeywordData | null;
  backlinks: BacklinkData | null;
  history: HistoryData | null;
  raw: Record<string, unknown>;
  partialErrors: string[];
}

export async function reclaimStaleJobs(db: D1Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_PROCESSING_MS).toISOString();
  const result = await db
    .prepare(
      `UPDATE research_jobs SET status = 'pending', next_attempt_at = ?1,
         error_message = 'Processing timed out; re-queued.'
       WHERE status = 'processing' AND started_at < ?2`,
    )
    .bind(now.toISOString(), cutoff)
    .run();
  return result.meta.changes ?? 0;
}

async function claimJobs(db: D1Database, limit: number, now: Date): Promise<ClaimedJob[]> {
  const timestamp = now.toISOString();
  const { results } = await db
    .prepare(
      `UPDATE research_jobs SET status = 'processing', started_at = ?1, attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM research_jobs
         WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)
         ORDER BY priority DESC, created_at ASC, id ASC
         LIMIT ?2)
       RETURNING id, domain_id, attempts`,
    )
    .bind(timestamp, limit)
    .all<ClaimedJob>();
  if (results.length > 0) {
    await db
      .prepare(
        `UPDATE domains SET research_status = 'processing', updated_at = ?2
         WHERE id IN (SELECT value FROM json_each(?1))`,
      )
      .bind(JSON.stringify(results.map((job) => job.domain_id)), timestamp)
      .run();
  }
  return results;
}

async function loadDomains(db: D1Database, ids: number[]): Promise<Map<number, JobDomain>> {
  const { results } = await db
    .prepare("SELECT id, domain, length, hyphens, digits FROM domains WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<JobDomain>();
  return new Map(results.map((row) => [row.id, row]));
}

/** Calls the provider for one domain. Core calls must succeed; optional ones degrade gracefully. */
interface UsageCounter {
  calls: number;
  cost: number;
}

async function collect(
  provider: SeoProvider,
  domain: string,
  settings: ResearchSettings,
  usage: UsageCounter,
): Promise<CollectedResearch> {
  const options: ResearchOptions = {
    locationCode: settings.locationCode,
    languageCode: settings.languageCode,
    keywordLimit: settings.keywordLimit,
    backlinkLimit: settings.backlinkLimit,
  };
  const out: CollectedResearch = {
    summary: null,
    overview: null,
    keywords: null,
    backlinks: null,
    history: null,
    raw: {},
    partialErrors: [],
  };

  const run = async <T>(key: string, required: boolean, call: () => Promise<ProviderCallResult<T>>) => {
    usage.calls += 1;
    try {
      const result = await call();
      usage.cost += result.cost;
      out.raw[key] = result.raw;
      return result.data;
    } catch (error) {
      if (required || (error instanceof ProviderError && error.pauseQueue)) throw error;
      out.partialErrors.push(`${key}: ${errorMessage(error)}`);
      logger.warn("research.partial_failure", { domain, call: key, error: errorMessage(error) });
      return null;
    }
  };

  // Core metrics: both must succeed for a usable snapshot.
  const [summary, overview] = await Promise.all([
    run("backlinkSummary", true, () => provider.getBacklinkSummary(domain)),
    run("domainOverview", true, () => provider.getDomainOverview(domain, options)),
  ]);
  out.summary = summary;
  out.overview = overview;

  if (settings.fetchKeywords) out.keywords = await run("keywords", false, () => provider.getOrganicKeywords(domain, options));
  if (settings.fetchBacklinks) out.backlinks = await run("backlinks", false, () => provider.getBacklinks(domain, options));
  if (settings.fetchHistory) out.history = await run("history", false, () => provider.getHistory(domain, options));
  return out;
}

async function storeResearch(
  db: D1Database,
  job: ClaimedJob,
  domain: JobDomain,
  providerName: string,
  data: CollectedResearch,
  weights: ScoreWeights,
  now: Date,
): Promise<void> {
  const timestamp = now.toISOString();
  const metrics = {
    backlinks: data.summary?.backlinks ?? null,
    referringDomains: data.summary?.referringDomains ?? null,
    referringPages: data.summary?.referringPages ?? null,
    organicTraffic: data.overview?.organicTraffic ?? null,
    organicKeywords: data.overview?.organicKeywords ?? null,
    trafficValue: data.overview?.trafficValue ?? null,
    authority: data.summary?.rank ?? null,
    spamScore: data.summary?.spamScore ?? null,
  };
  const score = computeResearchScore({ ...domain, ...metrics }, weights);
  const raw = JSON.stringify({ ...data.raw, partialErrors: data.partialErrors }).slice(0, 200_000);

  const inserted = await db
    .prepare(
      `INSERT INTO domain_metrics (domain_id, provider, metric_date, backlinks, referring_domains, referring_pages,
         organic_traffic, organic_keywords, traffic_value, visibility, authority_metric, spam_score, research_score,
         score_breakdown, raw_response, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, ?13, ?14, ?15)
       RETURNING id`,
    )
    .bind(
      domain.id,
      providerName,
      todayUtc(now),
      metrics.backlinks,
      metrics.referringDomains,
      metrics.referringPages,
      metrics.organicTraffic,
      metrics.organicKeywords,
      metrics.trafficValue,
      metrics.authority,
      metrics.spamScore,
      score.score,
      JSON.stringify(score.breakdown),
      raw,
      timestamp,
    )
    .first<{ id: number }>();
  if (!inserted) throw new Error("Failed to store metrics snapshot");
  const metricsId = inserted.id;

  const statements: D1PreparedStatement[] = [];
  if (data.keywords && data.keywords.items.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO domain_keywords (metrics_id, domain_id, keyword, position, search_volume, etv, url)
           SELECT ?1, ?2, json_extract(value, '$.keyword'), json_extract(value, '$.position'),
                  json_extract(value, '$.searchVolume'), json_extract(value, '$.etv'), json_extract(value, '$.url')
           FROM json_each(?3)`,
        )
        .bind(metricsId, domain.id, JSON.stringify(data.keywords.items)),
    );
  }
  if (data.backlinks && data.backlinks.items.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO domain_backlinks (metrics_id, domain_id, referring_domain, source_url, target_url, anchor,
             link_type, domain_rank, first_seen)
           SELECT ?1, ?2, json_extract(value, '$.referringDomain'), json_extract(value, '$.sourceUrl'),
                  json_extract(value, '$.targetUrl'), json_extract(value, '$.anchor'), json_extract(value, '$.linkType'),
                  json_extract(value, '$.domainRank'), json_extract(value, '$.firstSeen')
           FROM json_each(?3)`,
        )
        .bind(metricsId, domain.id, JSON.stringify(data.backlinks.items)),
    );
  }
  if (data.history && data.history.points.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO domain_history (domain_id, provider, month, organic_traffic, organic_keywords, backlinks,
             referring_domains, updated_at)
           SELECT ?1, ?2, json_extract(value, '$.month'), json_extract(value, '$.organicTraffic'),
                  json_extract(value, '$.organicKeywords'), json_extract(value, '$.backlinks'),
                  json_extract(value, '$.referringDomains'), ?4
           FROM json_each(?3) WHERE true
           ON CONFLICT(domain_id, provider, month) DO UPDATE SET
             organic_traffic = excluded.organic_traffic, organic_keywords = excluded.organic_keywords,
             updated_at = excluded.updated_at`,
        )
        .bind(domain.id, providerName, JSON.stringify(data.history.points), timestamp),
    );
  }
  statements.push(
    db
      .prepare(
        `UPDATE domains SET latest_metrics_id = ?2, latest_backlinks = ?3, latest_referring_domains = ?4,
           latest_referring_pages = ?5, latest_organic_traffic = ?6, latest_organic_keywords = ?7,
           latest_traffic_value = ?8, latest_authority = ?9, research_score = ?10,
           research_status = 'completed', last_researched_at = ?11, updated_at = ?11
         WHERE id = ?1`,
      )
      .bind(
        domain.id,
        metricsId,
        metrics.backlinks,
        metrics.referringDomains,
        metrics.referringPages,
        metrics.organicTraffic,
        metrics.organicKeywords,
        metrics.trafficValue,
        metrics.authority,
        score.score,
        timestamp,
      ),
    db
      .prepare(
        `UPDATE research_jobs SET status = 'completed', completed_at = ?2, error_message = ?3, next_attempt_at = NULL
         WHERE id = ?1`,
      )
      .bind(job.id, timestamp, data.partialErrors.length > 0 ? data.partialErrors.join("; ").slice(0, 1000) : null),
  );
  await db.batch(statements);
}

async function handleFailure(
  db: D1Database,
  job: ClaimedJob,
  error: unknown,
  maxAttempts: number,
  now: Date,
): Promise<"retried" | "failed"> {
  const message = errorMessage(error).slice(0, 1000);
  const retryable = error instanceof ProviderError ? error.retryable : true;
  const timestamp = now.toISOString();
  if (retryable && job.attempts < maxAttempts) {
    const delay = BASE_BACKOFF_SECONDS * 2 ** (job.attempts - 1);
    const nextAttempt = new Date(now.getTime() + delay * 1000).toISOString();
    await db.batch([
      db
        .prepare("UPDATE research_jobs SET status = 'pending', error_message = ?2, next_attempt_at = ?3 WHERE id = ?1")
        .bind(job.id, message, nextAttempt),
      db
        .prepare("UPDATE domains SET research_status = 'pending', updated_at = ?2 WHERE id = ?1")
        .bind(job.domain_id, timestamp),
    ]);
    logger.warn("research.job_retry", { jobId: job.id, attempts: job.attempts, nextAttempt, error: message });
    return "retried";
  }
  await db.batch([
    db
      .prepare("UPDATE research_jobs SET status = 'failed', error_message = ?2, completed_at = ?3 WHERE id = ?1")
      .bind(job.id, message, timestamp),
    db
      .prepare("UPDATE domains SET research_status = 'failed', updated_at = ?2 WHERE id = ?1")
      .bind(job.domain_id, timestamp),
  ]);
  logger.error("research.job_failed", { jobId: job.id, domainId: job.domain_id, attempts: job.attempts, error: message });
  return "failed";
}

/** Returns jobs to the queue without consuming an attempt (used when the queue pauses mid-batch). */
async function releaseJobs(db: D1Database, jobs: ClaimedJob[], now: Date): Promise<void> {
  if (jobs.length === 0) return;
  const ids = JSON.stringify(jobs.map((job) => job.id));
  await db.batch([
    db
      .prepare(
        `UPDATE research_jobs SET status = 'pending', attempts = MAX(attempts - 1, 0), started_at = NULL
         WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'processing'`,
      )
      .bind(ids),
    db
      .prepare(
        `UPDATE domains SET research_status = 'pending', updated_at = ?2
         WHERE id IN (SELECT domain_id FROM research_jobs WHERE id IN (SELECT value FROM json_each(?1)) AND status = 'pending')`,
      )
      .bind(ids, now.toISOString()),
  ]);
}

export async function researchTick(
  db: D1Database,
  provider: SeoProvider | null,
  now: () => Date = () => new Date(),
): Promise<TickResult> {
  const result: TickResult = { processed: 0, completed: 0, retried: 0, failed: 0, paused: false };
  await reclaimStaleJobs(db, now());

  const control = await getQueueControl(db);
  if (control.paused) return { ...result, skipped: "paused", paused: true };
  if (!provider) return { ...result, skipped: "not_configured" };

  const settings = await getResearchSettings(db);
  const day = todayUtc(now());
  const usage = await db
    .prepare("SELECT domains FROM research_usage WHERE day = ?")
    .bind(day)
    .first<{ domains: number }>();
  const remaining = settings.dailyDomainLimit - (usage?.domains ?? 0);
  if (remaining <= 0) {
    logger.info("research.daily_limit_reached", { day, limit: settings.dailyDomainLimit });
    return { ...result, skipped: "daily_limit" };
  }

  const jobs = await claimJobs(db, Math.min(settings.batchSize, remaining), now());
  if (jobs.length === 0) return { ...result, skipped: "empty" };
  // Count attempts up-front so the daily limit is conservative even if the Worker is interrupted.
  await recordUsage(db, day, { domains: jobs.length });

  const [domains, weights] = await Promise.all([loadDomains(db, jobs.map((job) => job.domain_id)), getScoreWeights(db)]);
  let pauseError: ProviderError | null = null;
  const unprocessed = new Set(jobs.map((job) => job.id));

  await mapWithConcurrency(jobs, settings.concurrency, async (job) => {
    if (pauseError) return;
    const domain = domains.get(job.domain_id);
    unprocessed.delete(job.id);
    result.processed += 1;
    if (!domain) {
      await handleFailure(db, job, new ProviderError("Domain no longer exists.", { retryable: false }), 1, now());
      result.failed += 1;
      return;
    }
    logger.info("research.job_started", { jobId: job.id, domain: domain.domain, attempt: job.attempts });
    const usage: UsageCounter = { calls: 0, cost: 0 };
    try {
      const data = await collect(provider, domain.domain, settings, usage);
      await storeResearch(db, job, domain, provider.name, data, weights, now());
      result.completed += 1;
      logger.info("research.job_completed", { jobId: job.id, domain: domain.domain, ...usage });
    } catch (error) {
      if (error instanceof ProviderError && error.pauseQueue) {
        pauseError ??= error;
        unprocessed.add(job.id);
        result.processed -= 1;
        logger.error("dataforseo.limit_reached", { jobId: job.id, error: error.message });
        return;
      }
      const outcome = await handleFailure(db, job, error, settings.maxAttempts, now());
      result[outcome === "retried" ? "retried" : "failed"] += 1;
    } finally {
      if (usage.calls > 0) await recordUsage(db, day, { providerCalls: usage.calls, cost: usage.cost });
    }
  });

  if (pauseError) {
    const reason = (pauseError as ProviderError).message;
    await setQueueControl(db, { paused: true, pauseReason: reason });
    await releaseJobs(db, jobs.filter((job) => unprocessed.has(job.id)), now());
    result.paused = true;
    logger.warn("research.queue_auto_paused", { reason });
  }
  return result;
}
