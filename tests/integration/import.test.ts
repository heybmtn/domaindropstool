import { beforeEach, describe, expect, it } from "vitest";
import { continueImport, getImportBatch, importFromProvider, importFromSource } from "../../worker/services/importService";
import type { DropListProvider, DropListSource } from "../../worker/providers/types";
import { sha256Hex } from "../../worker/utils/crypto";
import { csvWith, gzip, SAMPLE_DROP_LIST_CSV, SAMPLE_VALID_DOMAINS } from "../fixtures/dropList";
import { db, resetDatabase } from "../helpers";

const NOW = () => new Date("2026-09-25T12:00:00Z");

class FakeProvider implements DropListProvider {
  readonly source = "nominet";
  downloads = 0;
  constructor(
    private bytes: Uint8Array,
    private checksum: string | null,
  ) {}
  setFile(bytes: Uint8Array, checksum: string | null) {
    this.bytes = bytes;
    this.checksum = checksum;
  }
  async getLatestChecksum() {
    return this.checksum;
  }
  async getLatest(): Promise<DropListSource> {
    this.downloads += 1;
    return { source: this.source, url: "https://example.test/uk.csv.gz", bytes: this.bytes, publishedChecksum: this.checksum, compressed: true };
  }
}

async function domainNames(): Promise<string[]> {
  const { results } = await db().prepare("SELECT domain FROM domains ORDER BY domain").all<{ domain: string }>();
  return results.map((r) => r.domain);
}

describe("importer", () => {
  beforeEach(resetDatabase);

  it("imports only valid, unique, normalised .co.uk domains and records statistics", async () => {
    const bytes = await gzip(SAMPLE_DROP_LIST_CSV);
    const provider = new FakeProvider(bytes, await sha256Hex(bytes));
    const result = await importFromProvider({ db: db() }, provider, { now: NOW });

    expect(result.outcome).toBe("imported");
    expect(await domainNames()).toEqual([...SAMPLE_VALID_DOMAINS].sort());
    expect(result.batch).toMatchObject({
      status: "completed",
      totalRecords: 11,
      insertedRecords: 5,
      duplicateRecords: 1,
      failedRecords: 2, // bad_domain!, -leading
      skippedRecords: 3, // .org.uk, .uk, sub-domain
      dropDate: "2026-09-25",
    });

    const row = await db()
      .prepare("SELECT tld, sld, length, hyphens, digits, drop_date, roid FROM domains WHERE domain = 'shop4you.co.uk'")
      .first();
    expect(row).toEqual({ tld: "co.uk", sld: "shop4you", length: 8, hyphens: 0, digits: 1, drop_date: "2026-09-27", roid: "1011-UK" });
  });

  it("is idempotent: the same file is skipped by checksum and never duplicates domains", async () => {
    const bytes = await gzip(SAMPLE_DROP_LIST_CSV);
    const provider = new FakeProvider(bytes, await sha256Hex(bytes));
    await importFromProvider({ db: db() }, provider, { now: NOW });
    const second = await importFromProvider({ db: db() }, provider, { now: NOW });

    expect(second.outcome).toBe("unchanged");
    expect(provider.downloads).toBe(1);
    expect(await domainNames()).toHaveLength(5);
  });

  it("forced re-import upserts without duplicating", async () => {
    const bytes = await gzip(SAMPLE_DROP_LIST_CSV);
    const provider = new FakeProvider(bytes, null);
    await importFromProvider({ db: db() }, provider, { now: NOW });
    const again = await importFromProvider({ db: db() }, provider, { now: NOW, force: true });
    expect(again.batch).toMatchObject({ status: "completed", insertedRecords: 0, duplicateRecords: 6 });
    expect(await domainNames()).toHaveLength(5);
  });

  it("marks domains missing from a newer list as removed or dropped", async () => {
    const first = await gzip(csvWith([["gone.co.uk", "2026-09-24T10:00:00Z"], ["renewed.co.uk", "2026-10-01T10:00:00Z"], ["stays.co.uk", "2026-10-01T10:00:00Z"]]));
    const provider = new FakeProvider(first, null);
    await importFromProvider({ db: db() }, provider, { now: NOW });
    provider.setFile(await gzip(csvWith([["stays.co.uk", "2026-10-01T10:00:00Z"], ["fresh.co.uk", "2026-10-02T10:00:00Z"]])), null);
    const result = await importFromProvider({ db: db() }, provider, { now: NOW });

    expect(result.batch?.removedRecords).toBe(2);
    const { results } = await db().prepare("SELECT domain, status FROM domains ORDER BY domain").all();
    expect(results).toEqual([
      { domain: "fresh.co.uk", status: "listed" },
      { domain: "gone.co.uk", status: "dropped" },
      { domain: "renewed.co.uk", status: "removed" },
      { domain: "stays.co.uk", status: "listed" },
    ]);
  });

  it("fails safely on checksum mismatch and keeps previous data", async () => {
    const good = await gzip(SAMPLE_DROP_LIST_CSV);
    const provider = new FakeProvider(good, null);
    await importFromProvider({ db: db() }, provider, { now: NOW });

    provider.setFile(await gzip(csvWith([["new.co.uk", "2026-10-01T00:00:00Z"]])), "f".repeat(64));
    await expect(importFromProvider({ db: db() }, provider, { now: NOW })).rejects.toThrow(
      "Import failed. Previous data remains available.",
    );
    const failed = await db().prepare("SELECT status, error_message FROM import_batches ORDER BY id DESC LIMIT 1").first<{ status: string; error_message: string }>();
    expect(failed?.status).toBe("failed");
    expect(failed?.error_message).toMatch(/Checksum mismatch/);
    expect(await domainNames()).toHaveLength(5);
  });

  it("handles lists larger than one upsert chunk", async () => {
    const rows: [string, string][] = Array.from({ length: 1234 }, (_, i) => [`bulk${i}.co.uk`, "2026-10-01T00:00:00Z"]);
    const result = await importFromSource(
      { db: db() },
      { source: "upload", url: null, bytes: new TextEncoder().encode(csvWith(rows)), publishedChecksum: null, compressed: false },
      { now: NOW },
    );
    expect(result.batch).toMatchObject({ insertedRecords: 1234, totalRecords: 1234 });
  });

  it("prevents concurrent imports", async () => {
    await db()
      .prepare("INSERT INTO import_batches (source, status, started_at) VALUES ('nominet', 'running', ?)")
      .bind(new Date().toISOString())
      .run();
    const bytes = await gzip(SAMPLE_DROP_LIST_CSV);
    await expect(importFromProvider({ db: db() }, new FakeProvider(bytes, null))).rejects.toThrow(/already running/);
  });
});

describe("importer pre-check failures", () => {
  beforeEach(resetDatabase);

  it("records a failed batch when the checksum check itself throws", async () => {
    const provider: DropListProvider = {
      source: "nominet",
      getLatestChecksum: async () => {
        throw new TypeError("network down");
      },
      getLatest: async () => {
        throw new Error("should not be called");
      },
    };
    await expect(importFromProvider({ db: db() }, provider, { now: NOW })).rejects.toThrow(
      "Import failed. Previous data remains available.",
    );
    const batch = await db()
      .prepare("SELECT status, error_message FROM import_batches ORDER BY id DESC LIMIT 1")
      .first<{ status: string; error_message: string }>();
    expect(batch).toEqual({ status: "failed", error_message: "network down" });
  });
});

describe("resumable imports", () => {
  beforeEach(resetDatabase);

  const bulkCsv = (count: number) =>
    csvWith(Array.from({ length: count }, (_, i): [string, string] => [`bulk${i}.co.uk`, "2026-10-01T12:00:00Z"]));
  const upload = (text: string): DropListSource => ({
    source: "upload",
    url: null,
    bytes: new TextEncoder().encode(text),
    publishedChecksum: null,
    compressed: false,
  });

  it("prepares, then loads chunk by chunk across calls, then finalises", async () => {
    const started = await importFromSource({ db: db() }, upload(bulkCsv(25)), {
      now: NOW,
      chunkRows: 10,
      loadBudgetMs: 0,
    });
    expect(started.outcome).toBe("started");
    expect(started.batch).toMatchObject({ status: "running", phase: "loading", chunkCount: 3, chunksDone: 0, validRecords: 25 });
    expect(await domainNames()).toHaveLength(0);

    // Budget exhausted immediately: nothing more happens, progress is kept.
    const idle = await continueImport(db(), { now: NOW, budgetMs: 0 });
    expect(idle).toMatchObject({ chunksDone: 0, completed: false });

    const done = await continueImport(db(), { now: NOW });
    expect(done).toMatchObject({ chunksDone: 3, chunkCount: 3, completed: true });
    const batch = await getImportBatch(db(), started.batch!.id);
    expect(batch).toMatchObject({ status: "completed", phase: null, insertedRecords: 25, duplicateRecords: 0, totalRecords: 25 });
    expect(await domainNames()).toHaveLength(25);
    const chunks = await db().prepare("SELECT COUNT(*) AS n FROM import_chunks").first();
    expect(chunks).toEqual({ n: 0 });
    expect(await continueImport(db(), { now: NOW })).toBeNull();
  });

  it("re-loading a chunk (e.g. after an interrupted invocation) is harmless", async () => {
    const started = await importFromSource({ db: db() }, upload(bulkCsv(12)), { now: NOW, chunkRows: 5, loadBudgetMs: 0 });
    await continueImport(db(), { now: NOW });
    // Simulate a second invocation replaying progress from the start.
    await db().prepare("UPDATE import_batches SET status = 'running', phase = 'loading', chunks_done = 0 WHERE id = ?")
      .bind(started.batch!.id).run();
    await continueImport(db(), { now: NOW });
    expect(await domainNames()).toHaveLength(12);
  });

  it("stores drop dates as UK days and keeps the exact UTC drop time", async () => {
    await importFromSource(
      { db: db() },
      upload(csvWith([["late.co.uk", "2026-09-25T23:30:15Z"], ["early.co.uk", "2026-09-25T06:00:00Z"]])),
      { now: NOW },
    );
    const { results } = await db().prepare("SELECT domain, drop_date, drop_time FROM domains ORDER BY domain").all();
    expect(results).toEqual([
      { domain: "early.co.uk", drop_date: "2026-09-25", drop_time: "2026-09-25T06:00:00.000Z" },
      { domain: "late.co.uk", drop_date: "2026-09-26", drop_time: "2026-09-25T23:30:15.000Z" },
    ]);
  });

  it("fails an import whose progress has stalled, keeping existing data", async () => {
    const started = await importFromSource({ db: db() }, upload(bulkCsv(4)), { now: NOW, chunkRows: 2, loadBudgetMs: 0 });
    const later = () => new Date(NOW().getTime() + 31 * 60 * 1000);
    await expect(importFromSource({ db: db() }, upload(bulkCsv(3)), { now: later })).resolves.toMatchObject({
      outcome: "imported",
    });
    const stale = await getImportBatch(db(), started.batch!.id);
    expect(stale).toMatchObject({ status: "failed" });
    expect(stale?.errorMessage).toMatch(/did not finish/);
  });
});
