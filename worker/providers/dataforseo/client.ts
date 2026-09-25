import { logger } from "../../utils/logger";
import { platformFetch, USER_AGENT } from "../fetch";
import { ProviderError } from "../types";

/**
 * Thin HTTP client for DataForSEO v3 (https://docs.dataforseo.com/v3/).
 * Auth: HTTP Basic with the API login/password (Cloudflare secrets only).
 *
 * Envelope: { status_code, status_message, cost, tasks: [{ status_code, status_message, cost, result }] }
 * Success is status_code 20000 at both levels.
 */

export interface DataForSeoTask {
  id?: string;
  status_code: number;
  status_message: string;
  cost?: number;
  result?: unknown[] | null;
}

export interface DataForSeoEnvelope {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: DataForSeoTask[];
}

export interface DataForSeoResponse {
  result: unknown[];
  cost: number;
  raw: DataForSeoEnvelope;
}

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

const SUCCESS = 20000;
/** "No Search Results" style codes: treat as empty data rather than failure. */
const EMPTY_RESULT_CODES = new Set([40102]);
/** Account-level conditions that should pause the queue. */
const PAUSE_CODES = new Set([40200, 40201, 40202, 40203, 40209, 40210]);
const AUTH_CODES = new Set([40100, 40101, 40104]);

export class DataForSeoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credentials: DataForSeoCredentials,
    private readonly fetcher: typeof fetch = platformFetch,
    private readonly timeoutMs = 60_000,
  ) {}

  private get authorization(): string {
    return `Basic ${btoa(`${this.credentials.login}:${this.credentials.password}`)}`;
  }

  async post(path: string, task: Record<string, unknown>): Promise<DataForSeoResponse> {
    return this.request(path, { method: "POST", body: JSON.stringify([task]) });
  }

  async get(path: string): Promise<DataForSeoResponse> {
    return this.request(path, { method: "GET" });
  }

  private async request(path: string, init: { method: "GET" | "POST"; body?: string }): Promise<DataForSeoResponse> {
    const url = `${this.baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: init.method,
        body: init.body,
        headers: { Authorization: this.authorization, "Content-Type": "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      logger.warn("dataforseo.network_error", { path, error });
      throw new ProviderError("DataForSEO request failed (network error).", { retryable: true, cause: error });
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("DataForSEO rejected the credentials.", {
        retryable: false,
        pauseQueue: true,
        status: response.status,
      });
    }
    if (response.status === 402 || response.status === 429) {
      throw new ProviderError("Research paused because the provider limit was reached.", {
        retryable: true,
        pauseQueue: true,
        status: response.status,
      });
    }
    if (!response.ok) {
      logger.warn("dataforseo.http_error", { path, status: response.status });
      throw new ProviderError(`DataForSEO returned HTTP ${response.status}.`, {
        retryable: response.status >= 500,
        status: response.status,
      });
    }

    let envelope: DataForSeoEnvelope;
    try {
      envelope = (await response.json()) as DataForSeoEnvelope;
    } catch {
      throw new ProviderError("DataForSEO returned an unreadable response.", { retryable: true });
    }

    this.assertOk(path, envelope.status_code, envelope.status_message);
    const task = envelope.tasks?.[0];
    if (!task) throw new ProviderError("DataForSEO response contained no task.", { retryable: true });
    if (EMPTY_RESULT_CODES.has(task.status_code)) {
      return { result: [], cost: envelope.cost ?? task.cost ?? 0, raw: envelope };
    }
    this.assertOk(path, task.status_code, task.status_message);
    return { result: task.result ?? [], cost: envelope.cost ?? task.cost ?? 0, raw: envelope };
  }

  private assertOk(path: string, code: number, message: string): void {
    if (code === SUCCESS) return;
    logger.warn("dataforseo.api_error", { path, code, message });
    if (PAUSE_CODES.has(code)) {
      throw new ProviderError(`Research paused because the provider limit was reached (${code}: ${message}).`, {
        retryable: true,
        pauseQueue: true,
        providerCode: code,
      });
    }
    if (AUTH_CODES.has(code)) {
      throw new ProviderError(`DataForSEO authentication failed (${code}).`, {
        retryable: false,
        pauseQueue: true,
        providerCode: code,
      });
    }
    throw new ProviderError(`DataForSEO error ${code}: ${message}`, {
      retryable: code >= 50000,
      providerCode: code,
    });
  }
}
