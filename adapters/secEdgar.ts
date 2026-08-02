import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";

// SEC EDGAR filings for the public watchlist employers. Recent 8-K / 10-K / 10-Q
// filings are event- and period-driven material disclosures, so they are
// authoritative. The scorer classifies each into a BREP category (Revenue /
// Financial Health, Ownership / M&A, Leadership Stability, ...).
//
// EDGAR's submissions API is public and keyless but requires a descriptive
// User-Agent. https://data.sec.gov/submissions/CIK##########.json returns the
// company's recent filings as parallel arrays.
//
// Coverage is dynamic: rather than a hardcoded CIK list, we resolve every
// watchlist employer against SEC's own ticker/name map (company_tickers.json),
// so any public company on the watchlist is covered automatically. Private firms
// simply do not match and produce nothing. A curated seed keeps the known
// tricky ones (e.g. the SouthState acquirer) precise.
const UA = "McKinney Signal Desk (awerner@visitmckinney.com)";
const WINDOW_DAYS = 30;
const TARGET_FORMS = new Set(["8-K", "10-K", "10-Q"]);
const MAX_PER_ENTITY = 5;
const MAX_ENTITIES = 25;
const RESOLVE_CONCURRENCY = 6;

interface PublicEntity {
  cik: string; // 10-digit, zero-padded
  expect: string; // lowercase substring guard against a wrong CIK ("" = skip)
}

// Curated seed: watchlist-relevant CIKs that name-matching would miss or get
// wrong (the SouthState acquirer, the exact Independent Bank Group entity).
const SEED_ENTITIES: PublicEntity[] = [
  { cik: "0000320335", expect: "globe life" },
  { cik: "0000764038", expect: "southstate" }, // acquirer of Independent Financial
  { cik: "0001564618", expect: "independent bank group" },
  { cik: "0000101829", expect: "rtx" }, // RTX Corporation (Raytheon)
  { cik: "0001018724", expect: "amazon" },
  { cik: "0000920371", expect: "simpson" }, // Simpson Manufacturing
];

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

const pad10 = (n: number | string) => String(n).replace(/\D/g, "").padStart(10, "0");

// Normalize a company name for matching: lowercase, drop punctuation and common
// corporate suffixes, collapse whitespace.
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|llc|lp|llp|plc|ltd|limited|group|holdings?|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Resolve one employer to a SEC CIK using a ticker index and a normalized-title
// list. Prefers an exact ticker match (via aliases), then an exact normalized
// title, then a clear prefix match. Pure and exported for offline testing.
export function resolveCik(
  employer: EmployerRow,
  byTicker: Map<string, TickerEntry>,
  entries: { norm: string; e: TickerEntry }[]
): string | null {
  // Ticker match against the name/aliases (most precise).
  const tickers = [employer.name, ...(employer.aliases ?? [])]
    .map((t) => t.toUpperCase().replace(/[^A-Z0-9]/g, ""))
    .filter((t) => t.length >= 1 && t.length <= 5);
  for (const t of tickers) {
    const hit = byTicker.get(t);
    if (hit) return pad10(hit.cik_str);
  }

  // Name match. Require a reasonably specific employer name to avoid generic
  // false positives.
  const candidates = [employer.name, ...(employer.aliases ?? [])].map(normName).filter((n) => n.length >= 5);
  for (const cand of candidates) {
    const exact = entries.find((x) => x.norm === cand);
    if (exact) return pad10(exact.e.cik_str);
  }
  for (const cand of candidates) {
    if (cand.split(" ").length < 2 && cand.length < 6) continue; // too generic for prefix
    const prefix = entries.find((x) => x.norm === cand || x.norm.startsWith(cand + " "));
    if (prefix) return pad10(prefix.e.cik_str);
  }
  return null;
}

// Build lookup structures from SEC's company_tickers.json payload.
export function buildTickerIndex(raw: Record<string, TickerEntry>): {
  byTicker: Map<string, TickerEntry>;
  entries: { norm: string; e: TickerEntry }[];
} {
  const byTicker = new Map<string, TickerEntry>();
  const entries: { norm: string; e: TickerEntry }[] = [];
  for (const key of Object.keys(raw)) {
    const e = raw[key];
    if (!e || !e.title || e.cik_str == null) continue;
    const tk = (e.ticker ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (tk && !byTicker.has(tk)) byTicker.set(tk, e);
    entries.push({ norm: normName(e.title), e });
  }
  return { byTicker, entries };
}

async function fetchTickerMap(): Promise<Record<string, TickerEntry> | null> {
  try {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, TickerEntry>;
  } catch {
    return null;
  }
}

// Common 8-K item codes, so the observed text tells the scorer what happened.
const ITEM_LABELS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy a Listing Rule",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure or Appointment of Directors or Officers",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
};

const daysSince = (d: string) => (Date.now() - new Date(d).getTime()) / 86_400_000;

interface Submissions {
  name?: string;
  cik?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
      items?: string[];
    };
  };
}

// Pure mapper: turn a submissions payload into NormalizedSignals. Exported for
// offline testing.
export function mapFilings(sub: Submissions, windowDays = WINDOW_DAYS): NormalizedSignal[] {
  const name = sub.name ?? "Unknown filer";
  const cikInt = sub.cik ? String(parseInt(sub.cik, 10)) : "";
  const r = sub.filings?.recent;
  if (!r || !r.accessionNumber) return [];

  const out: NormalizedSignal[] = [];
  const n = r.accessionNumber.length;

  for (let i = 0; i < n && out.length < MAX_PER_ENTITY; i++) {
    const form = r.form?.[i] ?? "";
    const base = form.split("/")[0];
    if (!TARGET_FORMS.has(base)) continue;

    const filingDate = r.filingDate?.[i] ?? "";
    if (!filingDate || daysSince(filingDate) > windowDays || daysSince(filingDate) < 0) continue;

    const accession = r.accessionNumber[i];
    const primaryDoc = r.primaryDocument?.[i] ?? "";
    const desc = r.primaryDocDescription?.[i] ?? "";
    const itemsRaw = r.items?.[i] ?? "";

    const itemText = itemsRaw
      ? " Items: " +
        itemsRaw
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean)
          .map((c) => `${c} (${ITEM_LABELS[c] ?? "see filing"})`)
          .join("; ") +
        "."
      : "";

    const accNoDashes = accession.replace(/-/g, "");
    const sourceUrl =
      cikInt && primaryDoc
        ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDashes}/${primaryDoc}`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sub.cik}&type=&dateb=&owner=include&count=40`;

    out.push({
      source: "sec_edgar",
      tier: "authoritative",
      externalId: accession, // unique per filing
      companyName: name,
      sourceUrl,
      eventDate: filingDate || undefined,
      observedText:
        `${name} filed SEC Form ${form} on ${filingDate}.` +
        itemText +
        (desc ? ` Document: ${desc}.` : ""),
      raw: { name, cik: sub.cik, form, filingDate, accession, items: itemsRaw, desc },
    });
  }

  return out;
}

async function fetchSubmissions(cik: string): Promise<Submissions> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`EDGAR ${res.status} for CIK ${cik}`);
  return (await res.json()) as Submissions;
}

export async function secEdgarSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  // Resolve the watchlist's public companies to CIKs via SEC's ticker map, and
  // merge the curated seed. Deduped by CIK.
  const entities = new Map<string, PublicEntity>();
  for (const s of SEED_ENTITIES) entities.set(s.cik, s);

  const raw = await fetchTickerMap();
  if (raw) {
    const { byTicker, entries } = buildTickerIndex(raw);
    for (const emp of employers) {
      if (emp.active === false) continue;
      const cik = resolveCik(emp, byTicker, entries);
      // Resolved from SEC's own map, so trust it (no expect guard needed).
      if (cik && !entities.has(cik)) entities.set(cik, { cik, expect: "" });
    }
  }

  const list = Array.from(entities.values()).slice(0, MAX_ENTITIES);
  const out: NormalizedSignal[] = [];
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const ent = list[next++];
      try {
        const sub = await fetchSubmissions(ent.cik);
        // Guard curated entries against a wrong CIK; dynamic ones use "" (skip).
        if (ent.expect && !(sub.name ?? "").toLowerCase().includes(ent.expect)) continue;
        out.push(...mapFilings(sub));
      } catch {
        // Skip an entity that errors; others still run.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, list.length) }, worker));

  return out;
}
