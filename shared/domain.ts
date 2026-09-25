/**
 * Domain name normalisation and TLD policy.
 *
 * Only `.co.uk` is supported today. The policy is data-driven so further
 * TLDs can be added later without touching the importer or the UI.
 */

export interface TldPolicy {
  /** Suffix without leading dot, e.g. "co.uk". */
  readonly tld: string;
}

export const CO_UK: TldPolicy = { tld: "co.uk" };
export const SUPPORTED_TLDS: readonly TldPolicy[] = [CO_UK];

/** A single DNS label: 1–63 chars, a–z/0–9/hyphen, no leading/trailing hyphen. */
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_DOMAIN_LENGTH = 253;

export interface ParsedDomain {
  domain: string;
  tld: string;
  sld: string;
}

/**
 * Normalises raw input: trims whitespace (including BOM/NBSP), lowercases,
 * removes surrounding quotes and a single trailing dot.
 */
export function normaliseDomain(raw: string): string {
  let value = raw.replace(/^﻿/, "").replace(/ /g, " ").trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  value = value.toLowerCase();
  if (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

export type DomainParseResult =
  | { ok: true; value: ParsedDomain }
  | { ok: false; reason: "invalid" | "unsupported_tld" };

/**
 * Normalises and validates a domain against the supported TLD policies.
 * Accepts only registrable names directly under the TLD (e.g. example.co.uk),
 * never sub-domains (a.example.co.uk) or other suffixes (example.org.uk).
 */
export function parseDomain(raw: string, policies: readonly TldPolicy[] = SUPPORTED_TLDS): DomainParseResult {
  const domain = normaliseDomain(raw);
  if (domain.length === 0 || domain.length > MAX_DOMAIN_LENGTH) return { ok: false, reason: "invalid" };

  const labels = domain.split(".");
  if (labels.some((label) => !LABEL_PATTERN.test(label))) return { ok: false, reason: "invalid" };

  for (const policy of policies) {
    const suffix = `.${policy.tld}`;
    if (!domain.endsWith(suffix)) continue;
    const sld = domain.slice(0, -suffix.length);
    if (sld.length === 0 || sld.includes(".")) return { ok: false, reason: "unsupported_tld" };
    if (!LABEL_PATTERN.test(sld)) return { ok: false, reason: "invalid" };
    return { ok: true, value: { domain, tld: policy.tld, sld } };
  }
  return { ok: false, reason: "unsupported_tld" };
}

export interface LexicalFeatures {
  length: number;
  hyphens: number;
  digits: number;
}

/** Cheap lexical counts stored alongside each domain for indexed filtering. */
export function lexicalFeatures(sld: string): LexicalFeatures {
  let hyphens = 0;
  let digits = 0;
  for (const ch of sld) {
    if (ch === "-") hyphens += 1;
    else if (ch >= "0" && ch <= "9") digits += 1;
  }
  return { length: sld.length, hyphens, digits };
}
