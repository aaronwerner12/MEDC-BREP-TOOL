import Anthropic from "@anthropic-ai/sdk";
import type { NormalizedSignal, ScoredSignal, SignalType } from "./types";
import { type EmployerRow, matchEmployer } from "./employers";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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

Return ONLY this JSON:
{"signalType":"risk"|"growth"|"neutral","category":"short label","priority":0-100,"summary":"one factual sentence","recommendedAction":"one specific BRE next step","talkingPoint":"outreach opener or empty string"}`;

  const res = await anthropic.messages.create({
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
    category: p.category ?? "Signal",
    priority: Math.max(0, Math.min(100, Number(p.priority) || 0)),
    summary: p.summary ?? "",
    recommendedAction: p.recommendedAction ?? "",
    talkingPoint: p.talkingPoint ?? "",
  };
}
