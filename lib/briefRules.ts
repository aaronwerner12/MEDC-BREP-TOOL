import { computeRiskIndex, riskLevelLabel, type RiskInput, type RiskLevel } from "./risk";
import type { EmployerBrief } from "./brief";

// Deterministic, rules-based employer briefing. Synthesizes the same four
// labeled fields the AI version returns (Overall read, Main driver, Recommended
// posture, Watch next) directly from the employer's own signals and the
// calibrated risk index. No model call, no tokens. Grounded by construction: it
// only ever restates the signals on record, so it cannot invent facts.

export interface RuleBriefSignal {
  signalType: "risk" | "growth" | "neutral";
  category: string;
  summary: string;
  tier: string;
  priority: number;
  date?: string;
}

// Recommended posture per calibrated risk level.
function postureFor(level: RiskLevel, hasGrowth: boolean): string {
  switch (level) {
    case "atrisk":
      return "Prioritize a retention visit. Confirm the authoritative signals and prepare support options before reaching out.";
    case "elevated":
      return "Schedule a proactive check-in. Confirm the drivers and watch for escalation.";
    case "watch":
      return "Keep on the active watch list. Confirm indicative items before any outreach.";
    case "growth":
      return "Engage on the expansion. Congratulate and ask about local hiring or facility plans.";
    case "monitor":
      return hasGrowth
        ? "Mostly positive. Stay in touch and note the growth signals."
        : "Routine monitoring. No action needed yet.";
    case "stable":
    default:
      return "Stable. Maintain the relationship and keep monitoring.";
  }
}

function trim(s: string, n = 180): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

// Build the structured brief from an employer's open signals.
export function buildRuleBrief(input: {
  name: string;
  band: string | null;
  signals: RuleBriefSignal[];
}): EmployerBrief {
  const sigs = input.signals;

  if (sigs.length === 0) {
    return {
      read: "Quiet",
      driver: "Nothing has surfaced yet.",
      posture: "Routine monitoring. No action needed yet.",
      watch: "layoffs, ownership changes, and facility moves",
    };
  }

  const riskInputs: RiskInput[] = sigs.map((s) => ({
    signal_type: s.signalType,
    tier: s.tier,
    priority: s.priority,
    category: s.category,
    date: s.date,
  }));
  const { level } = computeRiskIndex(riskInputs, input.band);

  const risks = sigs.filter((s) => s.signalType === "risk");
  const growth = sigs.filter((s) => s.signalType === "growth");
  const byPriority = (a: RuleBriefSignal, b: RuleBriefSignal) => b.priority - a.priority;

  // The driver is the most material open signal: a risk if any, else growth,
  // else the top neutral item.
  const driverSig =
    [...risks].sort(byPriority)[0] ??
    [...growth].sort(byPriority)[0] ??
    [...sigs].sort(byPriority)[0];
  const driver = driverSig ? `${driverSig.category}: ${trim(driverSig.summary)}` : "No dominant signal.";

  // Watch next: distinct categories of other open signals (not the driver),
  // falling back to the standing monitoring themes.
  const watchCats = Array.from(
    new Set(sigs.filter((s) => s.category && s.category !== driverSig?.category).map((s) => s.category))
  ).slice(0, 3);
  const watch = watchCats.length
    ? watchCats.join(", ")
    : "layoffs, ownership changes, and facility moves";

  return {
    read: riskLevelLabel(level),
    driver,
    posture: postureFor(level, growth.length > 0),
    watch,
  };
}

// Serialize to the stored JSON shape parseBrief() reads.
export function generateEmployerBriefRules(input: {
  name: string;
  band: string | null;
  signals: RuleBriefSignal[];
}): string {
  return JSON.stringify(buildRuleBrief(input));
}
