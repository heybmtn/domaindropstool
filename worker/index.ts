import { createApp } from "./app";
import type { Env } from "./env";
import { handleScheduled } from "./jobs/scheduled";

const app = createApp();

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (controller, env, ctx) => {
    ctx.waitUntil(handleScheduled(controller, env));
  },
} satisfies ExportedHandler<Env>;
