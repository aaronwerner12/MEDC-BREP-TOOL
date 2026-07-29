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
const UA = "McKinney Signal Desk (awerner@visitmckinney.com)";
const WINDOW_DAYS = 30;
const TARGET_FORMS = new Set(["8-K", "10-K", "10-Q"]);
const MAX_PER_ENTITY = 5;

// Public watchlist entities and their SEC CIKs. `expect` is a lowercase
// substring verified against the name EDGAR returns, so a mistyped CIK yields
// no signals rather than data about the wrong company. Verify/extend on first
// live run.
interface PublicEntity {
  cik: string; // 10-digit, zero-padded
  expect: string;
}
const PUBLIC_ENTITIES: PublicEntity[] = [
  { cik: "0000320335", expect: "globe life" },
  { cik: "0000764038", expect: "southstate" }, // acquirer of Independent Financial
  { cik: "0001564618", expect: "independent bank group" },
  { cik: "0000101829", expect: "rtx" }, // RTX Corporation (Raytheon)
  { cik: "0001018724", expect: "amazon" },
  { cik: "0000920371", expect: "simpson" }, // Simpson Manufacturing
];

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function secEdgarSignals(_employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const out: NormalizedSignal[] = [];

  for (const ent of PUBLIC_ENTITIES) {
    try {
      const sub = await fetchSubmissions(ent.cik);
      // Guard: only trust the payload if the returned name matches expectation,
      // so a wrong CIK produces nothing instead of wrong-company signals.
      if (!(sub.name ?? "").toLowerCase().includes(ent.expect)) continue;
      out.push(...mapFilings(sub));
    } catch {
      // Skip an entity that errors; other entities still run.
    }
  }

  return out;
}
