import { resolveDate, type DomainFilter, type SortField } from "../../shared/filters";

/**
 * Translates a validated DomainFilter into a parameterised SQL WHERE clause
 * over `domains d`. User input is only ever bound as a parameter; column
 * names come from fixed whitelists below.
 */

export interface SqlFragment {
  sql: string;
  params: (string | number)[];
}

const NUMERIC_RANGES: [keyof DomainFilter, string, ">=" | "<="][] = [
  ["minLength", "d.length", ">="],
  ["maxLength", "d.length", "<="],
  ["maxHyphens", "d.hyphens", "<="],
  ["maxNumbers", "d.digits", "<="],
  ["minBacklinks", "d.latest_backlinks", ">="],
  ["maxBacklinks", "d.latest_backlinks", "<="],
  ["minReferringDomains", "d.latest_referring_domains", ">="],
  ["maxReferringDomains", "d.latest_referring_domains", "<="],
  ["minOrganicTraffic", "d.latest_organic_traffic", ">="],
  ["maxOrganicTraffic", "d.latest_organic_traffic", "<="],
  ["minOrganicKeywords", "d.latest_organic_keywords", ">="],
  ["maxOrganicKeywords", "d.latest_organic_keywords", "<="],
  ["minScore", "d.research_score", ">="],
];

const SORT_COLUMNS: Record<SortField, string> = {
  domain: "d.domain",
  drop_date: "d.drop_date",
  length: "d.length",
  referring_domains: "d.latest_referring_domains",
  backlinks: "d.latest_backlinks",
  organic_traffic: "d.latest_organic_traffic",
  organic_keywords: "d.latest_organic_keywords",
  traffic_value: "d.latest_traffic_value",
  research_score: "d.research_score",
  last_researched_at: "d.last_researched_at",
  created_at: "d.created_at",
};

/** Escapes LIKE wildcards; pair with `ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Removes a trailing ".co.uk" (or other supported suffix) so users may type either form. */
function stripSuffix(value: string): string {
  return value.replace(/\.co\.uk\.?$/, "").replace(/\.$/, "");
}

function searchClause(filter: DomainFilter, clauses: string[], params: (string | number)[]): void {
  const raw = filter.q?.trim();
  if (!raw) return;
  const term = stripSuffix(raw);
  switch (filter.searchMode ?? "partial") {
    case "exact":
      clauses.push("d.sld = ?");
      params.push(term);
      break;
    case "starts":
      clauses.push("d.sld LIKE ? ESCAPE '\\'");
      params.push(`${escapeLike(term)}%`);
      break;
    case "ends":
      clauses.push("d.sld LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(term)}`);
      break;
    case "partial":
      clauses.push("d.domain LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(raw)}%`);
      break;
  }
}

export function buildDomainWhere(filter: DomainFilter, now: Date = new Date()): SqlFragment {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  searchClause(filter, clauses, params);

  if (filter.dropDate) {
    clauses.push("d.drop_date = ?");
    params.push(resolveDate(filter.dropDate, now));
  }
  if (filter.dropFrom) {
    clauses.push("d.drop_date >= ?");
    params.push(resolveDate(filter.dropFrom, now));
  }
  if (filter.dropTo) {
    clauses.push("d.drop_date <= ?");
    params.push(resolveDate(filter.dropTo, now));
  }

  for (const [key, column, op] of NUMERIC_RANGES) {
    const value = filter[key];
    if (typeof value === "number") {
      clauses.push(`${column} ${op} ?`);
      params.push(value);
    }
  }

  if (filter.contains) {
    clauses.push("d.sld LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(stripSuffix(filter.contains))}%`);
  }
  if (filter.excludes) {
    clauses.push("d.sld NOT LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(stripSuffix(filter.excludes))}%`);
  }
  if (filter.startsWith) {
    clauses.push("d.sld LIKE ? ESCAPE '\\'");
    params.push(`${escapeLike(filter.startsWith)}%`);
  }
  if (filter.endsWith) {
    clauses.push("d.sld LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(stripSuffix(filter.endsWith))}`);
  }

  if (typeof filter.words === "number") {
    clauses.push("d.word_count = ?");
    params.push(filter.words);
  }
  if (filter.hasNumbers !== undefined) clauses.push(filter.hasNumbers ? "d.digits > 0" : "d.digits = 0");
  if (filter.hasHyphen !== undefined) clauses.push(filter.hasHyphen ? "d.hyphens > 0" : "d.hyphens = 0");

  switch (filter.research) {
    case "completed":
      clauses.push("d.research_status = 'completed'");
      break;
    case "none":
      clauses.push("d.research_status = 'none'");
      break;
    case "failed":
      clauses.push("d.research_status = 'failed'");
      break;
    case "pending":
      clauses.push("d.research_status IN ('pending', 'processing')");
      break;
    case undefined:
      break;
  }
  if (typeof filter.researchOlderThanDays === "number") {
    clauses.push("d.last_researched_at IS NOT NULL AND d.last_researched_at < ?");
    params.push(new Date(now.getTime() - filter.researchOlderThanDays * 86_400_000).toISOString());
  }

  if (filter.userStatus) {
    clauses.push("d.user_status = ?");
    params.push(filter.userStatus);
  } else if (filter.hideIgnored) {
    clauses.push("d.user_status != 'ignored'");
  }
  if (filter.shortlisted !== undefined) {
    clauses.push(
      `${filter.shortlisted ? "" : "NOT "}EXISTS (SELECT 1 FROM favourites f WHERE f.domain_id = d.id)`,
    );
  }
  if (filter.domainStatus) {
    clauses.push("d.status = ?");
    params.push(filter.domainStatus);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function buildOrderBy(sort: SortField, dir: "asc" | "desc"): string {
  const column = SORT_COLUMNS[sort];
  // DESC puts NULLs last naturally; ASC needs an explicit NULLS LAST so
  // unresearched domains do not crowd the top of metric sorts.
  const direction = dir === "desc" ? "DESC" : "ASC NULLS LAST";
  if (sort === "drop_date") {
    // Within a day, list domains in the order they drop.
    return `ORDER BY d.drop_date ${direction}, d.drop_time ${direction}, d.domain ASC`;
  }
  const tiebreak = sort === "domain" ? "" : ", d.domain ASC";
  return `ORDER BY ${column} ${direction}${tiebreak}`;
}
