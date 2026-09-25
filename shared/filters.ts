import { z } from "zod";
import { addDays, londonToday } from "./time";

/**
 * Canonical domain filter used by the table, saved filters, "research all
 * filtered" and CSV export. Every field is optional and filters compose with AND.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const count = z.coerce.number().int().min(0).max(1_000_000_000);
const amount = z.coerce.number().min(0).max(1e12);
const shortText = z.string().trim().toLowerCase().max(63);
const booleanLike = z.preprocess((value) => {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean());

export const SEARCH_MODES = ["partial", "exact", "starts", "ends"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const RESEARCH_STATES = ["completed", "none", "failed", "pending"] as const;
export type ResearchStateFilter = (typeof RESEARCH_STATES)[number];

export const USER_STATUSES = ["none", "shortlisted", "ignored", "registered", "sold"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const DOMAIN_STATUSES = ["listed", "removed", "dropped"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const SORT_FIELDS = [
  "domain",
  "drop_date",
  "length",
  "referring_domains",
  "backlinks",
  "organic_traffic",
  "organic_keywords",
  "traffic_value",
  "research_score",
  "last_researched_at",
  "created_at",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/** Relative date keywords accepted wherever a date is expected. */
export const dateInput = z.union([z.enum(["today", "tomorrow", "yesterday"]), z.string().regex(DATE)]);

export const domainFilterSchema = z
  .object({
    // Search
    q: shortText.optional(),
    searchMode: z.enum(SEARCH_MODES).optional(),
    // Drop
    dropDate: dateInput.optional(),
    dropFrom: dateInput.optional(),
    dropTo: dateInput.optional(),
    // Domain (lexical)
    minLength: count.optional(),
    maxLength: count.optional(),
    contains: shortText.optional(),
    excludes: shortText.optional(),
    startsWith: shortText.optional(),
    endsWith: shortText.optional(),
    hasNumbers: booleanLike.optional(),
    hasHyphen: booleanLike.optional(),
    maxHyphens: count.optional(),
    maxNumbers: count.optional(),
    /** Heuristic word count (1–10); unknown labels never match. */
    words: z.coerce.number().int().min(1).max(10).optional(),
    // SEO (latest snapshot)
    minBacklinks: count.optional(),
    maxBacklinks: count.optional(),
    minReferringDomains: count.optional(),
    maxReferringDomains: count.optional(),
    minOrganicTraffic: amount.optional(),
    maxOrganicTraffic: amount.optional(),
    minOrganicKeywords: count.optional(),
    maxOrganicKeywords: count.optional(),
    minScore: count.optional(),
    // Research
    research: z.enum(RESEARCH_STATES).optional(),
    researchOlderThanDays: count.optional(),
    // Status
    userStatus: z.enum(USER_STATUSES).optional(),
    hideIgnored: booleanLike.optional(),
    /** Only domains on the shortlist (favourites). */
    shortlisted: booleanLike.optional(),
    domainStatus: z.enum(DOMAIN_STATUSES).optional(),
  })
  .strip();

export type DomainFilter = z.infer<typeof domainFilterSchema>;

export const sortSchema = z.object({
  sort: z.enum(SORT_FIELDS).default("drop_date"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const domainListQuerySchema = domainFilterSchema.extend(sortSchema.shape).extend(pageSchema.shape);
export type DomainListQuery = z.infer<typeof domainListQuerySchema>;

/**
 * Short, bookmarkable URL aliases, e.g. `/domains?drop=today&maxLength=15&minRD=20`.
 * Keys not listed here use their canonical name in the URL.
 */
export const URL_ALIASES: Readonly<Record<string, keyof DomainFilter>> = {
  drop: "dropDate",
  minRD: "minReferringDomains",
  maxRD: "maxReferringDomains",
  minBL: "minBacklinks",
  maxBL: "maxBacklinks",
  minTraffic: "minOrganicTraffic",
  maxTraffic: "maxOrganicTraffic",
  minKw: "minOrganicKeywords",
  maxKw: "maxOrganicKeywords",
  mode: "searchMode",
};

const CANONICAL_TO_ALIAS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(URL_ALIASES).map(([alias, canonical]) => [canonical, alias]),
);

/** Converts URL search params (aliases allowed) into a raw object for schema parsing. */
export function searchParamsToRecord(params: URLSearchParams): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [key, value] of params) {
    if (value === "") continue;
    record[URL_ALIASES[key] ?? key] = value;
  }
  return record;
}

/** Parses URL params into a validated filter, silently dropping invalid values. */
export function filterFromSearchParams(params: URLSearchParams): DomainFilter {
  const record = searchParamsToRecord(params);
  const parsed = domainFilterSchema.safeParse(record);
  if (parsed.success) return parsed.data;
  // Drop only the offending keys so one bad value does not reset the view.
  const cleaned: Record<string, string> = { ...record };
  for (const issue of parsed.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string") delete cleaned[key];
  }
  const retry = domainFilterSchema.safeParse(cleaned);
  return retry.success ? retry.data : {};
}

/** Serialises a filter into URL params using short aliases. */
export function filterToSearchParams(filter: DomainFilter, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of Object.keys(domainFilterSchema.shape)) {
    params.delete(key);
    const alias = CANONICAL_TO_ALIAS[key];
    if (alias) params.delete(alias);
  }
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(CANONICAL_TO_ALIAS[key] ?? key, String(value));
  }
  return params;
}

/** Number of active (non-empty) filter conditions, excluding search text. */
export function activeFilterCount(filter: DomainFilter): number {
  return Object.entries(filter).filter(
    ([key, value]) => key !== "q" && key !== "searchMode" && value !== undefined && value !== "",
  ).length;
}

/** Resolves `today` / `tomorrow` / `yesterday` to a UK calendar date (drop dates are UK days). */
export function resolveDate(value: string, now: Date = new Date()): string {
  const offsets: Record<string, number> = { yesterday: -1, today: 0, tomorrow: 1 };
  const offset = offsets[value];
  if (offset === undefined) return value;
  return addDays(londonToday(now), offset);
}
