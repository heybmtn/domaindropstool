import { Hono } from "hono";
import { settingsUpdateSchema, type SettingsDto } from "../../shared/api";
import type { AppEnv } from "../app";
import { DEFAULT_DATAFORSEO_BASE_URL } from "../env";
import { createSeoProvider, dropListUrl, isMockSeo, isSeoConfigured } from "../providers";
import { ProviderError } from "../providers/types";
import { getLastCompletedImport } from "../services/importService";
import {
  getQueueControl,
  getRegistrarSettings,
  getResearchSettings,
  getScoreWeights,
  updateRegistrarSettings,
  updateResearchSettings,
  updateScoreWeights,
} from "../services/settings";
import { authMode, rateLimit, requireAdmin, resolveAdmin } from "../utils/auth";
import { errorMessage } from "../utils/errors";
import { logger } from "../utils/logger";
import { readJson, validate } from "../utils/validate";

export const settingsRoutes = new Hono<AppEnv>();

async function buildSettings(c: { env: AppEnv["Bindings"] }): Promise<SettingsDto> {
  const env = c.env;
  const [research, scoring, queue, lastImport, registrar] = await Promise.all([
    getResearchSettings(env.DB),
    getScoreWeights(env.DB),
    getQueueControl(env.DB),
    getLastCompletedImport(env.DB),
    getRegistrarSettings(env.DB),
  ]);
  const mode = authMode(env);
  return {
    research,
    scoring,
    queue,
    nominet: { dropListUrl: dropListUrl(env), lastImport },
    dataforseo: {
      configured: isSeoConfigured(env),
      baseUrl: env.DATAFORSEO_BASE_URL || DEFAULT_DATAFORSEO_BASE_URL,
      mock: isMockSeo(env),
    },
    auth: { mode, tokenRequired: mode !== "open" || env.ENVIRONMENT !== "development" },
    registrar,
  };
}

settingsRoutes.get("/", async (c) => c.json(await buildSettings(c)));

settingsRoutes.put("/", requireAdmin, async (c) => {
  const body = validate(settingsUpdateSchema, await readJson(c.req.raw));
  if (body.research) await updateResearchSettings(c.env.DB, body.research);
  if (body.scoring) await updateScoreWeights(c.env.DB, body.scoring);
  if (body.registrar) await updateRegistrarSettings(c.env.DB, body.registrar);
  logger.info("settings.updated", { actor: c.get("actor"), sections: Object.keys(body) });
  return c.json(await buildSettings(c));
});

/** Reports whether the caller's credentials authorise admin operations. */
settingsRoutes.get("/auth", async (c) => {
  const actor = await resolveAdmin(c.req.raw, c.env);
  return c.json({ mode: authMode(c.env), authorized: actor !== null });
});

settingsRoutes.post("/dataforseo/test", requireAdmin, rateLimit("dataforseo-test"), async (c) => {
  const provider = createSeoProvider(c.env);
  if (!provider) return c.json({ ok: false, message: "DataForSEO is not configured." });
  try {
    return c.json(await provider.testConnection());
  } catch (error) {
    logger.warn("dataforseo.connection_test_failed", { error: errorMessage(error) });
    const message = error instanceof ProviderError ? error.message : "Connection test failed.";
    return c.json({ ok: false, message });
  }
});
