import { z } from "zod";

/**
 * Research Score: a transparent 0–100 prioritisation number. It is NOT a
 * domain valuation. Every point is attributable to a line in the breakdown.
 *
 * SEO inputs are log-scaled against a "reference" value that earns the full
 * weight, so 10 → 100 referring domains matters more than 1,000 → 1,090.
 */

export const scoreWeightsSchema = z.object({
  referringDomains: z.number().min(0).max(100),
  organicTraffic: z.number().min(0).max(100),
  backlinks: z.number().min(0).max(100),
  organicKeywords: z.number().min(0).max(100),
  trafficValue: z.number().min(0).max(100),
  shortDomain: z.number().min(0).max(100),
  /** Points deducted per hyphen. */
  hyphenPenalty: z.number().min(0).max(50),
  /** Points deducted per digit. */
  numberPenalty: z.number().min(0).max(50),
  /** Values that earn the full weight for each SEO input. */
  reference: z.object({
    referringDomains: z.number().positive(),
    organicTraffic: z.number().positive(),
    backlinks: z.number().positive(),
    organicKeywords: z.number().positive(),
    trafficValue: z.number().positive(),
  }),
  /** Labels at or below `fullBonusLength` get the full short-domain bonus, tapering to zero at `zeroBonusLength`. */
  fullBonusLength: z.number().int().min(1).max(63),
  zeroBonusLength: z.number().int().min(2).max(63),
});

export type ScoreWeights = z.infer<typeof scoreWeightsSchema>;

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  referringDomains: 30,
  organicTraffic: 25,
  backlinks: 15,
  organicKeywords: 10,
  trafficValue: 5,
  shortDomain: 15,
  hyphenPenalty: 2,
  numberPenalty: 2,
  reference: {
    referringDomains: 1_000,
    organicTraffic: 10_000,
    backlinks: 50_000,
    organicKeywords: 5_000,
    trafficValue: 10_000,
  },
  fullBonusLength: 5,
  zeroBonusLength: 15,
};

export interface ScoreInputs {
  length: number;
  hyphens: number;
  digits: number;
  referringDomains: number | null;
  backlinks: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  trafficValue: number | null;
}

export interface ScoreLine {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface ScoreResult {
  score: number;
  breakdown: ScoreLine[];
}

function logScaled(value: number | null, reference: number): number {
  if (value === null || value <= 0) return 0;
  return Math.min(1, Math.log10(1 + value) / Math.log10(1 + reference));
}

function roundPoints(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeResearchScore(inputs: ScoreInputs, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): ScoreResult {
  const lines: ScoreLine[] = [];
  const seo: [keyof ScoreWeights["reference"], string, number | null][] = [
    ["referringDomains", "Referring Domains", inputs.referringDomains],
    ["organicTraffic", "Organic Traffic", inputs.organicTraffic],
    ["backlinks", "Backlinks", inputs.backlinks],
    ["organicKeywords", "Organic Keywords", inputs.organicKeywords],
    ["trafficValue", "Traffic Value", inputs.trafficValue],
  ];

  for (const [key, label, value] of seo) {
    const weight = weights[key];
    const points = roundPoints(weight * logScaled(value, weights.reference[key]));
    lines.push({
      key,
      label,
      points,
      detail: `log scale of ${value ?? "n/a"} vs ${weights.reference[key].toLocaleString("en-GB")} (max ${weight})`,
    });
  }

  const span = Math.max(1, weights.zeroBonusLength - weights.fullBonusLength);
  const shortness = Math.max(0, Math.min(1, (weights.zeroBonusLength - inputs.length) / span));
  lines.push({
    key: "shortDomain",
    label: "Short Domain",
    points: roundPoints(weights.shortDomain * shortness),
    detail: `${inputs.length} characters (full bonus ≤ ${weights.fullBonusLength}, none ≥ ${weights.zeroBonusLength})`,
  });

  if (inputs.hyphens > 0) {
    lines.push({
      key: "hyphenPenalty",
      label: "Hyphen Penalty",
      points: -roundPoints(weights.hyphenPenalty * inputs.hyphens),
      detail: `${inputs.hyphens} hyphen(s) × ${weights.hyphenPenalty}`,
    });
  }
  if (inputs.digits > 0) {
    lines.push({
      key: "numberPenalty",
      label: "Number Penalty",
      points: -roundPoints(weights.numberPenalty * inputs.digits),
      detail: `${inputs.digits} digit(s) × ${weights.numberPenalty}`,
    });
  }

  const total = lines.reduce((sum, line) => sum + line.points, 0);
  const score = Math.round(Math.max(0, Math.min(100, total)));
  return { score, breakdown: lines.sort((a, b) => b.points - a.points) };
}
