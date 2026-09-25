import type { Env } from "../env";
import { createDropListProvider, createSeoProvider } from "../providers";
import { continueImport, DEFAULT_LOAD_BUDGET_MS, importFromProvider } from "../services/importService";
import { researchTick } from "../services/researchProcessor";
import { errorMessage } from "../utils/errors";
import { logger } from "../utils/logger";

/** Cron expressions from wrangler.toml, mapped to jobs. */
export const CRON_RESEARCH_TICK = "*/2 * * * *";
export const CRON_IMPORT_CHECK = "20 * * * *";

export async function runImportCheck(env: Env): Promise<void> {
  try {
    const result = await importFromProvider({ db: env.DB, archive: env.DROPLISTS }, createDropListProvider(env), {
      loadBudgetMs: DEFAULT_LOAD_BUDGET_MS,
    });
    logger.info("cron.import_check", { outcome: result.outcome, batchId: result.batch?.id ?? null });
  } catch (error) {
    // Already recorded on the batch; the previous data remains available.
    logger.error("cron.import_check_failed", { error: errorMessage(error) });
  }
}

/** Continues loading an in-progress import (large lists load across several ticks). */
export async function runImportContinuation(env: Env): Promise<void> {
  try {
    const progress = await continueImport(env.DB, { budgetMs: DEFAULT_LOAD_BUDGET_MS });
    if (progress) logger.info("cron.import_continue", { ...progress });
  } catch (error) {
    logger.error("cron.import_continue_failed", { error: errorMessage(error) });
  }
}

export async function runResearchTick(env: Env): Promise<void> {
  try {
    const result = await researchTick(env.DB, createSeoProvider(env));
    if (result.skipped !== "empty") logger.info("cron.research_tick", { ...result });
  } catch (error) {
    logger.error("cron.research_tick_failed", { error });
  }
}

export async function handleScheduled(controller: ScheduledController, env: Env): Promise<void> {
  switch (controller.cron) {
    case CRON_IMPORT_CHECK:
      await runImportCheck(env);
      break;
    case CRON_RESEARCH_TICK:
      await runImportContinuation(env);
      await runResearchTick(env);
      break;
    default:
      logger.warn("cron.unknown_schedule", { cron: controller.cron });
  }
}
