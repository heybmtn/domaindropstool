import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../worker/index";

describe("scheduled handler", () => {
  it("returns its work as a promise so the runtime waits for it (not ctx.waitUntil)", async () => {
    const waited: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p), passThroughOnException: () => undefined, props: {} };
    const controller = createScheduledController({ cron: "0 0 1 1 *", scheduledTime: Date.now() });
    const result = worker.scheduled?.(controller, env, ctx as unknown as ExecutionContext);
    expect(result).toBeInstanceOf(Promise);
    expect(waited).toHaveLength(0);
    await result;
  });
});
