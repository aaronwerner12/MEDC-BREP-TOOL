// Structured employer discovery from the Texas Comptroller's Active Franchise
// Tax Permit Holders dataset on the Texas Open Data Portal (Socrata resource
// 9cir-efmm), the authoritative registry of entities set up for franchise tax.
// Keyless (an optional SOCRATA_APP_TOKEN raises the anonymous rate limit).
//
// The registry is exhaustive, so it includes thousands of tiny shell / rental
// LLCs alongside real employers. To keep the directory to substantial firms, we
// filter to employer-heavy NAICS sectors and skip real estate, retail, food,
// and personal-services noise. Everything still lands flagged for review.
//
// https://data.texas.gov/dataset/Active-Franchise-Tax-Permit-Holders/9cir-efmm
const RESOURCE = "https://data.texas.gov/resource/9cir-efmm.json";
const CITY = "MCKINNEY";
const FETCH_LIMIT = 5000;
const MAX_RESULTS = 150;

// Employer-heavy NAICS 2-digit sectors to keep, mapped to a readable label.
// Excludes 44/45 retail, 53 real estate (the shell-LLC noise), 72 food/lodging,
// 81 personal services, 92 public admin, 11 agriculture.
const NAICS_SECTORS: Record<string, string> = {
  "22": "Utilities",
  "23": "Construction",
  "31": "Manufacturing",
  "32": "Manufacturing",
  "33": "Manufacturing",
  "42": "Wholesale",
  "48": "Transportation & Warehousing",
  "49": "Transportation & Warehousing",
  "51": "Information",
  "52": "Finance & Insurance",
  "54": "Professional Services",
  "55": "Company Management",
  "56": "Administrative & Support",
  "62": "Health Care",
};

type Row = Record<string, unknown>;

const NAME_KEYS = ["taxpayer_name", "name"];
const CITY_KEYS = ["taxpayer_city", "city"];
const NAICS_KEYS = ["naics_code", "naics"];

function normalizeKeys(row: Row): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
    out[k.toLowerCase()] = typeof v === "string" ? v.trim() : String(v);
  }
  return out;
}
function pick(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) if (row[k] && row[k].trim()) return row[k].trim();
  return "";
}

// Franchise taxpayer names are uppercase legal names. Title-case them and tidy
// the common entity suffixes so they read as business names.
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/\b(Llc|Lp|Llp|Plc|Pllc|Lc)\b/g, (m) => m.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

// Pure: map raw Socrata rows to a deduped employer list, keeping only McKinney
// entities in employer-heavy NAICS sectors. Exported for offline testing.
export function mapComptroller(rows: Row[]): { name: string; sector: string | null }[] {
  const out = new Map<string, { name: string; sector: string | null }>();
  for (const raw of rows) {
    if (out.size >= MAX_RESULTS) break;
    const r = normalizeKeys(raw);
    const rawName = pick(r, NAME_KEYS);
    if (!rawName) continue;

    const city = pick(r, CITY_KEYS);
    if (city && !/mckinney/i.test(city)) continue;

    const naics = pick(r, NAICS_KEYS).replace(/[^0-9]/g, "");
    const sector = naics ? NAICS_SECTORS[naics.slice(0, 2)] : undefined;
    // Keep only employer-heavy sectors; skip unknown/NAICS-less to cut noise.
    if (!sector) continue;

    const name = titleCase(rawName);
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, { name, sector });
  }
  return [...out.values()];
}

async function fetchRows(): Promise<Row[]> {
  const headers: Record<string, string> = {
    "User-Agent": "McKinney Watchtower/1.0 (awerner@visitmckinney.com)",
    Accept: "application/json",
  };
  const token = process.env.SOCRATA_APP_TOKEN;
  if (token) headers["X-App-Token"] = token;

  const select = "$select=taxpayer_name,taxpayer_city,naics_code";
  // Prefer a case-insensitive city filter; fall back to a plain equality filter
  // if the SoQL is rejected (e.g. a column rename), then give up rather than
  // pulling the whole multi-million-row dataset.
  const attempts = [
    `${RESOURCE}?$where=upper(taxpayer_city)='${CITY}'&${select}&$limit=${FETCH_LIMIT}`,
    `${RESOURCE}?taxpayer_city=${CITY}&$limit=${FETCH_LIMIT}`,
  ];
  for (const url of attempts) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) return (await res.json()) as Row[];
    } catch {
      // try the next form
    }
  }
  return [];
}

export async function discoverComptrollerEmployers(): Promise<{ name: string; sector: string | null }[]> {
  const rows = await fetchRows();
  return mapComptroller(rows);
}
