import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";

// Free news feed via Google News RSS. No API key, no per-search fee, no tokens.
// Google News exposes a search RSS endpoint that returns recent articles for a
// query as clean XML (title, link, publish date, publisher). We query each
// watchlist employer by name, keep only recent items that look materially
// relevant to retention/expansion, and hand them to the rules scorer as
// indicative signals (a human confirms before any outreach).
//
// This keeps to the guardrail: the feed reports real published headlines it
// actually returned; it never invents a story.

const ENDPOINT = "https://news.google.com/rss/search";
const UA = "McKinney Watchtower (awerner@visitmckinney.com)";

// Only surface reasonably recent coverage.
const MAX_AGE_DAYS = 120;
// Keep the queue focused: at most this many material items per employer per run.
const MAX_ITEMS_PER_EMPLOYER = 3;
// Bounded fan-out so a single pull stays within the serverless time budget.
const FETCH_CONCURRENCY = 6;

// Materiality: a headline must touch one of these retention/expansion themes to
// be worth surfacing, so the feed is a signal, not a clipping service. Each
// theme maps to a BREP category and a lean (does it read risk, growth, or
// neither) that the scorer uses for display only, never to auto-flag risk.
interface Theme {
  category: string;
  lean: "risk" | "growth" | "neutral";
  terms: RegExp;
}
const THEMES: Theme[] = [
  {
    category: "Employment",
    lean: "risk",
    terms: /\b(layoff|layoffs|lay off|job cuts?|cut jobs|workforce reduction|furlough|plant closure|closing (its|the) plant|shut(ting)? down|downsiz\w*|WARN notice)\b/i,
  },
  {
    category: "Expansion Plans",
    lean: "growth",
    terms: /\b(expand\w*|expansion|new facility|new plant|new headquarters|breaks? ground|groundbreaking|hiring \d|adding \d+ jobs|new jobs|invest\w* \$?\d|relocat\w* to)\b/i,
  },
  {
    category: "Ownership / M&A",
    lean: "neutral",
    terms: /\b(acqui\w+|acquisition|merg\w+|buyout|takeover|to be acquired|sells? to|sold to|private equity|go(es|ing) private|spin[- ]?off)\b/i,
  },
  {
    category: "Revenue / Financial Health",
    lean: "risk",
    terms: /\b(bankrupt\w*|chapter 11|default|restructur\w*|impairment|profit warning|misses? estimates|revenue (fell|drops?|declin\w*)|guidance cut|writedown|write-down)\b/i,
  },
  {
    category: "Leadership Stability",
    lean: "neutral",
    terms: /\b(ceo|cfo|coo|president|chief executive)\b.*\b(steps? down|resign\w*|departs?|retires?|named|appoint\w*|to lead)\b/i,
  },
  {
    category: "Real Estate",
    lean: "neutral",
    terms: /\b(headquarters|hq)\b.*\b(move|moves|moving|relocat\w*)\b|\b(for lease|for sale|sublease|vacates?|consolidat\w* (its )?(offices?|facilities))\b/i,
  },
  {
    category: "Legal / Litigation",
    lean: "neutral",
    terms: /\b(lawsuit|sued|settlement|class action|indict\w*|investigation|fined?)\b/i,
  },
];

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

// Decode the handful of XML/HTML entities Google News emits.
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

// Classify a headline by the first theme it matches (themes are ordered by
// importance, so the most material wins).
function themeFor(headline: string): Theme | null {
  for (const t of THEMES) if (t.terms.test(headline)) return t;
  return null;
}

// Pure parser: turn a Google News RSS document into NormalizedSignals for one
// employer. Exported so it can be tested offline against a sample feed.
export function parseGoogleNews(xml: string, emp: EmployerRow): NormalizedSignal[] {
  const displayName = emp.name;
  const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const out: NormalizedSignal[] = [];

  for (const block of items) {
    if (out.length >= MAX_ITEMS_PER_EMPLOYER) break;

    const rawTitle = tag(block, "title");
    if (!rawTitle) continue;
    const link = tag(block, "link");
    const guid = tag(block, "guid");
    const pub = tag(block, "pubDate");
    const publisher = tag(block, "source") || "";

    // Google News titles are "Headline - Publisher"; strip the trailing source.
    let headline = rawTitle;
    if (publisher && headline.endsWith(` - ${publisher}`)) {
      headline = headline.slice(0, -(publisher.length + 3)).trim();
    } else {
      headline = headline.replace(/\s-\s[^-]+$/, "").trim() || rawTitle;
    }

    // Recency filter.
    const t = pub ? new Date(pub).getTime() : NaN;
    if (Number.isNaN(t) || (Date.now() - t) / 86_400_000 > MAX_AGE_DAYS) continue;

    // Materiality filter: skip mere mentions.
    const theme = themeFor(headline);
    if (!theme) continue;

    const eventDate = new Date(t).toISOString().slice(0, 10);
    const src = publisher ? ` ${publisher},` : "";
    out.push({
      source: "news",
      tier: "indicative",
      externalId: `news:${emp.id}:${slug(guid || link || headline)}`,
      companyName: displayName,
      sourceUrl: link || undefined,
      eventDate,
      observedText:
        `News on ${displayName}: "${headline}".${src} ${eventDate}. ` +
        `Indicative, confirm before outreach.`,
      raw: {
        news: true,
        headline,
        publisher,
        pubDate: pub,
        employerId: emp.id,
        newsCategory: theme.category,
        lean: theme.lean,
      },
    });
  }

  return out;
}

async function fetchEmployerFeed(emp: EmployerRow): Promise<NormalizedSignal[]> {
  // Query the employer by its display name in quotes for precision.
  const q = `"${emp.name}"`;
  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" } });
  if (!res.ok) throw new Error(`Google News ${res.status} for ${emp.name}`);
  const xml = await res.text();
  return parseGoogleNews(xml, emp);
}

// Single-employer scan, used by the on-demand "Recent news" button. Free.
export async function googleNewsForEmployer(emp: EmployerRow): Promise<NormalizedSignal[]> {
  try {
    return await fetchEmployerFeed(emp);
  } catch {
    return [];
  }
}

// Pipeline feed: scan every active watchlist employer for material recent news,
// with bounded concurrency. One employer failing never aborts the rest.
export async function googleNewsSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const targets = employers.filter((e) => e.active !== false);
  const out: NormalizedSignal[] = [];
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const e = targets[next++];
      try {
        out.push(...(await fetchEmployerFeed(e)));
      } catch {
        // skip a failing employer
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, targets.length) }, worker));
  return out;
}
