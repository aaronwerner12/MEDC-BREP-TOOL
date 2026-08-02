import type { PartialProfile } from "./companyProfile";

// Google Knowledge Graph Search API: a broad entity index that covers many
// businesses Wikidata misses. Gives a short "what they do" description, the
// official website, and the canonical name. Thin on employees/executives.
//
// Requires a free Google Cloud API key (GOOGLE_KG_API_KEY). Skipped without it.
const ENDPOINT = "https://kgsearch.googleapis.com/v1/entities:search";

interface KgResult {
  name?: string;
  description?: string;
  url?: string;
  "@type"?: string[];
  detailedDescription?: { articleBody?: string; url?: string };
}

function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  const stop = t.indexOf(". ");
  return stop > 40 ? t.slice(0, stop + 1) : t;
}

// Choose the best-scoring result whose name resembles the query.
export function parseGoogleKg(
  json: { itemListElement?: { result?: KgResult; resultScore?: number }[] },
  name: string
): PartialProfile | null {
  const items = json.itemListElement ?? [];
  const lc = name.toLowerCase().trim();
  let best: KgResult | undefined;
  let bestScore = -1;
  for (const it of items) {
    const r = it.result;
    if (!r) continue;
    const label = (r.name ?? "").toLowerCase();
    let score = Number(it.resultScore ?? 0);
    if (label === lc) score += 1e6;
    else if (label.startsWith(lc) || lc.startsWith(label)) score += 1e5;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  if (!best) return null;

  const p: PartialProfile = {};
  const desc = (best.description ?? "").trim();
  const detailed = best.detailedDescription?.articleBody
    ? firstSentence(best.detailedDescription.articleBody)
    : "";
  const whatTheyDo = desc || detailed;
  if (whatTheyDo) p.whatTheyDo = whatTheyDo;

  const website = best.url || best.detailedDescription?.url || "";
  if (website) p.website = website;
  if (best.name) p.officialName = best.name;

  return Object.keys(p).length ? p : null;
}

export async function fetchGoogleKg(name: string): Promise<PartialProfile | null> {
  const key = process.env.GOOGLE_KG_API_KEY;
  if (!key) return null;
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(name)}` +
    `&types=Corporation&types=Organization&limit=5&indent=false&key=${key}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    itemListElement?: { result?: KgResult; resultScore?: number }[];
  };
  return parseGoogleKg(json, name);
}
