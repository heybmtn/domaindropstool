import { describe, expect, it } from "vitest";
import { analyseLabel } from "../../shared/analysis";
import { computeResearchScore, DEFAULT_SCORE_WEIGHTS } from "../../shared/scoring";
import { computeWarnings } from "../../shared/warnings";

const base = {
  length: 8,
  hyphens: 0,
  digits: 0,
  referringDomains: null,
  backlinks: null,
  organicTraffic: null,
  organicKeywords: null,
  trafficValue: null,
};

describe("computeResearchScore", () => {
  it("is transparent: the breakdown sums to the score", () => {
    const result = computeResearchScore({ ...base, referringDomains: 120, backlinks: 2400, organicTraffic: 900 });
    const sum = result.breakdown.reduce((total, line) => total + line.points, 0);
    expect(result.score).toBe(Math.round(sum));
    expect(result.breakdown.map((line) => line.label)).toContain("Referring Domains");
  });

  it("caps at 100 and floors at 0", () => {
    const huge = computeResearchScore({
      ...base,
      length: 3,
      referringDomains: 1e6,
      backlinks: 1e8,
      organicTraffic: 1e7,
      organicKeywords: 1e6,
      trafficValue: 1e7,
    });
    expect(huge.score).toBe(100);
    const poor = computeResearchScore({ ...base, length: 40, hyphens: 5, digits: 10 });
    expect(poor.score).toBe(0);
  });

  it("penalises hyphens and numbers", () => {
    const clean = computeResearchScore({ ...base, referringDomains: 50 });
    const messy = computeResearchScore({ ...base, referringDomains: 50, hyphens: 1, digits: 2 });
    expect(messy.score).toBeLessThan(clean.score);
    expect(messy.breakdown.find((l) => l.key === "hyphenPenalty")?.points).toBe(-DEFAULT_SCORE_WEIGHTS.hyphenPenalty);
  });

  it("respects configurable weights", () => {
    const weights = { ...DEFAULT_SCORE_WEIGHTS, referringDomains: 0 };
    const result = computeResearchScore({ ...base, referringDomains: 1000 }, weights);
    expect(result.breakdown.find((l) => l.key === "referringDomains")?.points).toBe(0);
  });
});

describe("computeWarnings", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const completed = {
    researchStatus: "completed",
    lastResearchedAt: "2026-09-24T00:00:00Z",
    backlinks: 100,
    referringDomains: 10,
    organicTraffic: 100,
    organicKeywords: 10,
    topKeywordsTraffic: null,
    trafficHistory: [],
    spamScore: null,
  };

  it("flags a high backlink to referring-domain ratio", () => {
    const codes = computeWarnings({ ...completed, backlinks: 50_000, referringDomains: 20 }, now).map((w) => w.code);
    expect(codes).toContain("backlink_ratio");
  });

  it("flags keyword concentration, decline and staleness", () => {
    const codes = computeWarnings(
      {
        ...completed,
        topKeywordsTraffic: 95,
        trafficHistory: [1000, 800, 200],
        lastResearchedAt: "2026-07-01T00:00:00Z",
      },
      now,
    ).map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["keyword_concentration", "traffic_decline", "stale_metrics"]));
  });

  it("reports insufficient data and failures neutrally", () => {
    expect(computeWarnings({ ...completed, researchStatus: "none" }, now)).toEqual([
      { code: "insufficient_data", message: "Insufficient SEO data." },
    ]);
    expect(computeWarnings({ ...completed, researchStatus: "failed" }, now)[0]?.message).toBe("Research request failed.");
  });
});

describe("analyseLabel", () => {
  it("computes heuristic lexical features", () => {
    const analysis = analyseLabel("bestcarhire4u");
    expect(analysis).toMatchObject({ length: 13, digits: 1, hyphens: 0 });
    expect(analysis.words).toEqual(expect.arrayContaining(["best", "car", "hire"]));
    expect(analysis.numberRatio).toBeCloseTo(0.08, 2);
  });
});
