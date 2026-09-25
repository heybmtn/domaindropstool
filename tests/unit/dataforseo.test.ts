import { describe, expect, it } from "vitest";
import { DataForSeoClient } from "../../worker/providers/dataforseo/client";
import {
  mapBacklinks,
  mapBacklinkSummary,
  mapDomainOverview,
  mapHistoricalOverview,
  mapRankedKeywords,
} from "../../worker/providers/dataforseo/mappers";
import { DataForSeoProvider, DATAFORSEO_ENDPOINTS } from "../../worker/providers/dataforseo/provider";
import { ProviderError } from "../../worker/providers/types";
import {
  BACKLINK_SUMMARY_RESULT,
  BACKLINKS_RESULT,
  DOMAIN_RANK_OVERVIEW_RESULT,
  envelope,
  HISTORICAL_RESULT,
  RANKED_KEYWORDS_RESULT,
} from "../fixtures/dataforseo";

const OPTIONS = { locationCode: 2826, languageCode: "en", keywordLimit: 10, backlinkLimit: 10 };

/** Records requests and replies with queued responses. No network access. */
function mockFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("No mock response queued");
    return next;
  }) as typeof fetch;
  return { calls, fetcher };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("DataForSEO mappers", () => {
  it("maps backlinks summary", () => {
    expect(mapBacklinkSummary(BACKLINK_SUMMARY_RESULT)).toEqual({
      backlinks: 15230,
      referringDomains: 420,
      referringMainDomains: 390,
      referringPages: 9800,
      rank: 312,
      spamScore: 12,
    });
  });

  it("maps domain rank overview", () => {
    expect(mapDomainOverview(DOMAIN_RANK_OVERVIEW_RESULT)).toEqual({
      organicTraffic: 5320.5,
      organicKeywords: 1450,
      trafficValue: 8100.25,
    });
  });

  it("returns nulls, not zeros, when data is missing", () => {
    expect(mapDomainOverview([{ items: null }])).toEqual({ organicTraffic: null, organicKeywords: null, trafficValue: null });
    expect(mapBacklinkSummary([])).toMatchObject({ backlinks: null, referringDomains: null });
  });

  it("maps ranked keywords, backlinks and history", () => {
    const keywords = mapRankedKeywords(RANKED_KEYWORDS_RESULT);
    expect(keywords.totalCount).toBe(1450);
    expect(keywords.items[0]).toEqual({
      keyword: "example widgets",
      position: 3,
      searchVolume: 2400,
      etv: 410.2,
      url: "https://example.co.uk/widgets",
    });
    const links = mapBacklinks(BACKLINKS_RESULT);
    expect(links.items.map((l) => l.linkType)).toEqual(["dofollow", "nofollow"]);
    expect(links.items[1]?.anchor).toBeNull();
    expect(mapHistoricalOverview(HISTORICAL_RESULT).points.map((p) => p.month)).toEqual(["2026-01", "2026-02"]);
  });
});

describe("DataForSeoClient + provider", () => {
  it("sends Basic auth and a single-task JSON array to the documented endpoint", async () => {
    const { calls, fetcher } = mockFetch([json(envelope(BACKLINK_SUMMARY_RESULT))]);
    const provider = new DataForSeoProvider(
      new DataForSeoClient("https://api.example.test/v3", { login: "user", password: "pass" }, fetcher),
    );
    const result = await provider.getBacklinkSummary("example.co.uk");

    expect(result.data.referringDomains).toBe(420);
    expect(result.cost).toBe(0.02);
    expect(calls[0]?.url).toBe(`https://api.example.test/v3/${DATAFORSEO_ENDPOINTS.backlinkSummary}`);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("user:pass")}`);
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toEqual([expect.objectContaining({ target: "example.co.uk" })]);
  });

  it("passes UK location and language to Labs endpoints", async () => {
    const { calls, fetcher } = mockFetch([json(envelope(DOMAIN_RANK_OVERVIEW_RESULT))]);
    const provider = new DataForSeoProvider(new DataForSeoClient("https://x.test/v3", { login: "u", password: "p" }, fetcher));
    await provider.getDomainOverview("example.co.uk", OPTIONS);
    expect(JSON.parse(String(calls[0]?.init?.body))[0]).toMatchObject({ location_code: 2826, language_code: "en" });
  });

  it("treats 'no results' task codes as empty data", async () => {
    const { fetcher } = mockFetch([json(envelope([], 40102, "No Search Results."))]);
    const provider = new DataForSeoProvider(new DataForSeoClient("https://x.test/v3", { login: "u", password: "p" }, fetcher));
    const result = await provider.getBacklinkSummary("empty.co.uk");
    expect(result.data.backlinks).toBeNull();
  });

  it("classifies rate limits as retryable and queue-pausing", async () => {
    const { fetcher } = mockFetch([json(envelope([], 40202, "Rate limit per minute exceeded."))]);
    const client = new DataForSeoClient("https://x.test/v3", { login: "u", password: "p" }, fetcher);
    const error = await client.post("backlinks/summary/live", { target: "a.co.uk" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
    expect((error as ProviderError).pauseQueue).toBe(true);
  });

  it("classifies HTTP 5xx as retryable and 401 as non-retryable", async () => {
    const { fetcher } = mockFetch([new Response("oops", { status: 503 }), new Response("no", { status: 401 })]);
    const client = new DataForSeoClient("https://x.test/v3", { login: "u", password: "p" }, fetcher);
    const serverError = (await client.post("x", {}).catch((e: unknown) => e)) as ProviderError;
    expect(serverError.retryable).toBe(true);
    const authError = (await client.post("x", {}).catch((e: unknown) => e)) as ProviderError;
    expect(authError.retryable).toBe(false);
    expect(authError.pauseQueue).toBe(true);
  });

  it("does not leak credentials in error messages", async () => {
    const { fetcher } = mockFetch([json(envelope([], 40501, "Invalid Field: 'target'."))]);
    const client = new DataForSeoClient("https://x.test/v3", { login: "secret-login", password: "secret-pass" }, fetcher);
    const error = (await client.post("x", {}).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("secret");
  });
});
