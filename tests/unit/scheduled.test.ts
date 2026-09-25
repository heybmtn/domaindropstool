import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../../worker/index";

describe("scheduled handler", () => {
  it("returns its work as a promise so the runtime waits for it (it does not use ctx.waitUntil)", async () => {
    const controller = createScheduledController({ cron: "0 0 1 1 *", scheduledTime: Date.now() });
    const scheduled = worker.scheduled as unknown as (c: ScheduledController, e: typeof env) => unknown;
    const result = scheduled(controller, env);
    expect(result).toBeInstanceOf(Promise);
    await result;
  });
});
