import { z } from "zod";
import { domainFilterSchema, USER_STATUSES, type DomainStatus, type UserStatus } from "./filters";
import type { LocalAnalysis } from "./analysis";
import type { ScoreLine, ScoreWeights } from "./scoring";
import { scoreWeightsSchema } from "./scoring";
import type { ResearchWarning } from "./warnings";

/** Shapes exchanged between the Worker API and the React client. */

export type ResearchStatus = "none" | "pending" | "processing" | "completed" | "failed";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type ImportStatus = "running" | "completed" | "failed" | "skipped";

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface DomainRow {
  id: number;
  domain: string;
  tld: string;
  sld: string;
  length: number;
  hyphens: number;
  digits: number;
  dropDate: string | null;
  dropTime: string | null;
  status: DomainStatus;
  userStatus: UserStatus;
  researchStatus: ResearchStatus;
  lastResearchedAt: string | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  trafficValue: number | null;
  authority: number | null;
  researchScore: number | null;
  firstSeenAt: string;
  noteCount: number;
}

export interface MetricsSnapshot {
  id: number;
  provider: string;
  metricDate: string;
  backlinks: number | null;
  referringDomains: number | null;
  referringPages: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  trafficValue: number | null;
  visibility: number | null;
  authorityMetric: number | null;
  spamScore: number | null;
  researchScore: number | null;
  createdAt: string;
}

export interface HistoryPoint {
  month: string;
  organicTraffic: number | null;
  organicKeywords: number | null;
  backlinks: number | null;
  referringDomains: number | null;
}

export interface KeywordRow {
  keyword: string;
  position: number | null;
  searchVolume: number | null;
  etv: number | null;
  url: string | null;
}

export interface BacklinkRow {
  referringDomain: string | null;
  sourceUrl: string | null;
  targetUrl: string | null;
  anchor: string | null;
  linkType: string | null;
  domainRank: number | null;
  firstSeen: string | null;
}

export interface NoteDto {
  id: number;
  domainId: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainDetail {
  domain: DomainRow;
  analysis: LocalAnalysis;
  latest: MetricsSnapshot | null;
  scoreBreakdown: ScoreLine[];
  warnings: ResearchWarning[];
  isShortlisted: boolean;
  latestJob: ResearchJobDto | null;
}

export interface ResearchJobDto {
  id: number;
  domainId: number;
  domain: string;
  jobType: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  errorMessage: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface QueueCounts {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface QueueState {
  counts: QueueCounts;
  paused: boolean;
  pauseReason: string | null;
  usageToday: { domains: number; providerCalls: number; cost: number };
  dailyLimit: number;
  limitReached: boolean;
  providerConfigured: boolean;
}

export interface ImportBatchDto {
  id: number;
  source: string;
  sourceUrl: string | null;
  checksum: string | null;
  r2Key: string | null;
  dropDate: string | null;
  totalRecords: number;
  insertedRecords: number;
  duplicateRecords: number;
  failedRecords: number;
  skippedRecords: number;
  removedRecords: number;
  /** Valid, unique .co.uk rows in the file. */
  validRecords: number | null;
  /** 'loading' while chunks are being written; null otherwise. */
  phase: string | null;
  chunkCount: number | null;
  chunksDone: number;
  status: ImportStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface DashboardStats {
  today: string;
  todaysDomains: number;
  totalDomains: number;
  listedDomains: number;
  researched: number;
  unresearched: number;
  shortlisted: number;
  lastImport: ImportBatchDto | null;
  upcomingDropDates: { dropDate: string; count: number }[];
}

export interface SavedFilterDto {
  id: number;
  name: string;
  configuration: z.infer<typeof domainFilterSchema>;
  createdAt: string;
  updatedAt: string;
}

export const researchSettingsSchema = z.object({
  /** Maximum domains researched per UTC day. */
  dailyDomainLimit: z.number().int().min(0).max(100_000),
  /** Jobs claimed per cron tick. */
  batchSize: z.number().int().min(1).max(200),
  /** Parallel provider requests within a tick. */
  concurrency: z.number().int().min(1).max(10),
  /** Attempts before a job is marked failed. */
  maxAttempts: z.number().int().min(1).max(10),
  /** Maximum jobs a single "Research" request may enqueue. */
  maxEnqueuePerRequest: z.number().int().min(1).max(10_000),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(2).max(8),
  fetchKeywords: z.boolean(),
  fetchBacklinks: z.boolean(),
  fetchHistory: z.boolean(),
  keywordLimit: z.number().int().min(1).max(1000),
  backlinkLimit: z.number().int().min(1).max(1000),
});
export type ResearchSettings = z.infer<typeof researchSettingsSchema>;

export interface SettingsDto {
  research: ResearchSettings;
  scoring: ScoreWeights;
  queue: { paused: boolean; pauseReason: string | null };
  nominet: { dropListUrl: string; lastImport: ImportBatchDto | null };
  dataforseo: { configured: boolean; baseUrl: string; mock: boolean };
  auth: { mode: "token" | "open"; tokenRequired: boolean };
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const idList = z.array(z.number().int().positive()).min(1).max(10_000);

export const researchRequestSchema = z
  .object({
    domainIds: idList.optional(),
    filter: domainFilterSchema.optional(),
    /** Required for filter-based requests: the count the user confirmed in the UI. */
    confirmCount: z.number().int().min(1).optional(),
    priority: z.number().int().min(-10).max(10).default(0),
    force: z.boolean().default(false),
  })
  .refine((body) => body.domainIds !== undefined || body.filter !== undefined, {
    message: "Provide domainIds or filter",
  });
export type ResearchRequest = z.infer<typeof researchRequestSchema>;

export const savedFilterBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  configuration: domainFilterSchema,
});

export const noteBodySchema = z.object({
  note: z.string().trim().min(1).max(5000),
});

export const shortlistBodySchema = z.object({
  domainIds: idList,
});

export const statusBodySchema = z.object({
  domainIds: idList,
  userStatus: z.enum(USER_STATUSES),
});

export const settingsUpdateSchema = z.object({
  research: researchSettingsSchema.partial().optional(),
  scoring: scoreWeightsSchema.optional(),
});

export interface ResearchEnqueueResult {
  requested: number;
  enqueued: number;
  alreadyQueued: number;
  skippedRecent: number;
}

export interface CsvExportRow {
  domain: string;
  drop_date: string | null;
  drop_time_uk: string;
  length: number;
  hyphens: number;
  numbers: number;
  backlinks: number | null;
  referring_domains: number | null;
  organic_traffic: number | null;
  organic_keywords: number | null;
  traffic_value: number | null;
  research_score: number | null;
  status: string;
  notes: string | null;
}
