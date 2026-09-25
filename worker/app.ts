import { Hono } from "hono";
import type { Env } from "./env";
import { domainRoutes } from "./routes/domains";
import { exportRoutes } from "./routes/export";
import { filterRoutes } from "./routes/filters";
import { importRoutes } from "./routes/imports";
import { researchRoutes } from "./routes/research";
import { settingsRoutes } from "./routes/settings";
import { shortlistRoutes } from "./routes/shortlist";
import { getDashboardStats } from "./services/domainService";
import { AppError } from "./utils/errors";
import { logger } from "./utils/logger";

export interface AppEnv {
  Bindings: Env;
  Variables: { requestId: string; actor?: string };
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", async (c, next) => {
    const requestId = c.req.header("CF-Ray") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    await next();
    c.header("X-Request-Id", requestId);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  });

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/stats", async (c) => c.json(await getDashboardStats(c.env.DB)));
  app.route("/domains", domainRoutes);
  app.route("/research", researchRoutes);
  app.route("/import", importRoutes);
  app.route("/filters", filterRoutes);
  app.route("/shortlist", shortlistRoutes);
  app.route("/export", exportRoutes);
  app.route("/settings", settingsRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found." } }, 404));

  app.onError((error, c) => {
    const requestId = c.get("requestId");
    if (error instanceof AppError) {
      if (error.status >= 500) logger.error("request.app_error", { requestId, code: error.code, error });
      return c.json(
        { error: { code: error.code, message: error.message, requestId, details: error.details } },
        error.status,
      );
    }
    logger.error("request.unexpected_error", { requestId, path: c.req.path, method: c.req.method, error });
    return c.json(
      { error: { code: "internal_error", message: "Unexpected server error. Please try again.", requestId } },
      500,
    );
  });

  return app;
}
