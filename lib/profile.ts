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

export async function generateCompanyProfile(input: {
  name: string;
  sector: string | null;
  city?: string;
}): Promise<string> {
  const loc = input.city ?? "McKinney, Texas";
  const prompt = `Compile a short public business profile for "${input.name}"${
    input.sector ? ` (${input.sector})` : ""
  }, focusing on its presence in ${loc}. Use web search for current public information. Report ONLY facts supported by the sources you find and write "unknown" for anything you cannot verify. Use short labeled lines covering:
- What the company does
- Headquarters and primary location, plus any McKinney/Collin County site
- Approximate employee count (overall, and local if available)
- Key executives (CEO and other named leaders)
- Ownership, parent company, or stock ticker
Keep it under 150 words. Plain direct voice. Do not use em dashes. Do not invent numbers, names, or facts.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  return text.replace(/\s*—\s*/g, ", ");
}
