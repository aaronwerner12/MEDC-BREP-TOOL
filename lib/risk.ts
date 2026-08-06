import type { SignalType } from "./types";

// Company retention-risk index.
//
// The point of a Business Retention & Expansion early-warning system is to flag
// firms likely to shed jobs, contract, close, or relocate. Not every negative
// signal predicts that. A lone lawsuit or a routine citation is normal
// cost-of-business noise; layoffs, an out-of-area acquisition, or a company
// putting its own building up for lease are strong, revealed-preference
// predictors of contraction/exit.
//
// So each signal is weighted by how predictive its BREP category is of an actual
// retention event, then by tier, priority, recency, and the employer's size
// (jobs at stake). The composite maps to an honest ordinal scale where "At risk"
// is reserved for genuine, usually corroborated, retention threats.

export interface RiskInput {
  signal_type: SignalType;
  tier: string;
  priority: number;
  category?: string | null;
  date?: string | null; // when the underlying event happened (not when ingested)
}

// Only recent events count. Anything older than this horizon is treated as stale
// news and excluded from the index and the active queue. A retention signal over
// a year old (a layoff that already happened, a closed acquisition) is history,
// not early warning, so it drops out. Fresh developments re-surface a firm.
export const FRESHNESS_MONTHS = 12;
const FRESHNESS_DAYS = FRESHNESS_MONTHS * 30.44;

// The "watch now" spotlight is tighter than the full queue: only items with
// activity in this window count as a current priority. Older-but-within-year
// items still live in the queue and on the profile, just not in the spotlight.
export const WATCH_DAYS = 120;

export type RiskLevel = "atrisk" | "elevated" | "watch" | "monitor" | "growth" | "stable";

export interface RiskResult {
  score: number; // 0-100
  level: RiskLevel;
}

// Retention-predictive weight per BREP category (0..1). Direct labor/ownership/
// footprint signals dominate; legal/environmental/regulatory noise is discounted.
const CATEGORY_WEIGHT: Record<string, number> = {
  Employment: 1.0,
  "Ownership / M&A": 0.95,
  "Real Estate": 0.85,
  "Expansion Plans": 0.8,
  "Revenue / Financial Health": 0.75,
  "Facilities / Capital Investment": 0.7,
  "Capital Investment": 0.55,
  "Leadership Stability": 0.5,
  "Supply Chain": 0.5,
  "Workforce Availability": 0.45,
  "Infrastructure Needs": 0.4,
  "Regulatory Issues": 0.3,
  "Employee Morale": 0.3,
  "Environmental / Safety": 0.25,
  "Legal / Litigation": 0.25,
};
function categoryWeight(category?: string | null): number {
  if (!category) return 0.4;
  return CATEGORY_WEIGHT[category] ?? 0.4;
}

function recencyWeight(iso?: string | null): number {
  if (!iso) return 0.6;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (Number.isNaN(days)) return 0.6;
  if (days <= 30) return 1;
  if (days <= 90) return 0.85;
  if (days <= 180) return 0.65;
  if (days <= 365) return 0.5;
  return 0.35;
}

// Larger employers carry more jobs, so a real risk at one weighs a bit more.
export function bandFactor(band?: string | null): number {
  switch ((band ?? "").trim()) {
    case "1,000+":
      return 1;
    case "500+":
      return 0.85;
    case "250+":
      return 0.7;
    case "100+":
      return 0.55;
    case "50+":
      return 0.45;
    default:
      return 0.6;
  }
}

export function computeRiskIndex(signals: RiskInput[], band?: string | null): RiskResult {
  if (!signals.length) return { score: 0, level: "stable" };

  let risk = 0;
  let growth = 0;
  for (const s of signals) {
    // Exclude stale events entirely (a layoff from 2+ years ago is old news).
    if (s.date) {
      const ageDays = (Date.now() - new Date(s.date).getTime()) / 86_400_000;
      if (!Number.isNaN(ageDays) && ageDays > FRESHNESS_DAYS) continue;
    }
    const p = Math.max(0, Math.min(100, s.priority || 0)) / 100;
    const tier = s.tier === "authoritative" ? 1 : 0.6;
    const cw = categoryWeight(s.category);
    const base = p * cw * tier * recencyWeight(s.date);
    if (s.signal_type === "risk") risk += base;
    else if (s.signal_type === "neutral") risk += base * 0.4;
    else if (s.signal_type === "growth") growth += base;
  }

  const net = risk - growth * 0.6;

  // Convex response: a single low-weight signal stays low, while corroborating
  // retention-relevant signals compound. Then a modest size tilt.
  let score = 0;
  if (net > 0) {
    const base = 100 * (1 - Math.exp(-net * 1.3));
    const bandAdj = 0.75 + 0.25 * bandFactor(band);
    score = base * bandAdj;
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  let level: RiskLevel;
  if (score >= 60) level = "atrisk";
  else if (score >= 40) level = "elevated";
  else if (score >= 20) level = "watch";
  else if (score > 0) level = "monitor";
  else if (risk <= 0.0001 && growth > 0) level = "growth";
  else level = "stable";

  return { score, level };
}

export function riskLevelLabel(level: RiskLevel): string {
  return level === "atrisk"
    ? "At risk"
    : level === "elevated"
    ? "Elevated"
    : level === "watch"
    ? "Watch"
    : level === "monitor"
    ? "Monitor"
    : level === "growth"
    ? "Growing"
    : "Stable";
}

// One-line, economist-grounded read of what a level means.
export function riskLevelRead(level: RiskLevel): string {
  switch (level) {
    case "atrisk":
      return "Strong or corroborated retention signals. Prioritize a proactive retention touch.";
    case "elevated":
      return "Elevated retention risk. Worth a check-in to understand what is happening.";
    case "watch":
      return "Some negative signals worth keeping an eye on, not yet a retention concern.";
    case "monitor":
      return "A minor or isolated signal. Monitoring, no action needed yet.";
    case "growth":
      return "Expansion signals. An opportunity to support, not a risk.";
    default:
      return "No material signals. Stable.";
  }
}

export type Trend = "up" | "down" | "flat" | "new";

export function trendArrow(current: number, previous: number | null | undefined): Trend {
  if (previous == null) return "new";
  const d = current - previous;
  if (d >= 5) return "up";
  if (d <= -5) return "down";
  return "flat";
}
