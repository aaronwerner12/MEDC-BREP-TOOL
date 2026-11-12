import type { EmployerRow } from "../lib/employers";
import type { NormalizedSignal } from "../lib/types";

// Official/open-data JSON feeds configured by MEDC. No guessing at portal
// dataset IDs: an unconfigured feed reports an actionable error instead of
// silently returning invented or unrelated records.
export const LOCAL_SOURCES = [
  "mckinney_permits", "job_postings", "texas_sales_tax",
  "collin_employment", "property_records",
] as const;
export type LocalSource = (typeof LOCAL_SOURCES)[number];

const CONFIG: Record<LocalSource, { env: string; label: string; tier: "authoritative" | "indicative" }> = {
  mckinney_permits: { env: "BREP_PERMITS_JSON_URL", label: "McKinney building permits", tier: "authoritative" },
  job_postings: { env: "BREP_JOBS_JSON_URL", label: "Job postings", tier: "indicative" },
  texas_sales_tax: { env: "BREP_SALES_TAX_JSON_URL", label: "Texas sales tax", tier: "authoritative" },
  collin_employment: { env: "BREP_EMPLOYMENT_JSON_URL", label: "Collin County employment", tier: "authoritative" },
  property_records: { env: "BREP_PROPERTY_JSON_URL", label: "Property records", tier: "authoritative" },
};

type Row = Record<string, unknown>;
function pick(row: Row, names: string[]): string {
  for (const key of names) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}
function dateOnly(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : undefined;
}
function isMcKinney(row: Row): boolean {
  const city = pick(row, ["city", "City", "site_city", "municipality"]);
  return /mckinney/i.test(city);
}
export async function localSignals(source: LocalSource, employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const config = CONFIG[source];
  const endpoint = process.env[config.env];
  if (!endpoint) throw new Error(`${config.label} is not connected. Set ${config.env} to a verified public JSON feed.`);
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error(`${config.env} must be an HTTPS URL`);
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`${config.label}: HTTP ${response.status}`);
  const body: unknown = await response.json();
  const rows: unknown = Array.isArray(body) ? body : body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : null;
  if (!Array.isArray(rows)) throw new Error(`${config.label}: expected a JSON array or {data: [...]}`);
  const out: NormalizedSignal[] = [];
  for (const item of rows.slice(0, 1000)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Row;
    const name = pick(row, ["company", "company_name", "business", "business_name", "employer", "employer_name", "applicant", "owner"]);
    if (!name) continue;
    const matched = employers.some((e) => [e.name, ...e.aliases].some((n) => n.toLowerCase() === name.toLowerCase()));
    // Do not attribute city/county-wide metrics to a specific business.
    if (!matched && !isMcKinney(row)) continue;
    const id = pick(row, ["id", "record_id", "permit_number", "case_number", "parcel_id", "posting_id"]);
    const date = dateOnly(pick(row, ["date", "issue_date", "filed_date", "posted_date", "effective_date"]));
    const description = pick(row, ["description", "title", "work_description", "project_description", "activity"]);
    if (!id && !date) continue; // no stable identity: cannot deduplicate safely
    out.push({
      source, tier: config.tier,
      externalId: id || `${name.toLowerCase()}:${date}:${description.slice(0, 80)}`,
      companyName: name,
      observedText: `${config.label}: ${name}${description ? ` - ${description}` : ""}${date ? ` (${date})` : ""}.`,
      eventDate: date, sourceUrl: endpoint, raw: row,
    });
  }
  return out;
}
