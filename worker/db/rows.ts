import type {
  BacklinkRow,
  DomainRow,
  ImportBatchDto,
  KeywordRow,
  MetricsSnapshot,
  NoteDto,
  ResearchJobDto,
  ResearchStatus,
} from "../../shared/api";
import type { DomainStatus, UserStatus } from "../../shared/filters";

/** Raw D1 row shapes and their mappers to API DTOs. */

export interface DomainDbRow {
  id: number;
  domain: string;
  tld: string;
  sld: string;
  length: number;
  hyphens: number;
  digits: number;
  word_count?: number | null;
  roid: string | null;
  drop_date: string | null;
  drop_time: string | null;
  status: DomainStatus;
  user_status: UserStatus;
  research_status: ResearchStatus;
  last_researched_at: string | null;
  latest_metrics_id: number | null;
  latest_backlinks: number | null;
  latest_referring_domains: number | null;
  latest_referring_pages: number | null;
  latest_organic_traffic: number | null;
  latest_organic_keywords: number | null;
  latest_traffic_value: number | null;
  latest_authority: number | null;
  research_score: number | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  note_count?: number;
  is_shortlisted?: number;
}

/** Columns selected for table rows (keeps payloads small). */
export const DOMAIN_COLUMNS = `d.id, d.domain, d.tld, d.sld, d.length, d.hyphens, d.digits, d.word_count, d.roid, d.drop_date, d.drop_time,
  d.status, d.user_status, d.research_status, d.last_researched_at, d.latest_metrics_id, d.latest_backlinks,
  d.latest_referring_domains, d.latest_referring_pages, d.latest_organic_traffic, d.latest_organic_keywords,
  d.latest_traffic_value, d.latest_authority, d.research_score, d.first_seen_at, d.last_seen_at, d.created_at,
  d.updated_at, (SELECT COUNT(*) FROM notes n WHERE n.domain_id = d.id) AS note_count,
  EXISTS (SELECT 1 FROM favourites f WHERE f.domain_id = d.id) AS is_shortlisted`;

export function toDomainRow(row: DomainDbRow): DomainRow {
  return {
    id: row.id,
    domain: row.domain,
    tld: row.tld,
    sld: row.sld,
    length: row.length,
    hyphens: row.hyphens,
    digits: row.digits,
    wordCount: row.word_count ?? null,
    dropDate: row.drop_date,
    dropTime: row.drop_time,
    status: row.status,
    userStatus: row.user_status,
    researchStatus: row.research_status,
    lastResearchedAt: row.last_researched_at,
    backlinks: row.latest_backlinks,
    referringDomains: row.latest_referring_domains,
    referringPages: row.latest_referring_pages,
    organicTraffic: row.latest_organic_traffic,
    organicKeywords: row.latest_organic_keywords,
    trafficValue: row.latest_traffic_value,
    authority: row.latest_authority,
    researchScore: row.research_score,
    firstSeenAt: row.first_seen_at,
    noteCount: row.note_count ?? 0,
    isShortlisted: row.is_shortlisted === 1,
  };
}

export interface MetricsDbRow {
  id: number;
  domain_id: number;
  provider: string;
  metric_date: string;
  backlinks: number | null;
  referring_domains: number | null;
  referring_pages: number | null;
  organic_traffic: number | null;
  organic_keywords: number | null;
  traffic_value: number | null;
  visibility: number | null;
  authority_metric: number | null;
  spam_score: number | null;
  research_score: number | null;
  score_breakdown: string | null;
  created_at: string;
}

export const METRICS_COLUMNS = `id, domain_id, provider, metric_date, backlinks, referring_domains, referring_pages,
  organic_traffic, organic_keywords, traffic_value, visibility, authority_metric, spam_score, research_score,
  score_breakdown, created_at`;

export function toMetricsSnapshot(row: MetricsDbRow): MetricsSnapshot {
  return {
    id: row.id,
    provider: row.provider,
    metricDate: row.metric_date,
    backlinks: row.backlinks,
    referringDomains: row.referring_domains,
    referringPages: row.referring_pages,
    organicTraffic: row.organic_traffic,
    organicKeywords: row.organic_keywords,
    trafficValue: row.traffic_value,
    visibility: row.visibility,
    authorityMetric: row.authority_metric,
    spamScore: row.spam_score,
    researchScore: row.research_score,
    createdAt: row.created_at,
  };
}

export interface KeywordDbRow {
  keyword: string;
  position: number | null;
  search_volume: number | null;
  etv: number | null;
  url: string | null;
}

export function toKeywordRow(row: KeywordDbRow): KeywordRow {
  return { keyword: row.keyword, position: row.position, searchVolume: row.search_volume, etv: row.etv, url: row.url };
}

export interface BacklinkDbRow {
  referring_domain: string | null;
  source_url: string | null;
  target_url: string | null;
  anchor: string | null;
  link_type: string | null;
  domain_rank: number | null;
  first_seen: string | null;
}

export function toBacklinkRow(row: BacklinkDbRow): BacklinkRow {
  return {
    referringDomain: row.referring_domain,
    sourceUrl: row.source_url,
    targetUrl: row.target_url,
    anchor: row.anchor,
    linkType: row.link_type,
    domainRank: row.domain_rank,
    firstSeen: row.first_seen,
  };
}

export interface JobDbRow {
  id: number;
  domain_id: number;
  domain: string;
  job_type: string;
  status: ResearchJobDto["status"];
  priority: number;
  attempts: number;
  provider_task_id: string | null;
  error_message: string | null;
  next_attempt_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export function toJobDto(row: JobDbRow): ResearchJobDto {
  return {
    id: row.id,
    domainId: row.domain_id,
    domain: row.domain,
    jobType: row.job_type,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    errorMessage: row.error_message,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export interface ImportBatchDbRow {
  id: number;
  source: string;
  source_url: string | null;
  checksum: string | null;
  r2_key: string | null;
  drop_date: string | null;
  total_records: number;
  inserted_records: number;
  duplicate_records: number;
  failed_records: number;
  skipped_records: number;
  removed_records: number;
  valid_records: number | null;
  phase: string | null;
  chunk_count: number | null;
  chunks_done: number | null;
  status: ImportBatchDto["status"];
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export function toImportBatchDto(row: ImportBatchDbRow): ImportBatchDto {
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    checksum: row.checksum,
    r2Key: row.r2_key,
    dropDate: row.drop_date,
    totalRecords: row.total_records,
    insertedRecords: row.inserted_records,
    duplicateRecords: row.duplicate_records,
    failedRecords: row.failed_records,
    skippedRecords: row.skipped_records,
    removedRecords: row.removed_records,
    validRecords: row.valid_records ?? null,
    phase: row.phase ?? null,
    chunkCount: row.chunk_count ?? null,
    chunksDone: row.chunks_done ?? 0,
    status: row.status,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export interface NoteDbRow {
  id: number;
  domain_id: number;
  note: string;
  created_at: string;
  updated_at: string;
}

export function toNoteDto(row: NoteDbRow): NoteDto {
  return { id: row.id, domainId: row.domain_id, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at };
}
