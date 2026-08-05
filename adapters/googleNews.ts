import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";
import { buildNewsSignal, mergeNews, MAX_ITEMS_PER_EMPLOYER, type NewsItem } from "../lib/newsShared";

// Free news feed via Google News RSS. No API key, no per-search fee, no tokens.
// Google News exposes a search RSS endpoint that returns recent articles for a
// query as clean XML. We parse each item into a NewsItem and hand it to the
// shared materiality/signal logic in lib/newsShared, so all news sources behave
// the same and cross-deduplicate.
const ENDPOINT = "https://news.google.com/rss/search";
const UA = "McKinney Business Retention and Expansion Monitor (awerner@visitmckinney.com)";
const FETCH_CONCURRENCY = 6;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  const inner = m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  return decodeEntities(inner);
}

// Pure parser: Google News RSS document -> indicative signals for one employer.
// Exported for offline testing.
export function parseGoogleNews(xml: string, emp: EmployerRow): NormalizedSignal[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const out: NormalizedSignal[] = [];
  for (const block of items) {
    if (out.length >= MAX_ITEMS_PER_EMPLOYER) break;
    const rawTitle = tag(block, "title");
    if (!rawTitle) continue;
    const link = tag(block, "link");
    const publisher = tag(block, "source") || "";
    // Google News titles are "Headline - Publisher"; strip the trailing source.
    let headline = rawTitle;
    if (publisher && headline.endsWith(` - ${publisher}`)) {
      headline = headline.slice(0, -(publisher.length + 3)).trim();
    } else {
      headline = headline.replace(/\s-\s[^-]+$/, "").trim() || rawTitle;
    }
    const pub = tag(block, "pubDate");
    const item: NewsItem = {
      headline,
      url: link || undefined,
      publisher,
      dateMs: pub ? new Date(pub).getTime() : NaN,
    };
    const sig = buildNewsSignal(emp, item);
    if (sig) out.push(sig);
  }
  return out;
}

async function fetchEmployerFeed(emp: EmployerRow): Promise<NormalizedSignal[]> {
  const q = `"${emp.name}"`;
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
  });
  if (!res.ok) throw new Error(`Google News ${res.status} for ${emp.name}`);
  return parseGoogleNews(await res.text(), emp);
}

export async function googleNewsForEmployer(emp: EmployerRow): Promise<NormalizedSignal[]> {
  try {
    return await fetchEmployerFeed(emp);
  } catch {
    return [];
  }
}

export async function googleNewsSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
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
