import { Hono } from "hono";
import { noteBodySchema, statusBodySchema } from "../../shared/api";
import { domainFilterSchema, domainListQuerySchema, searchParamsToRecord } from "../../shared/filters";
import type { AppEnv } from "../app";
import { addNote, deleteNote, listNotes, setUserStatus, updateNote } from "../services/curationService";
import {
  countDomains,
  getBacklinks,
  getDomainDetail,
  getKeywords,
  getMetricsHistory,
  getProviderHistory,
} from "../services/domainService";
import { listDomains } from "../services/domainService";
import { requireAdmin } from "../utils/auth";
import { parseId, readJson, validate } from "../utils/validate";

export const domainRoutes = new Hono<AppEnv>();

function queryRecord(url: string): Record<string, string> {
  return searchParamsToRecord(new URL(url).searchParams);
}

domainRoutes.get("/", async (c) => {
  const query = validate(domainListQuerySchema, queryRecord(c.req.url));
  return c.json(await listDomains(c.env.DB, query));
});

domainRoutes.get("/count", async (c) => {
  const filter = validate(domainFilterSchema, queryRecord(c.req.url));
  return c.json({ total: await countDomains(c.env.DB, filter) });
});

domainRoutes.post("/status", requireAdmin, async (c) => {
  const body = validate(statusBodySchema, await readJson(c.req.raw));
  return c.json({ updated: await setUserStatus(c.env.DB, body.domainIds, body.userStatus) });
});

domainRoutes.get("/:id", async (c) => {
  return c.json(await getDomainDetail(c.env.DB, parseId(c.req.param("id"))));
});

domainRoutes.get("/:id/metrics", async (c) => {
  const id = parseId(c.req.param("id"));
  const [snapshots, providerHistory] = await Promise.all([
    getMetricsHistory(c.env.DB, id),
    getProviderHistory(c.env.DB, id),
  ]);
  return c.json({ snapshots, providerHistory });
});

domainRoutes.get("/:id/keywords", async (c) => {
  return c.json({ items: await getKeywords(c.env.DB, parseId(c.req.param("id"))) });
});

domainRoutes.get("/:id/backlinks", async (c) => {
  return c.json({ items: await getBacklinks(c.env.DB, parseId(c.req.param("id"))) });
});

domainRoutes.get("/:id/notes", async (c) => {
  return c.json({ items: await listNotes(c.env.DB, parseId(c.req.param("id"))) });
});

domainRoutes.post("/:id/notes", requireAdmin, async (c) => {
  const body = validate(noteBodySchema, await readJson(c.req.raw));
  return c.json(await addNote(c.env.DB, parseId(c.req.param("id")), body.note), 201);
});

domainRoutes.put("/:id/notes/:noteId", requireAdmin, async (c) => {
  const body = validate(noteBodySchema, await readJson(c.req.raw));
  const note = await updateNote(c.env.DB, parseId(c.req.param("id")), parseId(c.req.param("noteId"), "note id"), body.note);
  return c.json(note);
});

domainRoutes.delete("/:id/notes/:noteId", requireAdmin, async (c) => {
  await deleteNote(c.env.DB, parseId(c.req.param("id")), parseId(c.req.param("noteId"), "note id"));
  return c.body(null, 204);
});
