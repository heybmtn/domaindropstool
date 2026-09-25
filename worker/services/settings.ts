import { researchSettingsSchema, type ResearchSettings } from "../../shared/api";
import { DEFAULT_SCORE_WEIGHTS, scoreWeightsSchema, type ScoreWeights } from "../../shared/scoring";
import { DEFAULT_REGISTRAR, registrarSettingsSchema, type RegistrarSettings } from "../../shared/registrar";
import { londonToday } from "../../shared/time";
import { logger } from "../utils/logger";
import { nowIso } from "../utils/time";

/** D1-backed application settings with safe defaults. */

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  dailyDomainLimit: 200,
  batchSize: 10,
  concurrency: 2,
  maxAttempts: 3,
  maxEnqueuePerRequest: 1000,
  locationCode: 2826, // United Kingdom
  languageCode: "en",
  fetchKeywords: true,
  fetchBacklinks: true,
  fetchHistory: false,
  keywordLimit: 20,
  backlinkLimit: 20,
};

export interface QueueControl {
  paused: boolean;
  pauseReason: string | null;
}

const DEFAULT_QUEUE: QueueControl = { paused: false, pauseReason: null };

async function readSetting(db: D1Database, key: string): Promise<unknown> {
  const row = await db.prepare("SELECT value_json FROM settings WHERE key = ?").bind(key).first<{ value_json: string }>();
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json);
  } catch (error) {
    logger.warn("settings.corrupt_value", { key, error });
    return undefined;
  }
}

async function writeSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), nowIso())
    .run();
}

export async function getResearchSettings(db: D1Database): Promise<ResearchSettings> {
  const stored = await readSetting(db, "research");
  const merged = { ...DEFAULT_RESEARCH_SETTINGS, ...(typeof stored === "object" && stored ? stored : {}) };
  const parsed = researchSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_RESEARCH_SETTINGS;
}

export async function updateResearchSettings(
  db: D1Database,
  patch: Partial<ResearchSettings>,
): Promise<ResearchSettings> {
  const next = researchSettingsSchema.parse({ ...(await getResearchSettings(db)), ...patch });
  await writeSetting(db, "research", next);
  return next;
}

export async function getScoreWeights(db: D1Database): Promise<ScoreWeights> {
  const parsed = scoreWeightsSchema.safeParse(await readSetting(db, "scoring"));
  return parsed.success ? parsed.data : DEFAULT_SCORE_WEIGHTS;
}

export async function updateScoreWeights(db: D1Database, weights: ScoreWeights): Promise<ScoreWeights> {
  const next = scoreWeightsSchema.parse(weights);
  await writeSetting(db, "scoring", next);
  return next;
}

export async function getQueueControl(db: D1Database): Promise<QueueControl> {
  const stored = await readSetting(db, "queue");
  if (typeof stored !== "object" || stored === null) return DEFAULT_QUEUE;
  const value = stored as Partial<QueueControl>;
  return { paused: value.paused === true, pauseReason: typeof value.pauseReason === "string" ? value.pauseReason : null };
}

export async function setQueueControl(db: D1Database, control: QueueControl): Promise<void> {
  await writeSetting(db, "queue", control);
}

export async function getRegistrarSettings(db: D1Database): Promise<RegistrarSettings> {
  const parsed = registrarSettingsSchema.safeParse(await readSetting(db, "registrar"));
  return parsed.success ? parsed.data : DEFAULT_REGISTRAR;
}

export async function updateRegistrarSettings(db: D1Database, registrar: RegistrarSettings): Promise<RegistrarSettings> {
  const next = registrarSettingsSchema.parse(registrar);
  await writeSetting(db, "registrar", next);
  return next;
}

/**
 * Whole-table counts are expensive in D1 (every scanned row is billed), so they
 * are computed once per import and cached here.
 */
export interface ImportStats {
  totalDomains: number;
  listedDomains: number;
  upcomingDropDates: { dropDate: string; count: number }[];
  computedAt: string;
}

export async function getImportStats(db: D1Database): Promise<ImportStats | null> {
  const value = await readSetting(db, "import_stats");
  if (typeof value !== "object" || value === null) return null;
  const stats = value as Partial<ImportStats>;
  if (typeof stats.totalDomains !== "number" || typeof stats.listedDomains !== "number") return null;
  return {
    totalDomains: stats.totalDomains,
    listedDomains: stats.listedDomains,
    upcomingDropDates: Array.isArray(stats.upcomingDropDates) ? stats.upcomingDropDates : [],
    computedAt: typeof stats.computedAt === "string" ? stats.computedAt : "",
  };
}

/** Recomputes and stores the cached whole-table stats (a few full scans; run once per import). */
export async function refreshImportStats(db: D1Database, now: Date = new Date()): Promise<ImportStats> {
  const [totals, upcoming] = await db.batch([
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM domains) AS total, (SELECT COUNT(*) FROM domains WHERE status = 'listed') AS listed",
    ),
    db
      .prepare(
        `SELECT drop_date, COUNT(*) AS n FROM domains
         WHERE status = 'listed' AND drop_date >= ?1 GROUP BY drop_date ORDER BY drop_date ASC LIMIT 60`,
      )
      .bind(londonToday(now)),
  ]);
  const row = (totals?.results?.[0] ?? {}) as { total?: number; listed?: number };
  const stats: ImportStats = {
    totalDomains: row.total ?? 0,
    listedDomains: row.listed ?? 0,
    upcomingDropDates: ((upcoming?.results ?? []) as { drop_date: string; n: number }[]).map((r) => ({
      dropDate: r.drop_date,
      count: r.n,
    })),
    computedAt: now.toISOString(),
  };
  await writeSetting(db, "import_stats", stats);
  return stats;
}
