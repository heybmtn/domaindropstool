import type { DropListRecord } from "../types";

/**
 * Parser for the Nominet drop list CSV (`uk.csv.gz`).
 *
 * ASSUMPTION (documented in README): Nominet describes the file as a CSV with
 * the ROID, the domain name and the drop time (UTC). The exact header labels
 * could not be confirmed from this environment, so columns are located by a
 * tolerant header match, falling back to content sniffing when no header row
 * is present. Adjust HEADER_ALIASES if Nominet's labels differ.
 */

type Column = "domain" | "roid" | "dropTime";

const HEADER_ALIASES: Record<Column, string[]> = {
  domain: ["domain", "domainname", "name", "domainnameace", "fqdn"],
  roid: ["roid", "repositoryobjectidentifier", "registryobjectid"],
  dropTime: [
    "droptime",
    "droptimeutc",
    "dropdate",
    "dropdatetime",
    "drop",
    "deletiondate",
    "deletedate",
    "deletiontime",
    "date",
  ],
};

export interface ColumnMap {
  domain: number;
  roid: number | null;
  dropTime: number | null;
  hasHeader: boolean;
}

function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Splits one CSV line (RFC 4180 quoting; fields cannot span lines). */
export function splitCsvLine(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/** Picks the delimiter that appears most often in the first line. */
export function detectDelimiter(line: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = line.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function looksLikeDomain(value: string): boolean {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(value.trim());
}

/** Parses the first line into a column map (header row or content sniffing). */
export function detectColumns(firstLineFields: string[]): ColumnMap {
  const normalised = firstLineFields.map(normaliseHeader);
  const find = (column: Column): number | null => {
    for (const alias of HEADER_ALIASES[column]) {
      const index = normalised.indexOf(alias);
      if (index !== -1) return index;
    }
    return null;
  };

  const domainIndex = find("domain");
  if (domainIndex !== null && !looksLikeDomain(firstLineFields[domainIndex] ?? "")) {
    return { domain: domainIndex, roid: find("roid"), dropTime: find("dropTime"), hasHeader: true };
  }

  // No recognisable header: sniff the first data row.
  const domain = firstLineFields.findIndex(looksLikeDomain);
  const dropTime = firstLineFields.findIndex((value, index) => index !== domain && parseDropTime(value) !== null);
  const roid = firstLineFields.findIndex(
    (value, index) => index !== domain && index !== dropTime && /^[A-Za-z0-9_-]+$/.test(value) && value.length > 0,
  );
  return {
    domain: domain === -1 ? 0 : domain,
    roid: roid === -1 ? null : roid,
    dropTime: dropTime === -1 ? null : dropTime,
    hasHeader: false,
  };
}

const UK_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** Parses a drop time into an ISO-8601 UTC string. Naive timestamps are treated as UTC. */
export function parseDropTime(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  const uk = UK_DATE.exec(text);
  if (uk) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] = uk;
    const date = new Date(Date.UTC(+year!, +month! - 1, +day!, +hour, +minute, +second));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  let iso = text.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += "T00:00:00Z";
  else if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso += "Z";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Yields text lines from a byte stream (handles \n and \r\n). */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      yield buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.length > 0) yield buffer.replace(/\r$/, "");
}

/** Converts raw lines into drop-list records. Blank lines are ignored. */
export async function* parseDropListLines(lines: AsyncIterable<string> | Iterable<string>): AsyncGenerator<DropListRecord> {
  let columns: ColumnMap | null = null;
  let delimiter = ",";
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (line.trim().length === 0) continue;
    if (columns === null) {
      delimiter = detectDelimiter(line);
      const fields = splitCsvLine(line, delimiter);
      columns = detectColumns(fields);
      if (columns.hasHeader) continue;
    }
    const fields = splitCsvLine(line, delimiter);
    yield {
      line: lineNumber,
      rawDomain: fields[columns.domain] ?? "",
      roid: columns.roid !== null ? fields[columns.roid] || null : null,
      dropTime: columns.dropTime !== null ? parseDropTime(fields[columns.dropTime]) : null,
    };
  }
}

/** Returns a decompressed byte stream for gzip or plain CSV input (detected by magic bytes). */
export function toTextStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const source = new Blob([bytes]).stream();
  return isGzip ? source.pipeThrough(new DecompressionStream("gzip")) : source;
}

/** Extracts a hex sha256 from a checksum file ("<hex>  filename" or bare hex). */
export function parseChecksumFile(text: string): string | null {
  const match = /\b([a-f0-9]{64})\b/i.exec(text);
  return match ? match[1]!.toLowerCase() : null;
}
