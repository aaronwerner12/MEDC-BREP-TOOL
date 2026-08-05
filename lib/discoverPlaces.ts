import { readableType } from "./googlePlaces";

// Structured employer discovery via Google Places Text Search. Runs a set of
// employer-oriented category queries against McKinney and collects the distinct
// businesses Google returns, with a derived sector. Skewed toward substantial
// employers (offices, manufacturing, distribution, medical, financial) rather
// than every small storefront.
//
// Reuses the Places key (GOOGLE_PLACES_API_KEY or GOOGLE_KG_API_KEY if the same
// Cloud key has both APIs enabled). Skipped when neither is set.
const TEXTSEARCH = "https://maps.googleapis.com/maps/api/place/textsearch/json";

function apiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_KG_API_KEY || undefined;
}

// Category queries aimed at employers, not consumer storefronts.
const QUERIES = [
  "corporate headquarters in McKinney TX",
  "manufacturing company in McKinney TX",
  "distribution center in McKinney TX",
  "industrial company in McKinney TX",
  "technology company in McKinney TX",
  "logistics company in McKinney TX",
  "engineering firm in McKinney TX",
  "medical center in McKinney TX",
  "financial services in McKinney TX",
];

const MAX_RESULTS = 90;

interface PlaceResult {
  name?: string;
  formatted_address?: string;
  types?: string[];
  business_status?: string;
}

// Pure: turn a set of Text Search payloads into a deduped employer list. Only
// keeps results whose address is in McKinney. Exported for offline testing.
export function collectPlaces(pages: { results?: PlaceResult[] }[]): { name: string; sector: string | null }[] {
  const out = new Map<string, { name: string; sector: string | null }>();
  for (const page of pages) {
    for (const r of page.results ?? []) {
      const name = (r.name ?? "").trim();
      const addr = r.formatted_address ?? "";
      if (!name || !/mckinney/i.test(addr)) continue;
      if (r.business_status && r.business_status !== "OPERATIONAL") continue;
      const key = name.toLowerCase();
      if (out.has(key)) continue;
      out.set(key, { name, sector: readableType(r.types ?? []) || null });
    }
  }
  return [...out.values()];
}

export async function discoverPlacesEmployers(): Promise<{ name: string; sector: string | null }[]> {
  const key = apiKey();
  if (!key) return [];
  const pages: { results?: PlaceResult[] }[] = [];
  for (const q of QUERIES) {
    try {
      const res = await fetch(`${TEXTSEARCH}?query=${encodeURIComponent(q)}&region=us&key=${key}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      pages.push((await res.json()) as { results?: PlaceResult[] });
    } catch {
      // skip a failing query
    }
    if (collectPlaces(pages).length >= MAX_RESULTS) break;
  }
  return collectPlaces(pages).slice(0, MAX_RESULTS);
}
