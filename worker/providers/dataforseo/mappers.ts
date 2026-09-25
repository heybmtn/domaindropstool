import type { BacklinkData, BacklinkSummary, DomainOverview, HistoryData, KeywordData } from "../types";

/**
 * The only module that knows DataForSEO response field names.
 * Every accessor is defensive: missing fields map to null, never to 0.
 */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function path(value: unknown, keys: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (!isObject(current)) return undefined;
      current = current[key];
    }
  }
  return current;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** backlinks/summary/live → result[0] */
export function mapBacklinkSummary(result: unknown[]): BacklinkSummary {
  const summary = result[0];
  return {
    backlinks: num(path(summary, ["backlinks"])),
    referringDomains: num(path(summary, ["referring_domains"])),
    referringMainDomains: num(path(summary, ["referring_main_domains"])),
    referringPages: num(path(summary, ["referring_pages"])),
    rank: num(path(summary, ["rank"])),
    spamScore: num(path(summary, ["backlinks_spam_score"])),
  };
}

/** dataforseo_labs/google/domain_rank_overview/live → result[0].items[0].metrics.organic */
export function mapDomainOverview(result: unknown[]): DomainOverview {
  const organic = path(result, [0, "items", 0, "metrics", "organic"]);
  return {
    organicTraffic: num(path(organic, ["etv"])),
    organicKeywords: num(path(organic, ["count"])),
    trafficValue: num(path(organic, ["estimated_paid_traffic_cost"])),
  };
}

/** dataforseo_labs/google/ranked_keywords/live → result[0].items[] */
export function mapRankedKeywords(result: unknown[]): KeywordData {
  const first = result[0];
  return {
    totalCount: num(path(first, ["total_count"])),
    items: items(path(first, ["items"]))
      .map((item) => ({
        keyword: str(path(item, ["keyword_data", "keyword"])) ?? "",
        position: num(path(item, ["ranked_serp_element", "serp_item", "rank_absolute"])),
        searchVolume: num(path(item, ["keyword_data", "keyword_info", "search_volume"])),
        etv: num(path(item, ["ranked_serp_element", "serp_item", "etv"])),
        url: str(path(item, ["ranked_serp_element", "serp_item", "url"])),
      }))
      .filter((item) => item.keyword.length > 0),
  };
}

/** backlinks/backlinks/live → result[0].items[] */
export function mapBacklinks(result: unknown[]): BacklinkData {
  return {
    items: items(path(result, [0, "items"])).map((item) => {
      const dofollow = path(item, ["dofollow"]);
      return {
        referringDomain: str(path(item, ["domain_from"])),
        sourceUrl: str(path(item, ["url_from"])),
        targetUrl: str(path(item, ["url_to"])),
        anchor: str(path(item, ["anchor"])),
        linkType: dofollow === true ? "dofollow" : dofollow === false ? "nofollow" : null,
        domainRank: num(path(item, ["domain_from_rank"])),
        firstSeen: str(path(item, ["first_seen"])),
      };
    }),
  };
}

/** dataforseo_labs/google/historical_rank_overview/live → result[0].items[] (year, month, metrics.organic) */
export function mapHistoricalOverview(result: unknown[]): HistoryData {
  const points = items(path(result, [0, "items"]))
    .map((item) => {
      const year = num(path(item, ["year"]));
      const month = num(path(item, ["month"]));
      if (year === null || month === null) return null;
      return {
        month: `${year}-${String(month).padStart(2, "0")}`,
        organicTraffic: num(path(item, ["metrics", "organic", "etv"])),
        organicKeywords: num(path(item, ["metrics", "organic", "count"])),
        backlinks: null,
        referringDomains: null,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
  return { points };
}

/** appendix/user_data → result[0].money.balance */
export function mapUserBalance(result: unknown[]): number | null {
  return num(path(result, [0, "money", "balance"]));
}

/** Keeps raw payloads small enough to store alongside a snapshot. */
export function trimRaw(value: unknown, maxItems = 5): unknown {
  if (Array.isArray(value)) return value.slice(0, maxItems).map((item) => trimRaw(item, maxItems));
  if (!isObject(value)) return value;
  const result: Json = {};
  for (const [key, inner] of Object.entries(value)) result[key] = trimRaw(inner, maxItems);
  return result;
}
