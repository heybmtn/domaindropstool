import { analyseLabel } from "../../shared/analysis";
import type {
  BacklinkRow,
  DashboardStats,
  DomainDetail,
  DomainRow,
  HistoryPoint,
  KeywordRow,
  MetricsSnapshot,
  Paginated,
} from "../../shared/api";
import type { DomainFilter, DomainListQuery } from "../../shared/filters";
import type { ScoreLine } from "../../shared/scoring";
import { londonToday } from "../../shared/time";
import { computeWarnings } from "../../shared/warnings";
import {
  DOMAIN_COLUMNS,
  METRICS_COLUMNS,
  toBacklinkRow,
  toDomainRow,
  toJobDto,
  toKeywordRow,
  toMetricsSnapshot,
  type BacklinkDbRow,
  type DomainDbRow,
  type JobDbRow,
  type KeywordDbRow,
  type MetricsDbRow,
} from "../db/rows";
import { notFound } from "../utils/errors";
import { buildDomainWhere, buildOrderBy } from "./domainQuery";
import { getLastCompletedImport } from "./importService";
import { getImportStats, refreshImportStats } from "./settings";

/** Read-side queries for domains. Always paginated and index-driven. */

export async function listDomains(
  db: D1Database,
  query: DomainListQuery,
  options: { count?: boolean; now?: Date } = {},
): Promise<Paginated<DomainRow>> {
  const { sort, dir, page, pageSize, ...filter } = query;
  const now = options.now ?? new Date();
  const where = buildDomainWhere(filter, now);
  const offset = (page - 1) * pageSize;
  const { results } = await db
    .prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains d ${where.sql} ${buildOrderBy(sort, dir)} LIMIT ? OFFSET ?`)
    .bind(...where.params, pageSize, offset)
    .all<DomainDbRow>();
  // Counting scans every matching row (billed per row), so callers can skip it
  // and fetch the total separately, once per filter rather than once per page.
  const total = options.count === false ? null : await countDomains(db, filter, now);
  return { items: results.map(toDomainRow), page, pageSize, total };
}

/** True when the filter has no conditions other than the given ones. */
function isOnly(filter: DomainFilter, allowed: Partial<DomainFilter>): boolean {
  const entries = Object.entries(filter).filter(([, value]) => value !== undefined && value !== "");
  return (
    entries.length === Object.keys(allowed).length &&
    entries.every(([key, value]) => allowed[key as keyof DomainFilter] === value)
  );
}

export async function countDomains(db: D1Database, filter: DomainFilter, now = new Date()): Promise<number> {
  // Whole-table counts come from the per-import cache instead of a full scan.
  if (isOnly(filter, {}) || isOnly(filter, { domainStatus: "listed" })) {
    const cached = await getImportStats(db);
    if (cached) return isOnly(filter, {}) ? cached.totalDomains : cached.listedDomains;
  }
  const where = buildDomainWhere(filter, now);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM domains d ${where.sql}`)
    .bind(...where.params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getDomainRow(db: D1Database, id: number): Promise<DomainRow> {
  const row = await db.prepare(`SELECT ${DOMAIN_COLUMNS} FROM domains d WHERE d.id = ?`).bind(id).first<DomainDbRow>();
  if (!row) throw notFound("Domain");
  return toDomainRow(row);
}

export async function getMetricsHistory(db: D1Database, domainId: number, limit = 100): Promise<MetricsSnapshot[]> {
  const { results } = await db
    .prepare(
      `SELECT ${METRICS_COLUMNS} FROM domain_metrics WHERE domain_id = ? ORDER BY metric_date DESC, id DESC LIMIT ?`,
    )
    .bind(domainId, limit)
    .all<MetricsDbRow>();
  return results.map(toMetricsSnapshot);
}

export async function getProviderHistory(db: D1Database, domainId: number): Promise<HistoryPoint[]> {
  const { results } = await db
    .prepare(
      `SELECT month, organic_traffic, organic_keywords, backlinks, referring_domains
       FROM domain_history WHERE domain_id = ? ORDER BY month ASC LIMIT 120`,
    )
    .bind(domainId)
    .all<{
      month: string;
      organic_traffic: number | null;
      organic_keywords: number | null;
      backlinks: number | null;
      referring_domains: number | null;
    }>();
  return results.map((row) => ({
    month: row.month,
    organicTraffic: row.organic_traffic,
    organicKeywords: row.organic_keywords,
    backlinks: row.backlinks,
    referringDomains: row.referring_domains,
  }));
}

async function latestMetricsId(db: D1Database, domainId: number): Promise<number | null> {
  const row = await db
    .prepare("SELECT latest_metrics_id AS id FROM domains WHERE id = ?")
    .bind(domainId)
    .first<{ id: number | null }>();
  if (!row) throw notFound("Domain");
  return row.id;
}

export async function getKeywords(db: D1Database, domainId: number): Promise<KeywordRow[]> {
  const metricsId = await latestMetricsId(db, domainId);
  if (metricsId === null) return [];
  const { results } = await db
    .prepare(
      `SELECT keyword, position, search_volume, etv, url FROM domain_keywords
       WHERE metrics_id = ? ORDER BY etv DESC NULLS LAST, position ASC LIMIT 200`,
    )
    .bind(metricsId)
    .all<KeywordDbRow>();
  return results.map(toKeywordRow);
}

export async function getBacklinks(db: D1Database, domainId: number): Promise<BacklinkRow[]> {
  const metricsId = await latestMetricsId(db, domainId);
  if (metricsId === null) return [];
  const { results } = await db
    .prepare(
      `SELECT referring_domain, source_url, target_url, anchor, link_type, domain_rank, first_seen
       FROM domain_backlinks WHERE metrics_id = ? ORDER BY domain_rank DESC NULLS LAST LIMIT 200`,
    )
    .bind(metricsId)
    .all<BacklinkDbRow>();
  return results.map(toBacklinkRow);
}

export async function getDomainDetail(db: D1Database, id: number, now = new Date()): Promise<DomainDetail> {
  const domain = await getDomainRow(db, id);
  const [latestRow, favourite, job, keywordTraffic, history] = await db.batch([
    db
      .prepare(`SELECT ${METRICS_COLUMNS} FROM domain_metrics WHERE domain_id = ? ORDER BY metric_date DESC, id DESC LIMIT 1`)
      .bind(id),
    db.prepare("SELECT 1 AS yes FROM favourites WHERE domain_id = ?").bind(id),
    db
      .prepare(
        "SELECT j.*, d.domain FROM research_jobs j JOIN domains d ON d.id = j.domain_id WHERE j.domain_id = ? ORDER BY j.id DESC LIMIT 1",
      )
      .bind(id),
    db
      .prepare(
        `SELECT SUM(etv) AS top FROM (SELECT etv FROM domain_keywords k JOIN domains d ON d.latest_metrics_id = k.metrics_id
         WHERE d.id = ? ORDER BY etv DESC LIMIT 3)`,
      )
      .bind(id),
    db.prepare("SELECT organic_traffic FROM domain_history WHERE domain_id = ? ORDER BY month ASC").bind(id),
  ]);

  const metricsRow = latestRow?.results?.[0] as MetricsDbRow | undefined;
  const latest = metricsRow ? toMetricsSnapshot(metricsRow) : null;
  let scoreBreakdown: ScoreLine[] = [];
  if (metricsRow?.score_breakdown) {
    try {
      scoreBreakdown = JSON.parse(metricsRow.score_breakdown) as ScoreLine[];
    } catch {
      scoreBreakdown = [];
    }
  }
  const topKeywordsTraffic = (keywordTraffic?.results?.[0] as { top: number | null } | undefined)?.top ?? null;
  const trafficHistory = ((history?.results ?? []) as { organic_traffic: number | null }[])
    .map((row) => row.organic_traffic)
    .filter((value): value is number => value !== null);

  return {
    domain,
    analysis: analyseLabel(domain.sld),
    latest,
    scoreBreakdown,
    warnings: computeWarnings(
      {
        researchStatus: domain.researchStatus,
        lastResearchedAt: domain.lastResearchedAt,
        backlinks: domain.backlinks,
        referringDomains: domain.referringDomains,
        organicTraffic: domain.organicTraffic,
        organicKeywords: domain.organicKeywords,
        topKeywordsTraffic,
        trafficHistory,
        spamScore: latest?.spamScore ?? null,
      },
      now,
    ),
    isShortlisted: (favourite?.results?.length ?? 0) > 0,
    latestJob: job?.results?.[0] ? toJobDto(job.results[0] as JobDbRow) : null,
  };
}

export async function getDashboardStats(db: D1Database, now = new Date()): Promise<DashboardStats> {
  const today = londonToday(now);
  // Cheap, index-backed live counts; whole-table figures come from the import cache.
  const [live, cached, lastImport] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM domains WHERE drop_date = ?1) AS todays,
           (SELECT COUNT(*) FROM domains WHERE research_status = 'completed') AS researched,
           (SELECT COUNT(*) FROM favourites) AS shortlisted`,
      )
      .bind(today)
      .first<{ todays: number; researched: number; shortlisted: number }>(),
    getImportStats(db).then((stats) => stats ?? refreshImportStats(db, now)),
    getLastCompletedImport(db),
  ]);
  const researched = live?.researched ?? 0;
  return {
    today,
    todaysDomains: live?.todays ?? 0,
    totalDomains: cached.totalDomains,
    listedDomains: cached.listedDomains,
    researched,
    unresearched: Math.max(0, cached.totalDomains - researched),
    shortlisted: live?.shortlisted ?? 0,
    lastImport,
    upcomingDropDates: cached.upcomingDropDates.filter((day) => day.dropDate >= today).slice(0, 14),
  };
}
