import type { SignalType } from "./types";

// Company retention-risk index: rolls a company's open signals into a single
// 0-100 score. Higher means more at-risk. Risk signals push the score up,
// growth signals pull it down, weighted by tier (authoritative > indicative),
// priority, recency, and the employer's size band (jobs at stake).

export interface RiskInput {
  signal_type: SignalType;
  tier: string;
  priority: number;
  scored_at?: string | null;
}

export type RiskLevel = "high" | "elevated" | "low" | "growth" | "none";

export interface RiskResult {
  score: number; // 0-100
  level: RiskLevel;
}

function recencyWeight(iso?: string | null): number {
  if (!iso) return 0.6;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (Number.isNaN(days)) return 0.6;
  if (days <= 30) return 1;
  if (days <= 90) return 0.8;
  if (days <= 180) return 0.6;
  return 0.45;
}

// Larger employers carry more jobs, so a real risk at one weighs more.
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
  if (!signals.length) return { score: 0, level: "none" };

  let risk = 0;
  let growth = 0;
  for (const s of signals) {
    const p = Math.max(0, Math.min(100, s.priority || 0)) / 100;
    const tier = s.tier === "authoritative" ? 1 : 0.6;
    const w = p * tier * recencyWeight(s.scored_at);
    if (s.signal_type === "risk") risk += w;
    else if (s.signal_type === "neutral") risk += w * 0.35;
    else if (s.signal_type === "growth") growth += w;
  }

  const net = risk - growth * 0.7;
  const bf = bandFactor(band);
  let score = 0;
  if (net > 0) {
    // Saturating curve so a pile of small signals cannot exceed a few big ones,
    // then scale by size band.
    const base = 100 * (1 - Math.exp(-net * 0.8));
    score = base * (0.6 + 0.4 * bf);
  }
  score = Math.round(Math.max(0, Math.min(100, score)));

  const level: RiskLevel =
    risk === 0 && growth > 0
      ? "growth"
      : score >= 66
      ? "high"
      : score >= 33
      ? "elevated"
      : score > 0
      ? "low"
      : "none";

  return { score, level };
}

export type Trend = "up" | "down" | "flat" | "new";

// Compare the current score to a prior snapshot to get a trend.
export function trendArrow(current: number, previous: number | null | undefined): Trend {
  if (previous == null) return "new";
  const d = current - previous;
  if (d >= 5) return "up";
  if (d <= -5) return "down";
  return "flat";
}
