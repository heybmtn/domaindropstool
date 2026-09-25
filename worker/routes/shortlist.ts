import { Hono } from "hono";
import { shortlistBodySchema } from "../../shared/api";
import { domainListQuerySchema, searchParamsToRecord } from "../../shared/filters";
import type { AppEnv } from "../app";
import { addToShortlist, removeFromShortlist } from "../services/curationService";
import { listDomains } from "../services/domainService";
import { requireAdmin } from "../utils/auth";
import { parseId, readJson, validate } from "../utils/validate";

export const shortlistRoutes = new Hono<AppEnv>();

shortlistRoutes.get("/", async (c) => {
  const record = searchParamsToRecord(new URL(c.req.url).searchParams);
  const query = validate(domainListQuerySchema, { sort: "research_score", dir: "desc", ...record, shortlisted: "true" });
  return c.json(await listDomains(c.env.DB, query));
});

shortlistRoutes.post("/", requireAdmin, async (c) => {
  const body = validate(shortlistBodySchema, await readJson(c.req.raw));
  return c.json({ added: await addToShortlist(c.env.DB, body.domainIds) }, 201);
});

shortlistRoutes.delete("/:domainId", requireAdmin, async (c) => {
  await removeFromShortlist(c.env.DB, parseId(c.req.param("domainId"), "domain id"));
  return c.body(null, 204);
});
