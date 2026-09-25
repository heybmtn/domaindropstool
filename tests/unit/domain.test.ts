import { describe, expect, it } from "vitest";
import { lexicalFeatures, normaliseDomain, parseDomain } from "../../shared/domain";

describe("normaliseDomain", () => {
  it("lowercases, trims and strips a trailing dot", () => {
    expect(normaliseDomain("EXAMPLE.CO.UK")).toBe("example.co.uk");
    expect(normaliseDomain("example.co.uk.")).toBe("example.co.uk");
    expect(normaliseDomain("  example.co.uk \t")).toBe("example.co.uk");
    expect(normaliseDomain('"Example.co.uk"')).toBe("example.co.uk");
    expect(normaliseDomain("\uFEFFexample.co.uk")).toBe("example.co.uk");
  });
});

describe("parseDomain", () => {
  it("accepts a valid .co.uk domain", () => {
    expect(parseDomain("example.co.uk")).toEqual({
      ok: true,
      value: { domain: "example.co.uk", tld: "co.uk", sld: "example" },
    });
  });

  it("normalises uppercase, trailing dots and whitespace to the same value", () => {
    for (const input of ["EXAMPLE.CO.UK", "example.co.uk.", " example.co.uk "]) {
      const result = parseDomain(input);
      expect(result.ok && result.value.domain).toBe("example.co.uk");
    }
  });

  it("rejects non-co.uk domains as unsupported", () => {
    for (const input of ["example.org.uk", "example.uk", "example.com", "example.me.uk", "co.uk"]) {
      expect(parseDomain(input)).toMatchObject({ ok: false });
    }
    expect(parseDomain("example.org.uk")).toEqual({ ok: false, reason: "unsupported_tld" });
  });

  it("rejects sub-domains", () => {
    expect(parseDomain("www.example.co.uk")).toEqual({ ok: false, reason: "unsupported_tld" });
  });

  it("rejects invalid labels", () => {
    for (const input of ["", "bad_domain.co.uk", "-lead.co.uk", "trail-.co.uk", "sp ace.co.uk", "a..co.uk", "émoji.co.uk"]) {
      expect(parseDomain(input)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(parseDomain(`${"a".repeat(64)}.co.uk`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts punycode and digits", () => {
    expect(parseDomain("xn--caf-dma.co.uk").ok).toBe(true);
    expect(parseDomain("123.co.uk").ok).toBe(true);
  });
});

describe("lexicalFeatures", () => {
  it("counts length, hyphens and digits", () => {
    expect(lexicalFeatures("shop-4-you")).toEqual({ length: 10, hyphens: 2, digits: 1 });
  });
});
