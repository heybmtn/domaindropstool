import { createApp } from "./app";
import type { Env } from "./env";
import { handleScheduled } from "./jobs/scheduled";

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  // Return the promise: the runtime waits for it (up to the 15-minute cron limit).
  // Handing it to ctx.waitUntil() instead would cut long imports short.
  scheduled: (controller, env) => handleScheduled(controller, env),
} satisfies ExportedHandler<Env>;
