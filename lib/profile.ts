import Anthropic from "@anthropic-ai/sdk";

// Web-sourced company profile. Uses Anthropic's server-side web_search tool so
// the facts are grounded in real, cited sources rather than model memory. The
// prompt requires "unknown" for anything unverified and forbids speculation.
//
// Requires the web search tool to be enabled on the Anthropic account; if it is
// not, the API call throws and the caller surfaces a graceful error.
const MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try {
    const parsed = JSON.parse(text.slice(a, b + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function generateCompanyProfile(input: {
  name: string;
  sector: string | null;
  city?: string;
}): Promise<{ profile: string; officialName: string | null }> {
  const loc = input.city ?? "McKinney, Texas";
  const prompt = `Compile a short public business profile for "${input.name}"${
    input.sector ? ` (${input.sector})` : ""
  }, focusing on its presence in ${loc}. Use web search for current public information. Report ONLY facts supported by the sources you find and write "unknown" for anything you cannot verify.

Return ONLY a JSON object:
{
  "officialName": "the company's official / legal / commonly-used business name, or empty string if you cannot confirm it differs from what was given",
  "profile": "short labeled lines covering: what the company does; headquarters and primary location plus any McKinney/Collin County site; approximate employee count (overall and local if available); key executives (CEO and other named leaders); ownership, parent company, or stock ticker"
}
Keep the profile under 150 words, plain direct voice, no em dashes. Do not invent numbers, names, or facts.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1200,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  const json = extractJson(text);
  if (json) {
    const profile = String(json.profile ?? "").trim().replace(/\s*—\s*/g, ", ");
    const officialRaw = String(json.officialName ?? "").trim();
    const officialName = officialRaw && officialRaw.length <= 120 ? officialRaw : null;
    return { profile: profile || text.replace(/\s*—\s*/g, ", "), officialName };
  }
  // Fallback: treat the whole response as the profile.
  return { profile: text.replace(/\s*—\s*/g, ", "), officialName: null };
}
