import type { NormalizedSignal } from "../lib/types";
import { type EmployerRow, matchEmployer } from "../lib/employers";

// Texas WARN (Worker Adjustment and Retraining Notification) layoff notices.
// The highest-value risk feed: a WARN filing is a legally required, dated
// advance notice of a mass layoff or plant closure, so it is authoritative.
//
// Source: the Texas Open Data Portal (Socrata) dataset 8w53-c4f6, which the
// Texas Workforce Commission publishes as "current calendar year Texas plant
// closure and layoff notices issued under the WARN Act." The Socrata resource
// endpoint returns clean JSON, so there is no HTML/Excel scraping.
//
//   https://data.texas.gov/dataset/Worker-Adjustment-and-Retraining-Notification-WARN/8w53-c4f6
//
// The dataset holds only the current calendar year (a few hundred rows), so we
// fetch the whole set and filter in code rather than pushing a SoQL $where that
// would 400 if a column were ever renamed on the portal. Field extraction is
// likewise defensive across the known label variants, so a minor portal rename
// degrades gracefully instead of silently dropping every notice.
const DATASET_ID = "8w53-c4f6";
const RESOURCE_ENDPOINT = `https://data.texas.gov/resource/${DATASET_ID}.json`;
const DATASET_URL = `https://data.texas.gov/dataset/Worker-Adjustment-and-Retraining-Notification-WARN/${DATASET_ID}`;

type Row = Record<string, unknown>;

// Confirmed API field names on 8w53-c4f6, each followed by fallbacks in case a
// portal refresh relabels a column.
const COMPANY_KEYS = ["job_site_name", "company_name", "company", "employer_name", "name"];
const CITY_KEYS = ["city_name", "city", "job_site_city"];
const COUNTY_KEYS = ["county_name", "county"];
const COUNT_KEYS = [
  "total_layoff_number",
  "number_of_employees_affected",
  "affected_employees",
  "total_affected",
];
const NOTICE_DATE_KEYS = ["notice_date", "wfdd_received_date", "received_date", "date_received"];
const EFFECTIVE_DATE_KEYS = ["layoff_date", "effective_date"];

// Lowercase every key once so extraction is case-insensitive, and coerce values
// to trimmed strings.
function normalizeKeys(row: Row): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    out[k.toLowerCase()] = typeof v === "string" ? v.trim() : String(v);
  }
  return out;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

// Socrata floating timestamps arrive as e.g. "2026-03-15T00:00:00.000"; keep the
// date part only.
const fmtDate = (s: string) => (s ? s.slice(0, 10) : "");

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Pure mapping: filter WARN rows to McKinney / Collin County or a watchlist
// employer match, and map each to a NormalizedSignal. Exported so it can be
// tested offline against sample rows without hitting the network.
export function mapWarnNotices(rows: Row[], employers: EmployerRow[]): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];

  for (const raw of rows) {
    const r = normalizeKeys(raw);
    const company = pick(r, COMPANY_KEYS);
    if (!company) continue;

    const city = pick(r, CITY_KEYS);
    const county = pick(r, COUNTY_KEYS);
    const count = pick(r, COUNT_KEYS);
    const noticeDate = fmtDate(pick(r, NOTICE_DATE_KEYS));
    const effectiveDate = fmtDate(pick(r, EFFECTIVE_DATE_KEYS));

    // Keep a notice only if it is in our footprint or names a watchlist employer.
    const inMcKinney = /mckinney/i.test(city);
    const inCollin = /collin/i.test(county);
    const match = matchEmployer(company, employers);
    if (!inMcKinney && !inCollin && !match) continue;

    const location =
      [city, county && `${county} County`].filter(Boolean).join(", ") || "Texas";
    const affected = count ? `${count} affected` : "affected count not stated";
    const effective = effectiveDate
      ? `effective ${effectiveDate}`
      : "effective date not stated";
    const noticed = noticeDate ? ` Notice dated ${noticeDate}.` : "";

    out.push({
      source: "twc_warn",
      tier: "authoritative",
      // Stable dedupe key: no native notice id exists on the dataset, so compose
      // one from employer + notice date + city.
      externalId: `${slug(company)}:${noticeDate || effectiveDate || "nodate"}:${slug(city)}`,
      companyName: company,
      sourceUrl: DATASET_URL,
      observedText:
        `Texas WARN layoff notice: ${company} in ${location}, ${affected}, ${effective}.` +
        `${noticed} Source: Texas Workforce Commission WARN listing.`,
      raw,
    });
  }

  return out;
}

async function fetchWarnRows(): Promise<Row[]> {
  // Current-calendar-year dataset is small; 5000 is a comfortable ceiling.
  const url = `${RESOURCE_ENDPOINT}?$limit=5000`;
  const headers: Record<string, string> = {
    "User-Agent": "McKinneySignalDesk/1.0 (+https://visitmckinney.com)",
    Accept: "application/json",
  };
  // Optional: raise Socrata's anonymous rate limit if a token is configured.
  const token = process.env.SOCRATA_APP_TOKEN;
  if (token) headers["X-App-Token"] = token;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TWC WARN ${res.status}`);
  return (await res.json()) as Row[];
}

export async function twcWarnSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const rows = await fetchWarnRows();
  return mapWarnNotices(rows, employers);
}
