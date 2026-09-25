/**
 * Neutral, automated research warnings. They highlight things worth a manual
 * look; they never assert that a domain is spam or worthless.
 */

export interface WarningInputs {
  researchStatus: string;
  lastResearchedAt: string | null;
  backlinks: number | null;
  referringDomains: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  /** Sum of estimated traffic from the top 3 keywords, if keyword data was captured. */
  topKeywordsTraffic: number | null;
  /** Monthly organic traffic history, oldest first. */
  trafficHistory: number[];
  spamScore: number | null;
}

export interface ResearchWarning {
  code: string;
  message: string;
}

export const WARNING_THRESHOLDS = {
  backlinksPerDomain: 100,
  minBacklinksForRatio: 500,
  keywordConcentration: 0.8,
  historicalDecline: 0.5,
  staleDays: 30,
  highSpamScore: 50,
} as const;

const DAY_MS = 86_400_000;

export function computeWarnings(input: WarningInputs, now: Date = new Date()): ResearchWarning[] {
  const warnings: ResearchWarning[] = [];

  if (input.researchStatus === "failed") {
    warnings.push({ code: "research_failed", message: "Research request failed." });
  }

  if (input.researchStatus !== "completed") {
    if (input.researchStatus !== "failed") {
      warnings.push({ code: "insufficient_data", message: "Insufficient SEO data." });
    }
    return warnings;
  }

  const hasAnyMetric = [input.backlinks, input.referringDomains, input.organicTraffic, input.organicKeywords].some(
    (value) => value !== null && value > 0,
  );
  if (!hasAnyMetric) {
    warnings.push({ code: "insufficient_data", message: "Insufficient SEO data." });
  }

  if (
    input.backlinks !== null &&
    input.referringDomains !== null &&
    input.referringDomains > 0 &&
    input.backlinks >= WARNING_THRESHOLDS.minBacklinksForRatio &&
    input.backlinks / input.referringDomains >= WARNING_THRESHOLDS.backlinksPerDomain
  ) {
    warnings.push({
      code: "backlink_ratio",
      message: "High backlink count relative to referring domains.",
    });
  }

  if (
    input.topKeywordsTraffic !== null &&
    input.organicTraffic !== null &&
    input.organicTraffic > 0 &&
    input.topKeywordsTraffic / input.organicTraffic >= WARNING_THRESHOLDS.keywordConcentration
  ) {
    warnings.push({
      code: "keyword_concentration",
      message: "Traffic appears highly concentrated in a small number of keywords.",
    });
  }

  const history = input.trafficHistory.filter((value) => Number.isFinite(value));
  if (history.length >= 3) {
    const peak = Math.max(...history);
    const latest = history[history.length - 1]!;
    if (peak > 0 && latest <= peak * (1 - WARNING_THRESHOLDS.historicalDecline)) {
      warnings.push({ code: "traffic_decline", message: "Historical traffic has declined significantly." });
    }
  }

  if (input.spamScore !== null && input.spamScore >= WARNING_THRESHOLDS.highSpamScore) {
    warnings.push({
      code: "spam_score",
      message: "Provider backlink spam score is elevated; review link quality manually.",
    });
  }

  if (input.lastResearchedAt) {
    const age = (now.getTime() - new Date(input.lastResearchedAt).getTime()) / DAY_MS;
    if (age > WARNING_THRESHOLDS.staleDays) {
      warnings.push({ code: "stale_metrics", message: "Metrics have not been refreshed recently." });
    }
  }

  return warnings;
}
