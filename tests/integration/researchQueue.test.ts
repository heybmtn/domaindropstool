import { beforeEach, describe, expect, it } from "vitest";
import { ProviderError, type SeoProvider } from "../../worker/providers/types";
import { MockSeoProvider } from "../../worker/providers/mockSeoProvider";
import { researchTick } from "../../worker/services/researchProcessor";
import {
  clearCompletedJobs,
  enqueueResearch,
  getQueueCounts,
  pauseQueue,
  resumeQueue,
  retryFailedJobs,
} from "../../worker/services/researchQueue";
import { getQueueControl, updateResearchSettings } from "../../worker/services/settings";
import { db, resetDatabase, seedDomains } from "../helpers";

let clock = new Date("2026-09-25T12:00:00Z");
const now = () => clock;
const advance = (seconds: number) => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

/** Wraps the mock provider so tests can inject failures per domain. */
class ScriptedProvider extends MockSeoProvider {
  calls = 0;
  failures = new Map<string, () => Error>();
  override async getBacklinkSummary(domain: string) {
    this.calls += 1;
    const failure = this.failures.get(domain);
    if (failure) throw failure();
    return super.getBacklinkSummary(domain);
  }
}

async function jobStatuses() {
  const { results } = await db()
    .prepare("SELECT d.domain, j.status, j.attempts FROM research_jobs j JOIN domains d ON d.id = j.domain_id ORDER BY d.domain")
    .all<{ domain: string; status: string; attempts: number }>();
  return results;
}

describe("research queue", () => {
  beforeEach(async () => {
    clock = new Date("2026-09-25T12:00:00Z");
    await resetDatabase();
    await updateResearchSettings(db(), { batchSize: 10, concurrency: 2, dailyDomainLimit: 100, maxAttempts: 3 });
  });

  it("creates jobs without calling the provider and dedupes active jobs", async () => {
    const ids = await seedDomains([{ domain: "alpha.co.uk" }, { domain: "beta.co.uk" }]);
    const first = await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());
    expect(first).toEqual({ requested: 2, enqueued: 2, alreadyQueued: 0, skippedRecent: 0 });
    const second = await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());
    expect(second).toMatchObject({ enqueued: 0, alreadyQueued: 2 });
    expect(await getQueueCounts(db())).toEqual({ pending: 2, processing: 0, completed: 0, failed: 0 });
    const domain = await db().prepare("SELECT research_status FROM domains WHERE id = ?").bind(ids[0]).first();
    expect(domain).toEqual({ research_status: "pending" });
  });

  it("enforces the per-request limit and requires a confirmed count for filters", async () => {
    await updateResearchSettings(db(), { maxEnqueuePerRequest: 2 });
    await seedDomains([{ domain: "a1.co.uk" }, { domain: "a2.co.uk" }, { domain: "a3.co.uk" }]);
    await expect(
      enqueueResearch(db(), { filter: {}, confirmCount: 3, priority: 0, force: false }, now()),
    ).rejects.toThrow(/per-request research limit/);
    await expect(
      enqueueResearch(db(), { filter: { q: "a1" }, priority: 0, force: false }, now()),
    ).rejects.toThrow(/confirm/);
    const ok = await enqueueResearch(db(), { filter: { q: "a1" }, confirmCount: 1, priority: 0, force: false }, now());
    expect(ok.enqueued).toBe(1);
  });

  it("completes jobs, stores a dated snapshot and updates latest metrics", async () => {
    const [id] = await seedDomains([{ domain: "alpha.co.uk" }]);
    await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now());
    const result = await researchTick(db(), new MockSeoProvider(), now);
    expect(result).toMatchObject({ processed: 1, completed: 1, failed: 0 });

    const domain = await db()
      .prepare("SELECT research_status, latest_metrics_id, research_score, last_researched_at FROM domains WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    expect(domain?.research_status).toBe("completed");
    expect(domain?.latest_metrics_id).not.toBeNull();
    expect(typeof domain?.research_score).toBe("number");

    const keywords = await db().prepare("SELECT COUNT(*) AS n FROM domain_keywords WHERE domain_id = ?").bind(id).first();
    expect(keywords).toEqual({ n: 3 });
    const usage = await db().prepare("SELECT domains, provider_calls FROM research_usage").first();
    expect(usage).toEqual({ domains: 1, provider_calls: 4 });
  });

  it("keeps historical snapshots instead of overwriting", async () => {
    const [id] = await seedDomains([{ domain: "alpha.co.uk" }]);
    await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now());
    await researchTick(db(), new MockSeoProvider(), now);
    advance(3 * 86_400);
    await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now());
    await researchTick(db(), new MockSeoProvider(), now);
    const { results } = await db().prepare("SELECT metric_date FROM domain_metrics WHERE domain_id = ? ORDER BY id").bind(id).all();
    expect(results).toEqual([{ metric_date: "2026-09-25" }, { metric_date: "2026-09-28" }]);
  });

  it("skips recently researched domains unless forced", async () => {
    const [id] = await seedDomains([
      { domain: "alpha.co.uk", researchStatus: "completed", lastResearchedAt: "2026-09-25T06:00:00Z" },
    ]);
    expect(await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now())).toMatchObject({
      enqueued: 0,
      skippedRecent: 1,
    });
    expect(await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: true }, now())).toMatchObject({ enqueued: 1 });
  });

  it("retries retryable failures with backoff, then fails after max attempts", async () => {
    const [id] = await seedDomains([{ domain: "flaky.co.uk" }]);
    const provider = new ScriptedProvider();
    provider.failures.set("flaky.co.uk", () => new ProviderError("HTTP 503", { retryable: true }));
    await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now());

    expect(await researchTick(db(), provider, now)).toMatchObject({ retried: 1 });
    expect(await jobStatuses()).toEqual([{ domain: "flaky.co.uk", status: "pending", attempts: 1 }]);

    // Not eligible again until the backoff passes.
    expect(await researchTick(db(), provider, now)).toMatchObject({ skipped: "empty" });
    advance(61);
    expect(await researchTick(db(), provider, now)).toMatchObject({ retried: 1 });
    advance(121);
    expect(await researchTick(db(), provider, now)).toMatchObject({ failed: 1 });
    expect(await jobStatuses()).toEqual([{ domain: "flaky.co.uk", status: "failed", attempts: 3 }]);
    const domain = await db().prepare("SELECT research_status FROM domains WHERE id = ?").bind(id).first();
    expect(domain).toEqual({ research_status: "failed" });

    // Manual retry re-queues it with a fresh attempt count.
    expect(await retryFailedJobs(db(), undefined, now())).toBe(1);
    expect(await jobStatuses()).toEqual([{ domain: "flaky.co.uk", status: "pending", attempts: 0 }]);
  });

  it("fails non-retryable errors immediately", async () => {
    const [id] = await seedDomains([{ domain: "bad.co.uk" }]);
    const provider = new ScriptedProvider();
    provider.failures.set("bad.co.uk", () => new ProviderError("Invalid target", { retryable: false }));
    await enqueueResearch(db(), { domainIds: [id!], priority: 0, force: false }, now());
    expect(await researchTick(db(), provider, now)).toMatchObject({ failed: 1 });
  });

  it("auto-pauses the queue on provider limits and releases unprocessed jobs", async () => {
    const ids = await seedDomains([{ domain: "a.co.uk" }, { domain: "b.co.uk" }, { domain: "c.co.uk" }]);
    await updateResearchSettings(db(), { concurrency: 1 });
    const provider = new ScriptedProvider();
    provider.failures.set("a.co.uk", () => new ProviderError("Research paused because the provider limit was reached.", { retryable: true, pauseQueue: true }));
    await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());

    const result = await researchTick(db(), provider, now);
    expect(result.paused).toBe(true);
    expect(provider.calls).toBe(1);
    const control = await getQueueControl(db());
    expect(control.paused).toBe(true);
    expect(control.pauseReason).toMatch(/provider limit/);
    expect((await jobStatuses()).every((job) => job.status === "pending" && job.attempts === 0)).toBe(true);

    // Paused queue does nothing until resumed.
    expect(await researchTick(db(), provider, now)).toMatchObject({ skipped: "paused" });
    provider.failures.clear();
    await resumeQueue(db());
    expect(await researchTick(db(), provider, now)).toMatchObject({ completed: 3 });
  });

  it("respects manual pause, batch size, priority and the daily limit", async () => {
    const ids = await seedDomains([{ domain: "p1.co.uk" }, { domain: "p2.co.uk" }, { domain: "p3.co.uk" }]);
    await updateResearchSettings(db(), { batchSize: 1, dailyDomainLimit: 2 });
    await enqueueResearch(db(), { domainIds: [ids[0]!, ids[1]!], priority: 0, force: false }, now());
    await enqueueResearch(db(), { domainIds: [ids[2]!], priority: 5, force: false }, now());

    await pauseQueue(db(), "manual");
    const provider = new ScriptedProvider();
    expect(await researchTick(db(), provider, now)).toMatchObject({ skipped: "paused" });
    expect(provider.calls).toBe(0);
    await resumeQueue(db());

    await researchTick(db(), provider, now);
    const first = await db().prepare("SELECT d.domain FROM research_jobs j JOIN domains d ON d.id = j.domain_id WHERE j.status = 'completed'").all();
    expect(first.results).toEqual([{ domain: "p3.co.uk" }]); // highest priority first, one per batch

    await researchTick(db(), provider, now);
    expect(await researchTick(db(), provider, now)).toMatchObject({ skipped: "daily_limit" });
    expect(await getQueueCounts(db())).toEqual({ pending: 1, processing: 0, completed: 2, failed: 0 });
  });

  it("does nothing when no provider is configured", async () => {
    const ids = await seedDomains([{ domain: "x.co.uk" }]);
    await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());
    expect(await researchTick(db(), null, now)).toMatchObject({ skipped: "not_configured" });
  });

  it("clearing completed jobs keeps metric history", async () => {
    const ids = await seedDomains([{ domain: "keep.co.uk" }]);
    await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());
    await researchTick(db(), new MockSeoProvider(), now);
    expect(await clearCompletedJobs(db())).toBe(1);
    const metrics = await db().prepare("SELECT COUNT(*) AS n FROM domain_metrics").first();
    expect(metrics).toEqual({ n: 1 });
  });

  it("reclaims jobs stuck in processing", async () => {
    const ids = await seedDomains([{ domain: "stuck.co.uk" }]);
    await enqueueResearch(db(), { domainIds: ids, priority: 0, force: false }, now());
    await db().prepare("UPDATE research_jobs SET status = 'processing', started_at = '2026-09-25T10:00:00Z'").run();
    const provider: SeoProvider = new MockSeoProvider();
    expect(await researchTick(db(), provider, now)).toMatchObject({ completed: 1 });
  });
});
