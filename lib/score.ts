import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedSignal, ScoredSignal, SignalType } from "./types";
import { type EmployerRow, matchEmployer } from "./employers";
import { brepGuidance, normalizeCategory } from "./brep";

// Construct the client lazily on first use, not at import time, so a build can
// import routes that pull in the scorer without ANTHROPIC_API_KEY present.
let _anthropic: Anthropic | undefined;
function anthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return _anthropic;
}

// Haiku is cheap and fast enough for classification. Swap to a larger model
// for authoritative-but-legal items if you want extra care on the wording.
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM =
  "You are a business retention and expansion (BRE) analyst for the City of McKinney, Texas. " +
  "You classify local business signals so the team can triage them. Respond with ONLY a raw JSON object, no markdown.";

function extractJson(text: string): any {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error("No JSON in scorer response");
  return JSON.parse(text.slice(a, b + 1));
}

export async function scoreSignal(
  sig: NormalizedSignal,
  employers: EmployerRow[]
): Promise<ScoredSignal> {
  const match = matchEmployer(sig.companyName, employers);

  const prompt = `Source: ${sig.source} (tier: ${sig.tier})
Employer named in the signal: ${sig.companyName}
Signal:
"""${sig.observedText}"""

Classify this into exactly one BREP category from the list below, using its
healthy vs risk indicators to set signalType (a healthy sign -> "growth", a risk
indicator -> "risk", neither/unclear -> "neutral"):
${brepGuidance()}

Be conservative with "risk": reserve it for signals that plausibly threaten the
company's local jobs, investment, or continued McKinney presence (layoffs,
closures, an out-of-area acquisition, sustained financial decline, its facility
going up for lease/sale, a canceled expansion). Treat isolated, routine
negatives that rarely drive a company to shrink or leave (a single lawsuit, a
minor OSHA/EPA citation, ordinary regulatory friction, one bad review) as
"neutral" unless they clearly threaten operations. Set "priority" to reflect how
strongly the signal predicts an actual retention event, not just how negative it
sounds.

Return ONLY this JSON:
{"signalType":"risk"|"growth"|"neutral","category":"<exactly one category name from the list above>","priority":0-100,"summary":"one factual sentence","recommendedAction":"one specific BRE next step","talkingPoint":"outreach opener or empty string"}`;

  const res = await anthropicClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const p = extractJson(text);

  const signalType: SignalType = ["risk", "growth", "neutral"].includes(p.signalType)
    ? p.signalType
    : "neutral";

  return {
    ...sig,
    employerId: match?.id ?? null,
    signalType,
    category: normalizeCategory(p.category ?? ""),
    priority: Math.max(0, Math.min(100, Number(p.priority) || 0)),
    summary: p.summary ?? "",
    recommendedAction: p.recommendedAction ?? "",
    talkingPoint: p.talkingPoint ?? "",
  };
}
