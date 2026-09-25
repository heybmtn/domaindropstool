import { Hono } from "hono";
import { z } from "zod";
import { domainFilterSchema, searchParamsToRecord } from "../../shared/filters";
import type { AppEnv } from "../app";
import { exportCsvStream, type ExportScope } from "../services/csv";
import { validate } from "../utils/validate";

export const exportRoutes = new Hono<AppEnv>();

const idsSchema = z
  .string()
  .regex(/^\d+(,\d+)*$/)
  .transform((value) => value.split(",").map(Number))
  .pipe(z.array(z.number().int().positive()).min(1).max(10_000));

/**
 * GET /api/export?scope=selected&ids=1,2,3
 * GET /api/export?scope=filter&<filter params>
 * GET /api/export?scope=shortlist
 */
exportRoutes.get("/", async (c) => {
  const params = new URL(c.req.url).searchParams;
  const scopeName = params.get("scope") ?? "filter";
  let scope: ExportScope;
  if (scopeName === "selected") scope = { kind: "ids", ids: validate(idsSchema, params.get("ids") ?? "") };
  else if (scopeName === "shortlist") scope = { kind: "shortlist" };
  else scope = { kind: "filter", filter: validate(domainFilterSchema, searchParamsToRecord(params)) };

  const filename = `domains-${scopeName}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(exportCsvStream(c.env.DB, scope), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
