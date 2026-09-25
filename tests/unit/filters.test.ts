import { describe, expect, it } from "vitest";
import {
  domainFilterSchema,
  filterFromSearchParams,
  filterToSearchParams,
  resolveDate,
} from "../../shared/filters";
import { buildDomainWhere, buildOrderBy, escapeLike } from "../../worker/services/domainQuery";

const NOW = new Date("2026-09-25T10:00:00Z");

describe("URL filter state", () => {
  it("parses short aliases from the URL", () => {
    const filter = filterFromSearchParams(new URLSearchParams("drop=today&maxLength=15&minRD=20&hasNumbers=false"));
    expect(filter).toEqual({ dropDate: "today", maxLength: 15, minReferringDomains: 20, hasNumbers: false });
  });

  it("round-trips through URL params", () => {
    const filter = domainFilterSchema.parse({ dropDate: "today", maxLength: 15, minReferringDomains: 20, q: "shop" });
    const params = filterToSearchParams(filter);
    expect(params.toString()).toBe("q=shop&drop=today&maxLength=15&minRD=20");
    expect(filterFromSearchParams(params)).toEqual(filter);
  });

  it("drops only invalid values", () => {
    expect(filterFromSearchParams(new URLSearchParams("maxLength=abc&minRD=5"))).toEqual({ minReferringDomains: 5 });
  });

  it("resolves relative dates in UTC", () => {
    expect(resolveDate("today", NOW)).toBe("2026-09-25");
    expect(resolveDate("tomorrow", NOW)).toBe("2026-09-26");
    expect(resolveDate("2026-01-01", NOW)).toBe("2026-01-01");
  });
});

describe("buildDomainWhere", () => {
  it("returns an empty clause for an empty filter", () => {
    expect(buildDomainWhere({}, NOW)).toEqual({ sql: "", params: [] });
  });

  it("builds length filters", () => {
    expect(buildDomainWhere({ minLength: 3, maxLength: 10 }, NOW)).toEqual({
      sql: "WHERE d.length >= ? AND d.length <= ?",
      params: [3, 10],
    });
  });

  it("builds hyphen and number filters", () => {
    expect(buildDomainWhere({ hasHyphen: false, hasNumbers: true, maxHyphens: 1, maxNumbers: 2 }, NOW).sql).toBe(
      "WHERE d.hyphens <= ? AND d.digits <= ? AND d.digits > 0 AND d.hyphens = 0",
    );
  });

  it("builds SEO range filters on latest metrics", () => {
    const where = buildDomainWhere(
      { minBacklinks: 100, maxBacklinks: 5000, minReferringDomains: 20, minOrganicTraffic: 500, minOrganicKeywords: 10 },
      NOW,
    );
    expect(where.sql).toBe(
      "WHERE d.latest_backlinks >= ? AND d.latest_backlinks <= ? AND d.latest_referring_domains >= ? " +
        "AND d.latest_organic_traffic >= ? AND d.latest_organic_keywords >= ?",
    );
    expect(where.params).toEqual([100, 5000, 20, 500, 10]);
  });

  it("parameterises and escapes search input", () => {
    const where = buildDomainWhere({ q: "50%_off", searchMode: "starts" }, NOW);
    expect(where.sql).toBe("WHERE d.sld LIKE ? ESCAPE '\\'");
    expect(where.params).toEqual(["50\\%\\_off%"]);
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("strips the .co.uk suffix for exact search", () => {
    expect(buildDomainWhere({ q: "example.co.uk", searchMode: "exact" }, NOW).params).toEqual(["example"]);
  });

  it("combines composable filters with AND", () => {
    const where = buildDomainWhere(
      { dropDate: "today", maxLength: 15, maxHyphens: 0, maxNumbers: 0, minReferringDomains: 20, minOrganicTraffic: 500 },
      NOW,
    );
    expect(where.sql.split(" AND ")).toHaveLength(6);
    expect(where.params).toEqual(["2026-09-25", 15, 0, 0, 20, 500]);
  });

  it("filters research state and staleness", () => {
    const where = buildDomainWhere({ research: "pending", researchOlderThanDays: 30 }, NOW);
    expect(where.sql).toContain("d.research_status IN ('pending', 'processing')");
    expect(where.params).toEqual(["2026-08-26T10:00:00.000Z"]);
  });
});

describe("buildOrderBy", () => {
  it("uses whitelisted columns with null handling", () => {
    expect(buildOrderBy("referring_domains", "desc")).toBe("ORDER BY d.latest_referring_domains DESC, d.domain ASC");
    expect(buildOrderBy("backlinks", "asc")).toBe("ORDER BY d.latest_backlinks ASC NULLS LAST, d.domain ASC");
    expect(buildOrderBy("domain", "asc")).toBe("ORDER BY d.domain ASC NULLS LAST");
  });
});

describe("drop-time ordering", () => {
  it("orders by drop date then exact drop time", () => {
    expect(buildOrderBy("drop_date", "asc")).toBe("ORDER BY d.drop_date ASC, d.drop_time ASC");
  });
});

describe("word-count filter", () => {
  it("filters on the stored word count and parses from the URL", () => {
    expect(buildDomainWhere({ words: 2 }, NOW)).toEqual({ sql: "WHERE d.word_count = ?", params: [2] });
    expect(filterFromSearchParams(new URLSearchParams("words=3"))).toEqual({ words: 3 });
  });
});
