import type {
  BacklinkData,
  BacklinkSummary,
  DomainOverview,
  HistoryData,
  KeywordData,
  ProviderCallResult,
  SeoProvider,
} from "./types";

/**
 * Deterministic fake provider for local development and tests
 * (enable with USE_MOCK_SEO_PROVIDER=true). Values are derived from a hash of
 * the domain so they are stable, and are clearly labelled provider "mock".
 * Never used in production unless explicitly enabled.
 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function scaled(domain: string, salt: string, max: number): number {
  const fraction = hash(`${salt}:${domain}`) / 0xffffffff;
  return Math.round(fraction ** 3 * max);
}

function result<T>(data: T): ProviderCallResult<T> {
  return { data, cost: 0, raw: { mock: true } };
}

export class MockSeoProvider implements SeoProvider {
  readonly name = "mock";

  async getBacklinkSummary(domain: string): Promise<ProviderCallResult<BacklinkSummary>> {
    const referringDomains = scaled(domain, "rd", 800);
    return result({
      backlinks: referringDomains * (1 + scaled(domain, "bl", 40)),
      referringDomains,
      referringMainDomains: Math.round(referringDomains * 0.9),
      referringPages: referringDomains * 3,
      rank: scaled(domain, "rank", 600),
      spamScore: scaled(domain, "spam", 100),
    });
  }

  async getDomainOverview(domain: string): Promise<ProviderCallResult<DomainOverview>> {
    const organicTraffic = scaled(domain, "traffic", 20_000);
    return result({
      organicTraffic,
      organicKeywords: scaled(domain, "kw", 3_000),
      trafficValue: Math.round(organicTraffic * 0.7),
    });
  }

  async getOrganicKeywords(domain: string): Promise<ProviderCallResult<KeywordData>> {
    const sld = domain.split(".")[0] ?? domain;
    return result({
      totalCount: 3,
      items: [1, 2, 3].map((i) => ({
        keyword: `${sld} ${["uk", "reviews", "near me"][i - 1]}`,
        position: i * 3,
        searchVolume: scaled(domain, `sv${i}`, 5_000),
        etv: scaled(domain, `etv${i}`, 800),
        url: `https://${domain}/`,
      })),
    });
  }

  async getBacklinks(domain: string): Promise<ProviderCallResult<BacklinkData>> {
    return result({
      items: [1, 2, 3].map((i) => ({
        referringDomain: `referrer${i}.example`,
        sourceUrl: `https://referrer${i}.example/page`,
        targetUrl: `https://${domain}/`,
        anchor: i === 1 ? domain : "click here",
        linkType: i === 3 ? "nofollow" : "dofollow",
        domainRank: scaled(domain, `dr${i}`, 700),
        firstSeen: "2020-01-01 00:00:00 +00:00",
      })),
    });
  }

  async getHistory(domain: string): Promise<ProviderCallResult<HistoryData>> {
    const base = scaled(domain, "traffic", 20_000);
    const points = Array.from({ length: 6 }, (_, i) => {
      const date = new Date(Date.UTC(2026, i, 1));
      return {
        month: date.toISOString().slice(0, 7),
        organicTraffic: Math.round(base * (1 + (i - 3) * 0.1)),
        organicKeywords: null,
        backlinks: null,
        referringDomains: null,
      };
    });
    return result({ points });
  }

  async testConnection(): Promise<{ ok: boolean; message: string; balance?: number | null }> {
    return { ok: true, message: "Mock provider active (no DataForSEO calls are made).", balance: null };
  }
}
