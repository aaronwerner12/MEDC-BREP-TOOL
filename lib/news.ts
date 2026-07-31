import Anthropic from "@anthropic-ai/sdk";

// Web news scan for a company. Uses Anthropic's server-side web_search tool so
// results are grounded in real, cited articles. Returns structured items; the
// caller turns them into indicative signals (a human confirms before action).
//
// Requires the web search tool to be enabled on the Anthropic account; if it is
// not, the API call throws and the caller degrades gracefully.
const MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export interface NewsItem {
  headline: string;
  summary: string;
  url: string;
  date: string; // YYYY-MM-DD or ""
  type: "risk" | "growth" | "neutral";
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

export async function fetchCompanyNews(input: {
  name: string;
  sector: string | null;
}): Promise<NewsItem[]> {
  const prompt = `Find up to 5 significant, recent business news items from roughly the past 2 years about "${input.name}"${
    input.sector ? ` (${input.sector})` : ""
  }, relevant to its business health or its McKinney / Collin County, Texas operations. Focus on layoffs, expansions, new facilities, acquisitions or mergers, leadership changes, financial results, and legal or regulatory matters. Use web search.

Report ONLY items you can back with a real source URL. Do not invent headlines, numbers, dates, or URLs. Prefer the most recent and most material items.

Return ONLY a JSON array (no other prose) of objects with these fields:
[{"headline": "...", "summary": "one factual sentence", "url": "https://...", "date": "YYYY-MM-DD or empty", "type": "risk" | "growth" | "neutral"}]
If there is nothing significant, return [].`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as never],
    system:
      "You are a business retention and expansion analyst for the City of McKinney, Texas. You find real, cited business news and never invent facts or sources.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n");

  const raw = extractJsonArray(text);
  const items: NewsItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const headline = String(o.headline ?? "").trim();
    const url = String(o.url ?? "").trim();
    if (!headline || !url) continue; // require a real headline + source
    const type = o.type === "risk" || o.type === "growth" ? o.type : "neutral";
    items.push({
      headline,
      summary: String(o.summary ?? "").trim(),
      url,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(o.date ?? "")) ? String(o.date) : "",
      type,
    });
  }
  return items.slice(0, 5);
}
