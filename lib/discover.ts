import Anthropic from "@anthropic-ai/sdk";

// Web-discover major employers in McKinney, TX (Collin County). Uses Anthropic's
// server-side web_search tool so the list is grounded in real sources. The
// prompt forbids inventing organizations. Results are still treated as
// needs-verification by the caller.
const MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export interface DiscoveredEmployer {
  name: string;
  sector: string;
}

function extractJsonArray(text: string): unknown[] {
  const a = text.indexOf("[");
  const b = text.lastIndexOf("]");
  if (a === -1 || b <= a) return [];
  try {
    const parsed = JSON.parse(text.slice(a, b + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function discoverMcKinneyEmployers(): Promise<DiscoveredEmployer[]> {
  const prompt = `List major employers and notable corporations based in, or with a significant operating presence in, McKinney, Texas (Collin County). Use web search (city major-employer lists, chamber of commerce, county top-employer reports, news).

Include only real organizations you can verify actually operate in McKinney. Do not invent names. Aim for up to 30 significant employers across sectors (manufacturing, healthcare, finance, tech, retail, logistics, education, government).

Return ONLY a JSON array (no other prose) of objects: [{"name": "...", "sector": "short label"}].`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 } as never],
    system:
      "You are an economic development analyst for the City of McKinney, Texas. You compile real, verifiable employer lists from public sources and never invent organizations.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

  const raw = extractJsonArray(text);
  const out: DiscoveredEmployer[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, sector: String(o.sector ?? "").trim() });
  }
  return out.slice(0, 40);
}
