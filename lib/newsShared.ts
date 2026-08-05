import type { NormalizedSignal } from "./types";
import type { EmployerRow } from "./employers";

// Shared news logic for every news source (Google News RSS, GDELT). One place
// defines what counts as a material headline and how a headline becomes an
// indicative signal, so sources stay consistent and cross-dedupe: the external
// id is derived from the employer + a headline slug, so the same story found by
// two sources collapses to one row.

// Only surface reasonably recent coverage.
export const MAX_AGE_DAYS = 120;
// Keep the queue focused: at most this many material items per employer.
export const MAX_ITEMS_PER_EMPLOYER = 3;

interface Theme {
  category: string;
  lean: "risk" | "growth" | "neutral";
  terms: RegExp;
}

// Materiality: a headline must touch one of these retention/expansion themes to
// be worth surfacing, so news is a signal, not a clipping service. The lean is
// used for display and priority only, never to auto-flag risk.
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

export function themeFor(headline: string): Theme | null {
  for (const t of THEMES) if (t.terms.test(headline)) return t;
  return null;
}

export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

export interface NewsItem {
  headline: string;
  url?: string;
  publisher?: string;
  dateMs: number;
}

// Turn one news item into an indicative signal, or null if it is not recent or
// not material. Shared by every source so behavior and dedupe are consistent.
export function buildNewsSignal(emp: EmployerRow, item: NewsItem): NormalizedSignal | null {
  const headline = (item.headline ?? "").trim();
  if (!headline) return null;
  if (Number.isNaN(item.dateMs) || (Date.now() - item.dateMs) / 86_400_000 > MAX_AGE_DAYS) return null;
  const theme = themeFor(headline);
  if (!theme) return null;

  const eventDate = new Date(item.dateMs).toISOString().slice(0, 10);
  const src = item.publisher ? ` ${item.publisher},` : "";
  return {
    source: "news",
    tier: "indicative",
    externalId: `news:${emp.id}:${slug(headline)}`,
    companyName: emp.name,
    sourceUrl: item.url || undefined,
    eventDate,
    observedText:
      `News on ${emp.name}: "${headline}".${src} ${eventDate}. ` +
      `Indicative, confirm before outreach.`,
    raw: {
      news: true,
      headline,
      publisher: item.publisher ?? "",
      employerId: emp.id,
      newsCategory: theme.category,
      lean: theme.lean,
    },
  };
}

// Merge signals from multiple news sources, de-duplicating by external id and
// capping per employer.
export function mergeNews(lists: NormalizedSignal[][]): NormalizedSignal[] {
  const byId = new Map<string, NormalizedSignal>();
  const perEmployer = new Map<number, number>();
  for (const list of lists) {
    for (const s of list) {
      if (byId.has(s.externalId)) continue;
      const empId = (s.raw as { employerId?: number })?.employerId ?? -1;
      const count = perEmployer.get(empId) ?? 0;
      if (count >= MAX_ITEMS_PER_EMPLOYER) continue;
      byId.set(s.externalId, s);
      perEmployer.set(empId, count + 1);
    }
  }
  return [...byId.values()];
}
