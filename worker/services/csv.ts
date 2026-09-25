import type { CsvExportRow } from "../../shared/api";
import type { DomainFilter } from "../../shared/filters";
import { formatLondonDateTime } from "../../shared/time";
import { buildDomainWhere } from "./domainQuery";

/** CSV export, streamed page by page so large exports never sit in memory. */

export const CSV_COLUMNS: (keyof CsvExportRow)[] = [
  "domain",
  "drop_date",
  "drop_time_uk",
  "length",
  "hyphens",
  "numbers",
  "backlinks",
  "referring_domains",
  "organic_traffic",
  "organic_keywords",
  "traffic_value",
  "research_score",
  "status",
  "notes",
];

const PAGE_SIZE = 1000;
/** Hard cap on exported rows per request. */
export const MAX_EXPORT_ROWS = 100_000;

/** RFC 4180 escaping plus a guard against spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}

export type ExportScope =
  | { kind: "ids"; ids: number[] }
  | { kind: "filter"; filter: DomainFilter }
  | { kind: "shortlist" };

function scopeSql(scope: ExportScope, now: Date): { where: string; params: (string | number)[]; join: string } {
  switch (scope.kind) {
    case "ids":
      return { where: "WHERE d.id IN (SELECT value FROM json_each(?))", params: [JSON.stringify(scope.ids)], join: "" };
    case "shortlist":
      return { where: "", params: [], join: "JOIN favourites f ON f.domain_id = d.id" };
    case "filter": {
      const fragment = buildDomainWhere(scope.filter, now);
      return { where: fragment.sql, params: fragment.params, join: "" };
    }
  }
}

export function exportCsvStream(db: D1Database, scope: ExportScope, now = new Date()): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const { where, params, join } = scopeSql(scope, now);
  const sql = `
    SELECT d.domain, d.drop_date, d.drop_time, d.length, d.hyphens, d.digits AS numbers, d.latest_backlinks AS backlinks,
           d.latest_referring_domains AS referring_domains, d.latest_organic_traffic AS organic_traffic,
           d.latest_organic_keywords AS organic_keywords, d.latest_traffic_value AS traffic_value,
           d.research_score, d.user_status AS status,
           (SELECT GROUP_CONCAT(n.note, ' | ') FROM notes n WHERE n.domain_id = d.id) AS notes
    FROM domains d ${join} ${where}
    ORDER BY d.drop_date ASC, d.drop_time ASC, d.domain ASC
    LIMIT ? OFFSET ?`;
  let offset = 0;
  let headerSent = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(csvLine(CSV_COLUMNS)));
      }
      if (offset >= MAX_EXPORT_ROWS) {
        controller.close();
        return;
      }
      const { results } = await db
        .prepare(sql)
        .bind(...params, PAGE_SIZE, offset)
        .all<Omit<CsvExportRow, "drop_time_uk"> & { drop_time: string | null }>();
      offset += results.length;
      if (results.length > 0) {
        const rows: CsvExportRow[] = results.map(({ drop_time, ...row }) => ({
          ...row,
          drop_time_uk: formatLondonDateTime(drop_time),
        }));
        controller.enqueue(encoder.encode(rows.map((row) => csvLine(CSV_COLUMNS.map((c) => row[c]))).join("")));
      }
      if (results.length < PAGE_SIZE) controller.close();
    },
  });
}
