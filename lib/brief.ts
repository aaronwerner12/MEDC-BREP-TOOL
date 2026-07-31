import Anthropic from "@anthropic-ai/sdk";

// Grounded employer briefing. Uses ONLY the employer's own signals and facts;
// the prompt forbids inventing events, numbers, or names. Haiku is fine here
// (internal UI copy, not a public document).
const MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export interface BriefSignal {
  signalType: string;
  category: string;
  summary: string;
  tier: string;
}

// Structured, labeled briefing fields. Stored as JSON in employers.brief so the
// employer page renders a clean labeled list, matching the company profile.
export interface EmployerBrief {
  read: string;
  driver: string;
  posture: string;
  watch: string;
}

const BRIEF_FIELDS: { key: keyof EmployerBrief; label: string }[] = [
  { key: "read", label: "Overall read" },
  { key: "driver", label: "Main driver" },
  { key: "posture", label: "Recommended posture" },
  { key: "watch", label: "Watch next" },
];

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  const candidate = text.slice(a, b + 1);
  const attempts = [candidate, candidate.replace(/[\r\n\t]+/g, " ")];
  for (const c of attempts) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try the next form
    }
  }
  return null;
}

function clean(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/^[\s;,]+/, "")
    .trim();
}

// Parse the stored brief column into structured fields. Handles both the new
// JSON shape and older plain-text briefs (rendered as a single paragraph).
export function parseBrief(
  raw: string | null
): { fields: { label: string; value: string }[]; text: string | null } {
  if (!raw) return { fields: [], text: null };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const fields = BRIEF_FIELDS.map((f) => ({ label: f.label, value: clean(obj[f.key]) })).filter(
        (f) => f.value && f.value.toLowerCase() !== "unknown"
      );
      if (fields.length > 0) return { fields, text: null };
    } catch {
      // fall through to plain text
    }
  }
  return { fields: [], text: trimmed };
}

export async function generateEmployerBrief(input: {
  name: string;
  band: string | null;
  sector: string | null;
  signals: BriefSignal[];
}): Promise<string> {
  const facts = input.signals.length
    ? input.signals.map((s) => `- [${s.signalType}] ${s.category}: ${s.summary} (${s.tier})`).join("\n")
    : "(no signals on record yet)";

  const prompt = `Employer: ${input.name}${input.band ? ` (${input.band} employees)` : ""}${
    input.sector ? `, ${input.sector}` : ""
  }.
Signals currently on record:
${facts}

Write a grounded business-health briefing for the City of McKinney economic development team about THIS employer only. Use ONLY the facts above. Do not invent events, numbers, acquisitions, leadership changes, or any detail not listed.

Return ONLY a single JSON object and nothing else. No preamble, no explanation before it, no notes after it. Each value must be plain text on ONE line with no line breaks inside it.

{
  "read": "one of: At risk, Stable, Growing, or Quiet",
  "driver": "the main signal or reason behind that read, in one sentence",
  "posture": "the recommended posture for the team, in one sentence",
  "watch": "what to monitor next, in one short phrase"
}

If there are no signals, set read to "Quiet", driver to "Nothing has surfaced yet.", posture to a monitoring stance, and watch to "layoffs, ownership changes, and facility moves". Keep each value short (under 30 words), plain direct voice, no em dashes. Do not add commentary outside the JSON.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 500,
    system:
      "You are a business retention and expansion analyst for the City of McKinney, Texas. Write grounded, factual briefings and never invent facts not provided. Respond with only the requested JSON.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  const json = extractJson(text);
  if (json) {
    const brief: EmployerBrief = {
      read: clean(json.read),
      driver: clean(json.driver),
      posture: clean(json.posture),
      watch: clean(json.watch),
    };
    const anyField = Object.values(brief).some((v) => v && v.toLowerCase() !== "unknown");
    if (anyField) return JSON.stringify(brief);
  }
  // Fallback: store the response as plain text (safeguards the no-em-dash style).
  return text.replace(/\s*—\s*/g, ", ");
}
