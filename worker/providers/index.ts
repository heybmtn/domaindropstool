import { DEFAULT_DATAFORSEO_BASE_URL, DEFAULT_NOMINET_DROP_LIST_URL, type Env } from "../env";
import { DataForSeoClient } from "./dataforseo/client";
import { DataForSeoProvider } from "./dataforseo/provider";
import { MockSeoProvider } from "./mockSeoProvider";
import { NominetDropListProvider } from "./nominet/provider";
import type { DropListProvider, SeoProvider } from "./types";

/** Composition root for providers: the only place that reads provider config from env. */

export function isMockSeo(env: Env): boolean {
  return env.USE_MOCK_SEO_PROVIDER === "true";
}

export function isSeoConfigured(env: Env): boolean {
  return isMockSeo(env) || Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);
}

export function createSeoProvider(env: Env): SeoProvider | null {
  if (isMockSeo(env)) return new MockSeoProvider();
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) return null;
  const client = new DataForSeoClient(env.DATAFORSEO_BASE_URL || DEFAULT_DATAFORSEO_BASE_URL, {
    login: env.DATAFORSEO_LOGIN,
    password: env.DATAFORSEO_PASSWORD,
  });
  return new DataForSeoProvider(client);
}

export function dropListUrl(env: Env): string {
  return env.NOMINET_DROP_LIST_URL || DEFAULT_NOMINET_DROP_LIST_URL;
}

export function createDropListProvider(env: Env): DropListProvider {
  return new NominetDropListProvider(dropListUrl(env));
}
