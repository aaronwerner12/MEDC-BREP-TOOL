import type { NormalizedSignal, ScoredSignal, SignalType } from "./types";
import { type EmployerRow, matchEmployer } from "./employers";
import { normalizeCategory } from "./brep";

// Deterministic, rules-based scorer. No API key, no tokens, no network. Each
// adapter already encodes what a signal means (a WARN filing is a layoff, the
// USASpending raw.kind says risk vs. growth, an SEC 8-K carries item codes that
// name the event), so classification is a lookup, not a judgment call.
//
// This keeps to the project's guardrail: the scorer classifies what the feed
// reported, it never invents. `summary` is the adapter's own factual sentence;
// recommendedAction is a fixed BRE next step per signal kind; talkingPoint is
// left empty (we do not fabricate quotes).

interface Classification {
  signalType: SignalType;
  category: string;
  priority: number; // 0-100
  recommendedAction: string;
}

const clampPriority = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Pull an affected-employee count out of a WARN row (raw) or its text.
function warnAffectedCount(sig: NormalizedSignal): number {
  const raw = (sig.raw ?? {}) as Record<string, unknown>;
  const keys = [
    "total_layoff_number",
    "number_of_employees_affected",
    "affected_employees",
    "total_affected",
  ];
  for (const k of Object.keys(raw)) {
    if (keys.includes(k.toLowerCase())) {
      const n = Number(String(raw[k]).replace(/[^0-9.]/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const m = sig.observedText.match(/(\d[\d,]*)\s+affected/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// SEC 8-K item codes, ranked by materiality. The most material item present on
// a filing drives its classification.
interface ItemRule {
  code: string;
  signalType: SignalType;
  category: string;
  priority: number;
  action: string;
  severity: number; // higher wins when a filing carries several items
}
const SEC_ITEM_RULES: ItemRule[] = [
  { code: "2.05", signalType: "risk", category: "Employment", priority: 72, severity: 9, action: "Review the exit/disposal filing and assess local headcount exposure." },
  { code: "3.01", signalType: "risk", category: "Revenue / Financial Health", priority: 70, severity: 8, action: "Delisting risk. Review the filing and watch financial stability." },
  { code: "5.01", signalType: "risk", category: "Ownership / M&A", priority: 70, severity: 8, action: "Change in control. Track for HQ or facility consolidation." },
  { code: "2.06", signalType: "risk", category: "Revenue / Financial Health", priority: 64, severity: 7, action: "Material impairment. Review and watch for follow-on cuts." },
  { code: "2.01", signalType: "neutral", category: "Ownership / M&A", priority: 48, severity: 6, action: "Acquisition or disposition. Confirm what it means for the local site." },
  { code: "1.02", signalType: "neutral", category: "Supply Chain", priority: 45, severity: 5, action: "Material agreement ended. Confirm whether a key customer or supplier is affected." },
  { code: "5.02", signalType: "neutral", category: "Leadership Stability", priority: 40, severity: 4, action: "Leadership change. Note it and watch for a strategy shift." },
  { code: "1.01", signalType: "neutral", category: "Supply Chain", priority: 35, severity: 3, action: "New material agreement. Confirm whether it is a local positive." },
  { code: "2.02", signalType: "neutral", category: "Revenue / Financial Health", priority: 30, severity: 2, action: "Earnings disclosure. Skim for local implications." },
];

function classifySec(sig: NormalizedSignal): Classification {
  const raw = (sig.raw ?? {}) as { form?: string; items?: string };
  const form = String(raw.form ?? "");
  const items = String(raw.items ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Pick the most material item code present on the filing.
  let best: ItemRule | undefined;
  for (const code of items) {
    const rule = SEC_ITEM_RULES.find((r) => r.code === code);
    if (rule && (!best || rule.severity > best.severity)) best = rule;
  }
  if (best) {
    return {
      signalType: best.signalType,
      category: best.category,
      priority: best.priority,
      recommendedAction: best.action,
    };
  }
  // A 10-K / 10-Q or an 8-K with no material item: routine periodic disclosure.
  const isPeriodic = /10-K|10-Q/i.test(form);
  return {
    signalType: "neutral",
    category: "Revenue / Financial Health",
    priority: isPeriodic ? 26 : 22,
    recommendedAction: "Routine SEC filing. Monitor; no action needed yet.",
  };
}

function classify(sig: NormalizedSignal): Classification {
  switch (sig.source) {
    case "twc_warn": {
      // A WARN filing is a legally required advance notice of a mass layoff or
      // closure: always a risk. Priority scales with the affected count.
      const affected = warnAffectedCount(sig);
      const priority = affected >= 100 ? 90 : affected >= 50 ? 82 : affected >= 25 ? 76 : 72;
      return {
        signalType: "risk",
        category: "Employment",
        priority,
        recommendedAction:
          "Confirm scope with the employer and offer rapid-response workforce support.",
      };
    }

    case "usaspending": {
      const raw = (sig.raw ?? {}) as { kind?: string; expiringShare?: number };
      if (raw.kind === "portfolio-new") {
        return {
          signalType: "growth",
          category: "Expansion Plans",
          priority: 55,
          recommendedAction: "Reach out to congratulate and ask about local hiring plans.",
        };
      }
      // portfolio-expiry (or any other): a material share of the federal book
      // expiring soon is a watch-level risk, scaled by the expiring share.
      const share = Number(raw.expiringShare) || 0;
      return {
        signalType: "risk",
        category: "Revenue / Financial Health",
        priority: clampPriority(45 + share * 45),
        recommendedAction:
          "Confirm recompete / follow-on status before assuming any contraction.",
      };
    }

    case "epa_echo": {
      // Per the calibrated model, a single compliance flag is not a retention
      // risk on its own: surface it as a watch item, not a red flag.
      return {
        signalType: "neutral",
        category: "Environmental / Safety",
        priority: 25,
        recommendedAction: "Context only. Verify severity before any outreach.",
      };
    }

    case "sec_edgar":
      return classifySec(sig);

    case "news": {
      // News is indicative: always a watch item a human confirms, never an
      // auto-flagged risk from a headline alone. The adapter's material filter
      // tags a BREP category and a lean; we use those for display and to nudge
      // priority so a layoff headline sorts above a routine mention.
      const raw = (sig.raw ?? {}) as { newsCategory?: string; lean?: string };
      const category = raw.newsCategory || "Signal";
      const priority = raw.lean === "risk" ? 42 : raw.lean === "growth" ? 38 : 34;
      return {
        signalType: "neutral",
        category,
        priority,
        recommendedAction: "Indicative news. Confirm the story before any outreach.",
      };
    }

    default:
      return {
        signalType: "neutral",
        category: "Signal",
        priority: 25,
        recommendedAction: "Review and confirm.",
      };
  }
}

// Trim the adapter's factual observed text into a one-line summary.
function toSummary(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= 240) return t;
  const cut = t.slice(0, 237);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (lastStop > 120 ? cut.slice(0, lastStop + 1) : cut) + "…";
}

// Score a normalized signal with rules only. Synchronous, deterministic, free.
export function scoreSignalRules(
  sig: NormalizedSignal,
  employers: EmployerRow[]
): ScoredSignal {
  const match = matchEmployer(sig.companyName, employers);
  const c = classify(sig);
  return {
    ...sig,
    employerId: match?.id ?? null,
    signalType: c.signalType,
    category: normalizeCategory(c.category),
    priority: clampPriority(c.priority),
    summary: toSummary(sig.observedText),
    recommendedAction: c.recommendedAction,
    talkingPoint: "",
  };
}
