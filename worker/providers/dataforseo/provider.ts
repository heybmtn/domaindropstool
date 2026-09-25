import type {
  BacklinkData,
  BacklinkSummary,
  DomainOverview,
  HistoryData,
  KeywordData,
  ProviderCallResult,
  ResearchOptions,
  SeoProvider,
} from "../types";
import type { DataForSeoClient, DataForSeoResponse } from "./client";
import {
  mapBacklinks,
  mapBacklinkSummary,
  mapDomainOverview,
  mapHistoricalOverview,
  mapRankedKeywords,
  mapUserBalance,
  trimRaw,
} from "./mappers";

/**
 * DataForSEO implementation of SeoProvider. All endpoints used are "Live"
 * (synchronous) endpoints; queueing/pacing is handled by the research queue.
 */
export const DATAFORSEO_ENDPOINTS = {
  backlinkSummary: "backlinks/summary/live",
  backlinks: "backlinks/backlinks/live",
  domainOverview: "dataforseo_labs/google/domain_rank_overview/live",
  rankedKeywords: "dataforseo_labs/google/ranked_keywords/live",
  historicalOverview: "dataforseo_labs/google/historical_rank_overview/live",
  userData: "appendix/user_data",
} as const;

function wrap<T>(response: DataForSeoResponse, data: T): ProviderCallResult<T> {
  return { data, cost: response.cost, raw: trimRaw(response.result) };
}

export class DataForSeoProvider implements SeoProvider {
  readonly name = "dataforseo";

  constructor(private readonly client: DataForSeoClient) {}

  async getBacklinkSummary(domain: string): Promise<ProviderCallResult<BacklinkSummary>> {
    const response = await this.client.post(DATAFORSEO_ENDPOINTS.backlinkSummary, {
      target: domain,
      include_subdomains: true,
      backlinks_status_type: "live",
      internal_list_limit: 1,
    });
    return wrap(response, mapBacklinkSummary(response.result));
  }

  async getDomainOverview(domain: string, options: ResearchOptions): Promise<ProviderCallResult<DomainOverview>> {
    const response = await this.client.post(DATAFORSEO_ENDPOINTS.domainOverview, {
      target: domain,
      location_code: options.locationCode,
      language_code: options.languageCode,
    });
    return wrap(response, mapDomainOverview(response.result));
  }

  async getOrganicKeywords(domain: string, options: ResearchOptions): Promise<ProviderCallResult<KeywordData>> {
    const response = await this.client.post(DATAFORSEO_ENDPOINTS.rankedKeywords, {
      target: domain,
      location_code: options.locationCode,
      language_code: options.languageCode,
      limit: options.keywordLimit,
      order_by: ["ranked_serp_element.serp_item.etv,desc"],
    });
    return wrap(response, mapRankedKeywords(response.result));
  }

  async getBacklinks(domain: string, options: ResearchOptions): Promise<ProviderCallResult<BacklinkData>> {
    const response = await this.client.post(DATAFORSEO_ENDPOINTS.backlinks, {
      target: domain,
      mode: "one_per_domain",
      backlinks_status_type: "live",
      limit: options.backlinkLimit,
      order_by: ["domain_from_rank,desc"],
    });
    return wrap(response, mapBacklinks(response.result));
  }

  async getHistory(domain: string, options: ResearchOptions): Promise<ProviderCallResult<HistoryData>> {
    const response = await this.client.post(DATAFORSEO_ENDPOINTS.historicalOverview, {
      target: domain,
      location_code: options.locationCode,
      language_code: options.languageCode,
    });
    return wrap(response, mapHistoricalOverview(response.result));
  }

  async testConnection(): Promise<{ ok: boolean; message: string; balance?: number | null }> {
    const response = await this.client.get(DATAFORSEO_ENDPOINTS.userData);
    const balance = mapUserBalance(response.result);
    return { ok: true, message: "Connected to DataForSEO.", balance };
  }
}
