import type { PartialProfile } from "./companyProfile";

// OpenCorporates: the open legal-entity registry. Best free source for small
// private firms, since it carries the official/legal name, registered address,
// officers, incorporation date, and status even when Wikidata has nothing.
//
// Requires a free API token (OPENCORPORATES_API_TOKEN). Without it the source is
// skipped, so the profile chain still runs on the other sources.
const BASE = "https://api.opencorporates.com/v0.4";
const UA = "McKinney Watchtower/1.0 (awerner@visitmckinney.com)";
// Bias the search to Texas, where the McKinney private firms are registered.
const JURISDICTION = "us_tx";

interface OCCompany {
  name?: string;
  company_number?: string;
  jurisdiction_code?: string;
  company_type?: string;
  current_status?: string;
  incorporation_date?: string;
  registered_address_in_full?: string;
  inactive?: boolean;
}
interface OCOfficer {
  name?: string;
  position?: string;
  inactive?: boolean;
}

const stripSuffix = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|lp|llp|plc|group|holdings?)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/\b(Llc|Lp|Llp|Plc)\b/g, (m) => m.toUpperCase());

// Choose the best company match: closest name, preferring active entities.
export function pickCompany(companies: { company?: OCCompany }[], name: string): OCCompany | null {
  const target = stripSuffix(name);
  let best: OCCompany | null = null;
  let bestScore = -1;
  for (const wrap of companies) {
    const c = wrap.company;
    if (!c || !c.name) continue;
    const cand = stripSuffix(c.name);
    let score = 0;
    if (cand === target) score += 6;
    else if (cand.startsWith(target) || target.startsWith(cand)) score += 3;
    else if (cand.includes(target) || target.includes(cand)) score += 1;
    if (!c.inactive && !/dissolved|inactive|withdrawn|terminated/i.test(c.current_status ?? "")) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // Require at least a partial name match so we do not attach a random entity.
  return bestScore >= 1 ? best : null;
}

// Build a PartialProfile from a company record and its (optional) officer list.
export function buildOpenCorporatesProfile(c: OCCompany, officers: OCOfficer[]): PartialProfile {
  const p: PartialProfile = {};
  const addr = (c.registered_address_in_full ?? "").replace(/\s*\n\s*/g, ", ").trim();
  if (addr) {
    if (/mckinney/i.test(addr)) p.localPresence = addr;
    else p.headquarters = addr;
  }

  const named = officers
    .filter((o) => o.name && !o.inactive)
    .slice(0, 3)
    .map((o) => (o.position ? `${titleCase(o.name!)} (${o.position})` : titleCase(o.name!)));
  if (named.length) p.executives = named.join(", ");

  const parts = [c.company_type, c.current_status].filter(Boolean).map((s) => String(s));
  if (parts.length) p.ownership = parts.join(", ");

  if (c.name) p.officialName = titleCase(c.name);
  return Object.keys(p).length ? p : {};
}

export async function fetchOpenCorporates(name: string): Promise<PartialProfile | null> {
  const token = process.env.OPENCORPORATES_API_TOKEN;
  if (!token) return null;

  const searchUrl = `${BASE}/companies/search?q=${encodeURIComponent(
    name
  )}&jurisdiction_code=${JURISDICTION}&order=score&per_page=10&api_token=${token}`;
  const res = await fetch(searchUrl, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: { companies?: { company?: OCCompany }[] } };
  const best = pickCompany(json.results?.companies ?? [], name);
  if (!best || !best.company_number || !best.jurisdiction_code) return null;

  // Fetch the company detail for officers (best-effort).
  let officers: OCOfficer[] = [];
  try {
    const durl = `${BASE}/companies/${best.jurisdiction_code}/${best.company_number}?api_token=${token}`;
    const dres = await fetch(durl, { headers: { "User-Agent": UA, Accept: "application/json" } });
    if (dres.ok) {
      const dj = (await dres.json()) as {
        results?: { company?: { officers?: { officer?: OCOfficer }[] } };
      };
      officers = (dj.results?.company?.officers ?? [])
        .map((o) => o.officer)
        .filter((o): o is OCOfficer => !!o);
    }
  } catch {
    // no officers is fine
  }

  const p = buildOpenCorporatesProfile(best, officers);
  return Object.keys(p).length ? p : null;
}
