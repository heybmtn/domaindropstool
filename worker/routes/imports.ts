import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { createDropListProvider } from "../providers";
import { getImportBatch, importFromProvider, importFromSource, listImportBatches } from "../services/importService";
import { rateLimit, requireAdmin } from "../utils/auth";
import { AppError, notFound } from "../utils/errors";
import { parseId, validate } from "../utils/validate";

export const importRoutes = new Hono<AppEnv>();

/** Uploads larger than this should go through the scheduled Nominet import instead. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

importRoutes.post("/", requireAdmin, rateLimit("import"), async (c) => {
  const force = c.req.query("force") === "true";
  const result = await importFromProvider(
    { db: c.env.DB, archive: c.env.DROPLISTS },
    createDropListProvider(c.env),
    { force },
  );
  return c.json(result);
});

/** Manual import of a drop-list file (CSV or .csv.gz) sent as the raw request body. */
importRoutes.post("/upload", requireAdmin, rateLimit("import"), async (c) => {
  const length = Number(c.req.header("Content-Length") ?? "0");
  if (length > MAX_UPLOAD_BYTES) throw new AppError(400, "file_too_large", "File is too large to upload.");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new AppError(400, "empty_file", "The uploaded file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new AppError(400, "file_too_large", "File is too large to upload.");
  const result = await importFromSource(
    { db: c.env.DB, archive: c.env.DROPLISTS },
    {
      source: "upload",
      url: c.req.query("filename")?.slice(0, 200) ?? null,
      bytes,
      publishedChecksum: null,
      compressed: bytes[0] === 0x1f && bytes[1] === 0x8b,
    },
    { force: c.req.query("force") === "true", markMissing: c.req.query("partial") !== "true" },
  );
  return c.json(result);
});

importRoutes.get("/history", async (c) => {
  const query = validate(historyQuerySchema, c.req.query());
  return c.json({ items: await listImportBatches(c.env.DB, query.limit, query.offset) });
});

importRoutes.get("/:id", async (c) => {
  const batch = await getImportBatch(c.env.DB, parseId(c.req.param("id")));
  if (!batch) throw notFound("Import");
  return c.json(batch);
});
