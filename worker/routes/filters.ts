import { Hono } from "hono";
import { savedFilterBodySchema } from "../../shared/api";
import type { AppEnv } from "../app";
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  updateSavedFilter,
} from "../services/curationService";
import { requireAdmin } from "../utils/auth";
import { parseId, readJson, validate } from "../utils/validate";

export const filterRoutes = new Hono<AppEnv>();

filterRoutes.get("/", async (c) => c.json({ items: await listSavedFilters(c.env.DB) }));

filterRoutes.post("/", requireAdmin, async (c) => {
  const body = validate(savedFilterBodySchema, await readJson(c.req.raw));
  return c.json(await createSavedFilter(c.env.DB, body.name, body.configuration), 201);
});

filterRoutes.put("/:id", requireAdmin, async (c) => {
  const body = validate(savedFilterBodySchema, await readJson(c.req.raw));
  return c.json(await updateSavedFilter(c.env.DB, parseId(c.req.param("id")), body.name, body.configuration));
});

filterRoutes.delete("/:id", requireAdmin, async (c) => {
  await deleteSavedFilter(c.env.DB, parseId(c.req.param("id")));
  return c.body(null, 204);
});
