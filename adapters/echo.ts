import type { NormalizedSignal } from "../lib/types";
import { type EmployerRow, matchEmployer } from "../lib/employers";

// EPA/OSHA ECHO (Enforcement and Compliance History Online) facilities in
// McKinney. A facility with a current violation / enforcement flag is an
// authoritative Environmental / Safety risk signal.
//
// NOTE: this session could not reach echodata.epa.gov to verify the exact
// service contract, so the fetch tolerates both known response shapes (inline
// Facilities array, or a QueryID that needs a second get_facility_info call)
// and field extraction is defensive across name/flag variants. Matching is
// restricted to watchlist employers, so a mis-mapped field yields no signal
// rather than a wrong or noisy one. Verify against a real pull via
// /api/cron/echo (it returns fetched vs matched counts).
const BASE = "https://echodata.epa.gov/echo/echo_rest_services";
const UA = "McKinney Signal Desk (awerner@visitmckinney.com)";

type Row = Record<string, unknown>;

const NAME_KEYS = ["facname", "fac_name", "cwpname", "name", "registryname"];
const CITY_KEYS = ["faccity", "fac_city", "city"];
const REGISTRY_KEYS = ["registryid", "registry_id", "fac_derived_reg", "sourceid"];
const VIO_FLAG_KEYS = ["currvioflag", "curr_vio_flag", "fac_curr_vio_flag"];
const QTRS_NC_KEYS = ["facqtrswithnc", "fac_qtrs_with_nc", "qtrs_with_nc"];
const HISTORY_KEYS = ["fac3yrcompliancehistory", "fac_3yr_compliance_history"];

function lc(row: Row): Record<string, string> {
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
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Pure mapping: keep only watchlist facilities with a current compliance
// concern, and map to NormalizedSignals. Exported for offline testing.
export function mapEchoFacilities(facilities: Row[], employers: EmployerRow[]): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];

  for (const raw of facilities) {
    const r = lc(raw);
    const name = pick(r, NAME_KEYS);
    if (!name) continue;

    const match = matchEmployer(name, employers);
    if (!match) continue; // watchlist employers only

    const vioFlag = pick(r, VIO_FLAG_KEYS);
    const qtrsNC = Number(pick(r, QTRS_NC_KEYS)) || 0;
    const inViolation = /^(y|yes|1|true)$/i.test(vioFlag) || qtrsNC > 0;
    if (!inViolation) continue; // clean facilities are the resting state, not a signal

    const city = pick(r, CITY_KEYS) || "McKinney";
    const registry = pick(r, REGISTRY_KEYS);
    const history = pick(r, HISTORY_KEYS);

    out.push({
      source: "epa_echo",
      tier: "authoritative",
      externalId: `echo:${registry || slug(name)}`,
      companyName: name,
      sourceUrl: registry
        ? `https://echo.epa.gov/detailed-facility-report?fid=${registry}`
        : "https://echo.epa.gov/",
      observedText:
        `EPA/OSHA ECHO shows a current compliance concern for ${name} in ${city}, TX` +
        (vioFlag ? ` (violation flag: ${vioFlag}` : " (") +
        (qtrsNC ? `${vioFlag ? ", " : ""}${qtrsNC} recent quarters in non-compliance` : "") +
        ")." +
        (history ? ` 3-year history: ${history}.` : "") +
        " Environmental / Safety compliance issue.",
      raw,
    });
  }

  return out;
}

function extractFacilities(json: unknown): Row[] {
  const j = json as Record<string, unknown>;
  const results = (j?.Results ?? j) as Record<string, unknown>;
  if (Array.isArray(results?.Facilities)) return results.Facilities as Row[];
  if (Array.isArray(j?.Facilities)) return j.Facilities as Row[];
  if (Array.isArray(results)) return results as Row[];
  return [];
}

async function fetchFacilities(): Promise<Row[]> {
  const headers = { "User-Agent": UA, Accept: "application/json" };
  const params = new URLSearchParams({ output: "JSON", responseset: "500", p_st: "TX", p_city: "MCKINNEY" });
  const res = await fetch(`${BASE}.get_facilities?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`ECHO ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;

  let facs = extractFacilities(json);
  if (facs.length === 0) {
    // Some ECHO services return only a QueryID; fetch rows with a follow-on call.
    const results = (json?.Results ?? json) as Record<string, unknown>;
    const qid = (results?.QueryID ?? json?.QueryID) as string | undefined;
    if (qid) {
      const p2 = new URLSearchParams({ output: "JSON", responseset: "500", qid: String(qid) });
      const r2 = await fetch(`${BASE}.get_facility_info?${p2.toString()}`, { headers });
      if (r2.ok) facs = extractFacilities(await r2.json());
    }
  }
  return facs;
}

export async function echoSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const facilities = await fetchFacilities();
  return mapEchoFacilities(facilities, employers);
}
