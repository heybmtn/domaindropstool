import { Hono } from "hono";
import { z } from "zod";
import { researchRequestSchema } from "../../shared/api";
import type { AppEnv } from "../app";
import { isSeoConfigured } from "../providers";
import {
  clearCompletedJobs,
  enqueueResearch,
  getQueueState,
  listJobs,
  pauseQueue,
  resumeQueue,
  retryFailedJobs,
} from "../services/researchQueue";
import { rateLimit, requireAdmin } from "../utils/auth";
import { parseId, readJson, validate } from "../utils/validate";

export const researchRoutes = new Hono<AppEnv>();

const jobsQuerySchema = z.object({
  status: z.enum(["pending", "processing", "completed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

researchRoutes.post("/", requireAdmin, rateLimit("research"), async (c) => {
  const body = validate(researchRequestSchema, await readJson(c.req.raw));
  const result = await enqueueResearch(c.env.DB, body);
  return c.json(result, 202);
});

researchRoutes.get("/queue", async (c) => {
  return c.json(await getQueueState(c.env.DB, isSeoConfigured(c.env)));
});

researchRoutes.get("/jobs", async (c) => {
  const query = validate(jobsQuerySchema, c.req.query());
  const [jobs, state] = await Promise.all([
    listJobs(c.env.DB, query),
    getQueueState(c.env.DB, isSeoConfigured(c.env)),
  ]);
  return c.json({ ...jobs, queue: state });
});

researchRoutes.post("/pause", requireAdmin, async (c) => {
  await pauseQueue(c.env.DB, "Paused manually.");
  return c.json(await getQueueState(c.env.DB, isSeoConfigured(c.env)));
});

researchRoutes.post("/resume", requireAdmin, async (c) => {
  await resumeQueue(c.env.DB);
  return c.json(await getQueueState(c.env.DB, isSeoConfigured(c.env)));
});

researchRoutes.post("/retry-failed", requireAdmin, async (c) => {
  return c.json({ retried: await retryFailedJobs(c.env.DB) });
});

researchRoutes.post("/jobs/:id/retry", requireAdmin, async (c) => {
  return c.json({ retried: await retryFailedJobs(c.env.DB, parseId(c.req.param("id"))) });
});

researchRoutes.post("/clear-completed", requireAdmin, async (c) => {
  return c.json({ cleared: await clearCompletedJobs(c.env.DB) });
});
