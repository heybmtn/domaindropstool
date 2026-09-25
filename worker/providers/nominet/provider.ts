import { platformFetch, USER_AGENT } from "../fetch";
import { ProviderError, type DropListProvider, type DropListSource } from "../types";
import { parseChecksumFile } from "./parse";

/**
 * Nominet public drop list.
 * Source: https://registrars.nominet.uk/dragon/data/drop-lists/
 * Published daily as `uk.csv.gz` with a sibling `uk.csv.gz.sha256`.
 */
export class NominetDropListProvider implements DropListProvider {
  readonly source = "nominet";

  constructor(
    private readonly url: string,
    private readonly fetcher: typeof fetch = platformFetch,
  ) {}

  get checksumUrl(): string {
    return `${this.url}.sha256`;
  }

  async getLatestChecksum(): Promise<string | null> {
    const response = await this.fetcher(this.checksumUrl, { headers: { Accept: "text/plain", "User-Agent": USER_AGENT } });
    if (!response.ok) {
      // A missing checksum file is not fatal: the importer hashes the file itself.
      return null;
    }
    return parseChecksumFile(await response.text());
  }

  async getLatest(): Promise<DropListSource> {
    const publishedChecksum = await this.getLatestChecksum().catch(() => null);
    const response = await this.fetcher(this.url, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) {
      throw new ProviderError(`Nominet drop list download failed with HTTP ${response.status}.`, {
        retryable: response.status >= 500,
        status: response.status,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) throw new ProviderError("Nominet drop list download was empty.", { retryable: true });
    return {
      source: this.source,
      url: this.url,
      bytes,
      publishedChecksum,
      compressed: bytes[0] === 0x1f && bytes[1] === 0x8b,
    };
  }
}
