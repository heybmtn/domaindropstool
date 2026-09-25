import { beforeEach, describe, expect, it } from "vitest";
import { buildDomainWhere, buildOrderBy } from "../../worker/services/domainQuery";
import { countDomains, getDashboardStats, listDomains } from "../../worker/services/domainService";
import { refreshImportStats } from "../../worker/services/settings";
import { DOMAIN_COLUMNS } from "../../worker/db/rows";
import { db, resetDatabase } from "../helpers";

const NOW = new Date("2026-09-25T12:00:00Z");

/** Seeds `count` listed domains spread over 10 drop days, in one statement. */
async function seedMany(count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => {
    const day = 25 + (i % 10);
    const date = day <= 30 ? `2026-09-${day}` : `2026-10-0${day - 30}`;
    return [`bulk${i}.co.uk`, `bulk${i}`, date, `${date}T${String(i % 24).padStart(2, "0")}:00:00.000Z`];
  });
  await db()
    .prepare(
      `INSERT INTO domains (domain, tld, sld, length, hyphens, digits, drop_date, drop_time, first_seen_at, last_seen_at)
       SELECT json_extract(value, '$[0]'), 'co.uk', json_extract(value, '$[1]'), 8, 0, 1,
              json_extract(value, '$[2]'), json_extract(value, '$[3]'), '2026-09-01', '2026-09-01'
       FROM json_each(?)`,
    )
    .bind(JSON.stringify(rows))
    .run();
}

describe("D1 read cost", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedMany(3000);
  });

  it("reads only one page of rows for listed domains in drop order (index walk, no sort)", async () => {
    const where = buildDomainWhere({ domainStatus: "listed" }, NOW);
    const sql = `SELECT ${DOMAIN_COLUMNS} FROM domains d ${where.sql} ${buildOrderBy("drop_date", "asc")} LIMIT 50`;
    const result = await db().prepare(sql).bind(...where.params).all();
    expect(result.results).toHaveLength(50);
    expect(result.meta.rows_read).toBeLessThan(300);

    const plan = await db().prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...where.params).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join(" | ");
    expect(details).toContain("idx_domains_status_drop");
    expect(details).not.toContain("TEMP B-TREE");
  });

  it("can list without counting, and counts whole-table filters from the import cache", async () => {
    const page = await listDomains(
      db(),
      { domainStatus: "listed", sort: "drop_date", dir: "asc", page: 1, pageSize: 25 },
      { count: false, now: NOW },
    );
    expect(page.items).toHaveLength(25);
    expect(page.total).toBeNull();

    await refreshImportStats(db(), NOW);
    // Rows added after the cache was built are not re-counted for whole-table filters...
    await db()
      .prepare(
        "INSERT INTO domains (domain, tld, sld, length, hyphens, digits, first_seen_at, last_seen_at) VALUES ('extra.co.uk','co.uk','extra',5,0,0,'x','x')",
      )
      .run();
    expect(await countDomains(db(), { domainStatus: "listed" }, NOW)).toBe(3000);
    // ...but any narrower filter is counted live.
    expect(await countDomains(db(), { domainStatus: "listed", maxLength: 8 }, NOW)).toBe(3001);
  });

  it("dashboard stats use the cached totals and cheap live counts", async () => {
    await refreshImportStats(db(), NOW);
    const stats = await getDashboardStats(db(), NOW);
    expect(stats).toMatchObject({ totalDomains: 3000, listedDomains: 3000, todaysDomains: 300, researched: 0 });
    expect(stats.upcomingDropDates[0]).toEqual({ dropDate: "2026-09-25", count: 300 });
  });
});
