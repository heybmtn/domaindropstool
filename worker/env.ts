/** Bindings, variables and secrets available to the Worker (see wrangler.toml). */
export interface Env {
  DB: D1Database;
  /** R2 bucket for raw drop-list archives. Optional so local setups without R2 still work. */
  DROPLISTS?: R2Bucket;
  /** Workers Rate Limiting binding for expensive endpoints. */
  EXPENSIVE_LIMITER?: RateLimit;

  ENVIRONMENT?: string;
  NOMINET_DROP_LIST_URL?: string;
  DATAFORSEO_BASE_URL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  USE_MOCK_SEO_PROVIDER?: string;

  // Secrets
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  ADMIN_TOKEN?: string;
}

export const DEFAULT_NOMINET_DROP_LIST_URL = "https://droplists.nominet.uk/current/uk.csv.gz";
export const DEFAULT_DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3";

export function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";
}
