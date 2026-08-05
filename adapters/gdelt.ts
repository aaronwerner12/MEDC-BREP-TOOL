import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";
import { buildNewsSignal, mergeNews, MAX_ITEMS_PER_EMPLOYER, type NewsItem } from "../lib/newsShared";

// Free news feed via GDELT's DOC 2.0 API. Keyless, no tokens. GDELT indexes a
// broad set of outlets (trade press, local papers, blogs) that Google News can
// miss, so it complements the Google News source. Same materiality/signal logic
// as every other news source, so results cross-deduplicate by headline.
const ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const UA = "McKinney Business Retention and Expansion Monitor (awerner@visitmckinney.com)";
const FETCH_CONCURRENCY = 5;
const MAX_RECORDS = 20;

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string; // e.g. "20250728T120000Z"
  domain?: string;
  language?: string;
}

// GDELT seendate -> epoch ms. Handles the compact "YYYYMMDDThhmmssZ" form.
function parseSeenDate(s: string | undefined): number {
  if (!s) return NaN;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) {
    const t = new Date(s).getTime();
    return t;
  }
  const [, y, mo, d, h = "00", mi = "00", se = "00"] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
}

// Pure parser: a GDELT ArtList payload -> indicative signals for one employer.
// Exported for offline testing.
export function parseGdelt(json: { articles?: GdeltArticle[] }, emp: EmployerRow): NormalizedSignal[] {
  const arts = json.articles ?? [];
  const out: NormalizedSignal[] = [];
  for (const a of arts) {
    if (out.length >= MAX_ITEMS_PER_EMPLOYER) break;
    if (a.language && a.language.toLowerCase() !== "english") continue;
    const item: NewsItem = {
      headline: (a.title ?? "").trim(),
      url: a.url,
      publisher: a.domain,
      dateMs: parseSeenDate(a.seendate),
    };
    const sig = buildNewsSignal(emp, item);
    if (sig) out.push(sig);
  }
  return out;
}

async function fetchEmployerFeed(emp: EmployerRow): Promise<NormalizedSignal[]> {
  const query = `"${emp.name}" sourcecountry:US`;
  const url =
    `${ENDPOINT}?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&format=json&maxrecords=${MAX_RECORDS}&sort=DateDesc&timespan=4months`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`GDELT ${res.status} for ${emp.name}`);
  // GDELT occasionally returns HTML/empty on odd queries; guard the JSON parse.
  const text = await res.text();
  let json: { articles?: GdeltArticle[] };
  try {
    json = JSON.parse(text);
  } catch {
    return [];
  }
  return parseGdelt(json, emp);
}

export async function gdeltForEmployer(emp: EmployerRow): Promise<NormalizedSignal[]> {
  try {
    return await fetchEmployerFeed(emp);
  } catch {
    return [];
  }
}

export async function gdeltSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const targets = employers.filter((e) => e.active !== false);
  const out: NormalizedSignal[][] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const e = targets[next++];
      try {
        out.push(await fetchEmployerFeed(e));
      } catch {
        // skip a failing employer
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, worker));
  return mergeNews(out);
}
