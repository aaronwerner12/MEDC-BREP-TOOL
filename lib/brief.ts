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

export async function generateEmployerBrief(input: {
  name: string;
  band: string | null;
  sector: string | null;
  signals: BriefSignal[];
}): Promise<string> {
  const facts = input.signals.length
    ? input.signals
        .map((s) => `- [${s.signalType}] ${s.category}: ${s.summary} (${s.tier})`)
        .join("\n")
    : "(no signals on record yet)";

  const prompt = `Employer: ${input.name}${input.band ? ` (${input.band} employees)` : ""}${
    input.sector ? `, ${input.sector}` : ""
  }.
Signals currently on record:
${facts}

Write a 2 to 3 sentence business-health briefing for the City of McKinney economic development team about THIS employer only. Use ONLY the facts above. Do not invent events, numbers, acquisitions, leadership changes, or any detail not listed. State the overall read (at risk, stable, growing, or quiet), the main driver behind it, and the recommended posture for the team. If there are no signals, say nothing has surfaced yet and note we are monitoring for layoffs, ownership changes, and facility moves. Plain direct voice. Do not use em dashes.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      "You are a business retention and expansion analyst for the City of McKinney, Texas. Write grounded, factual briefings and never invent facts not provided.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  // Safeguard the no-em-dash house style even if the model slips.
  return text.replace(/\s*—\s*/g, ", ");
}
