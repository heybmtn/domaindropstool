import { describe, expect, it } from "vitest";
import {
  detectColumns,
  parseChecksumFile,
  parseDropListLines,
  parseDropTime,
  readLines,
  splitCsvLine,
  toTextStream,
} from "../../worker/providers/nominet/parse";
import { gzip, SAMPLE_DROP_LIST_CSV } from "../fixtures/dropList";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("splitCsvLine", () => {
  it("handles quoted fields and escaped quotes", () => {
    expect(splitCsvLine('a,"b,c","d ""e"""')).toEqual(["a", "b,c", 'd "e"']);
  });
});

describe("detectColumns", () => {
  it("maps header aliases regardless of order and case", () => {
    expect(detectColumns(["Drop Time (UTC)", "domain", "ROID"])).toEqual({
      domain: 1,
      roid: 2,
      dropTime: 0,
      hasHeader: true,
    });
  });

  it("sniffs columns when there is no header", () => {
    const columns = detectColumns(["1234-UK", "example.co.uk", "2026-09-25T13:00:00Z"]);
    expect(columns).toMatchObject({ domain: 1, dropTime: 2, roid: 0, hasHeader: false });
  });
});

describe("parseDropTime", () => {
  it("parses ISO, naive and UK formats as UTC", () => {
    expect(parseDropTime("2026-09-25T13:00:00Z")).toBe("2026-09-25T13:00:00.000Z");
    expect(parseDropTime("2026-09-25 13:00:00")).toBe("2026-09-25T13:00:00.000Z");
    expect(parseDropTime("2026-09-25")).toBe("2026-09-25T00:00:00.000Z");
    expect(parseDropTime("25/09/2026 13:00")).toBe("2026-09-25T13:00:00.000Z");
    expect(parseDropTime("not a date")).toBeNull();
    expect(parseDropTime("")).toBeNull();
  });
});

describe("parseDropListLines", () => {
  it("parses a gzipped Nominet-style file", async () => {
    const bytes = await gzip(SAMPLE_DROP_LIST_CSV);
    const records = await collect(parseDropListLines(readLines(toTextStream(bytes))));
    expect(records).toHaveLength(11);
    expect(records[0]).toEqual({
      line: 2,
      rawDomain: "example.co.uk",
      roid: "1001-UK",
      dropTime: "2026-09-25T13:00:00.000Z",
    });
    expect(records[3]?.rawDomain).toBe("spaced.co.uk");
  });

  it("parses plain CSV with CRLF line endings", async () => {
    const text = "domain,drop date\r\nfoo.co.uk,2026-10-01\r\nbar.co.uk,2026-10-02\r\n";
    const records = await collect(parseDropListLines(readLines(toTextStream(new TextEncoder().encode(text)))));
    expect(records.map((r) => r.rawDomain)).toEqual(["foo.co.uk", "bar.co.uk"]);
    expect(records[1]?.dropTime).toBe("2026-10-02T00:00:00.000Z");
  });

  it("supports a bare list of domains", async () => {
    const records = await collect(parseDropListLines(["alpha.co.uk", "beta.co.uk"]));
    expect(records.map((r) => r.rawDomain)).toEqual(["alpha.co.uk", "beta.co.uk"]);
  });
});

describe("parseChecksumFile", () => {
  it("extracts a sha256 hex digest", () => {
    const hex = "a".repeat(64);
    expect(parseChecksumFile(`${hex}  uk.csv.gz\n`)).toBe(hex);
    expect(parseChecksumFile("nothing here")).toBeNull();
  });
});
