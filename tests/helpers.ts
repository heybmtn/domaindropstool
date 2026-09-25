import { env } from "cloudflare:workers";
import { lexicalFeatures, parseDomain } from "../shared/domain";

export const db = (): D1Database => env.DB;

/** Removes all application data between tests (migrations stay applied). */
export async function resetDatabase(): Promise<void> {
  await env.DB.batch(
    [
      "DELETE FROM domain_keywords",
      "DELETE FROM domain_backlinks",
      "DELETE FROM domain_history",
      "DELETE FROM domain_metrics",
      "DELETE FROM research_jobs",
      "DELETE FROM research_usage",
      "DELETE FROM favourites",
      "DELETE FROM notes",
      "DELETE FROM domains",
      "DELETE FROM import_batches",
      "DELETE FROM settings",
    ].map((sql) => env.DB.prepare(sql)),
  );
}

export interface SeedDomain {
  domain: string;
  dropDate?: string;
  backlinks?: number | null;
  referringDomains?: number | null;
  organicTraffic?: number | null;
  organicKeywords?: number | null;
  researchStatus?: string;
  lastResearchedAt?: string | null;
  userStatus?: string;
}

/** Inserts domains directly (bypassing the importer) and returns their ids. */
export async function seedDomains(domains: SeedDomain[]): Promise<number[]> {
  const ids: number[] = [];
  for (const seed of domains) {
    const parsed = parseDomain(seed.domain);
    if (!parsed.ok) throw new Error(`Invalid seed domain ${seed.domain}`);
    const { length, hyphens, digits } = lexicalFeatures(parsed.value.sld);
    const row = await env.DB.prepare(
      `INSERT INTO domains (domain, tld, sld, length, hyphens, digits, drop_date, status, user_status, research_status,
         last_researched_at, latest_backlinks, latest_referring_domains, latest_organic_traffic, latest_organic_keywords,
         first_seen_at, last_seen_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'listed', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15) RETURNING id`,
    )
      .bind(
        parsed.value.domain,
        parsed.value.tld,
        parsed.value.sld,
        length,
        hyphens,
        digits,
        seed.dropDate ?? "2026-09-25",
        seed.userStatus ?? "none",
        seed.researchStatus ?? "none",
        seed.lastResearchedAt ?? null,
        seed.backlinks ?? null,
        seed.referringDomains ?? null,
        seed.organicTraffic ?? null,
        seed.organicKeywords ?? null,
        "2026-09-20T00:00:00.000Z",
      )
      .first<{ id: number }>();
    ids.push(row!.id);
  }
  return ids;
}
