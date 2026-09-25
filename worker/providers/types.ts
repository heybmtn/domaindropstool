/**
 * Provider abstractions. The rest of the application depends only on these
 * interfaces and normalised types, never on provider request/response formats.
 */

// ---------------------------------------------------------------------------
// Drop lists
// ---------------------------------------------------------------------------

export interface DropListSource {
  /** Stable provider identifier stored on import batches, e.g. "nominet". */
  source: string;
  url: string | null;
  /** Raw file bytes as published (may be gzip-compressed). */
  bytes: Uint8Array;
  /** Checksum published alongside the file, if any (lowercase hex sha256). */
  publishedChecksum: string | null;
  compressed: boolean;
}

export interface DropListProvider {
  readonly source: string;
  /** Cheap check: the checksum of the currently published list, or null if unavailable. */
  getLatestChecksum(): Promise<string | null>;
  /** Downloads the currently published list. */
  getLatest(): Promise<DropListSource>;
}

/** One parsed drop-list row after column mapping (before domain validation). */
export interface DropListRecord {
  line: number;
  rawDomain: string;
  roid: string | null;
  /** ISO-8601 UTC timestamp if a drop time was supplied and parseable. */
  dropTime: string | null;
}

// ---------------------------------------------------------------------------
// SEO research
// ---------------------------------------------------------------------------

export interface ResearchOptions {
  locationCode: number;
  languageCode: string;
  keywordLimit: number;
  backlinkLimit: number;
}

export interface BacklinkSummary {
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  referringPages: number | null;
  /** Provider authority/rank metric for the target. */
  rank: number | null;
  spamScore: number | null;
}

export interface DomainOverview {
  organicTraffic: number | null;
  organicKeywords: number | null;
  /** Estimated monthly cost of the organic traffic in paid search. */
  trafficValue: number | null;
}

export interface KeywordData {
  totalCount: number | null;
  items: {
    keyword: string;
    position: number | null;
    searchVolume: number | null;
    etv: number | null;
    url: string | null;
  }[];
}

export interface BacklinkData {
  items: {
    referringDomain: string | null;
    sourceUrl: string | null;
    targetUrl: string | null;
    anchor: string | null;
    linkType: "dofollow" | "nofollow" | null;
    domainRank: number | null;
    firstSeen: string | null;
  }[];
}

export interface HistoryData {
  points: {
    month: string; // YYYY-MM
    organicTraffic: number | null;
    organicKeywords: number | null;
    backlinks: number | null;
    referringDomains: number | null;
  }[];
}

export interface ProviderCallResult<T> {
  data: T;
  /** Provider-reported cost (USD) if available. */
  cost: number;
  /** Trimmed raw payload for audit/debugging. */
  raw: unknown;
}

export interface SeoProvider {
  readonly name: string;
  getBacklinkSummary(domain: string): Promise<ProviderCallResult<BacklinkSummary>>;
  getDomainOverview(domain: string, options: ResearchOptions): Promise<ProviderCallResult<DomainOverview>>;
  getOrganicKeywords(domain: string, options: ResearchOptions): Promise<ProviderCallResult<KeywordData>>;
  getBacklinks(domain: string, options: ResearchOptions): Promise<ProviderCallResult<BacklinkData>>;
  getHistory(domain: string, options: ResearchOptions): Promise<ProviderCallResult<HistoryData>>;
  /** Verifies credentials without incurring research cost. */
  testConnection(): Promise<{ ok: boolean; message: string; balance?: number | null }>;
}

/**
 * Error raised by providers. `retryable` drives the job retry policy;
 * `pauseQueue` signals account-level problems (rate limits, balance) that
 * should pause all research until a human resumes it.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly options: { retryable: boolean; pauseQueue?: boolean; status?: number; providerCode?: number } = {
      retryable: false,
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.options.retryable;
  }

  get pauseQueue(): boolean {
    return this.options.pauseQueue === true;
  }
}
