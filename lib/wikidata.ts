import type { CompanyProfile } from "./profile";

// Free, keyless company firmographics from Wikidata. No API key, no tokens.
// Two hops, both public: wbsearchentities to resolve a name to an entity id,
// then one SPARQL query to pull the resolved fields (headquarters, employee
// count, CEO, parent company, industry, stock listing) with labels in a single
// request. Best coverage for the notable employers; thin for small private
// firms, in which case we return null and the caller can fall back to AI.
//
// Guardrail: we report only what Wikidata actually holds. Anything missing is
// left "unknown" rather than guessed.

const WD_API = "https://www.wikidata.org/w/api.php";
const WD_SPARQL = "https://query.wikidata.org/sparql";
const UA = "McKinney Watchtower/1.0 (awerner@visitmckinney.com)";

interface SearchHit {
  id: string;
  label: string;
  description?: string;
}

// Words that suggest a search hit is an organization, used to prefer a company
// over a same-named person, place, or song.
const COMPANYISH =
  /\b(compan|corporation|\bcorp\b|\binc\b|manufactur|business|enterprise|bank|retail|firm|brand|maker|producer|supplier|holdings?|group|industr|multinational|conglomerate|subsidiary|insurer|insurance|distributor)\b/i;

async function searchEntity(name: string): Promise<SearchHit[]> {
  const url = `${WD_API}?action=wbsearchentities&search=${encodeURIComponent(
    name
  )}&language=en&uselang=en&type=item&limit=7&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Wikidata search ${res.status}`);
  const j = (await res.json()) as { search?: { id: string; label?: string; description?: string }[] };
  return (j.search ?? []).map((h) => ({ id: h.id, label: h.label ?? "", description: h.description }));
}

// Rank candidates: exact/prefix label match and a company-like description win.
function pickCandidate(name: string, hits: SearchHit[]): SearchHit | null {
  if (!hits.length) return null;
  const lc = name.toLowerCase().trim();
  const scored = hits
    .map((h, i) => {
      let s = (hits.length - i) * 0.1; // small nod to search rank
      const label = (h.label ?? "").toLowerCase();
      if (label === lc) s += 5;
      else if (label.startsWith(lc) || lc.startsWith(label)) s += 2;
      if (h.description && COMPANYISH.test(h.description)) s += 3;
      return { h, s };
    })
    .sort((a, b) => b.s - a.s);
  return scored[0].h;
}

function sparql(qid: string): string {
  return `SELECT ?desc ?hqLabel ?countryLabel ?employees ?empYear ?ceoLabel ?parentLabel ?industryLabel ?ticker ?exchangeLabel ?inception WHERE {
  BIND(wd:${qid} AS ?c)
  OPTIONAL { ?c schema:description ?desc . FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?c wdt:P159 ?hq . OPTIONAL { ?hq wdt:P17 ?country . } }
  OPTIONAL { ?c p:P1128 ?es . ?es ps:P1128 ?employees . OPTIONAL { ?es pq:P585 ?empDate . BIND(YEAR(?empDate) AS ?empYear) } }
  OPTIONAL { ?c wdt:P169 ?ceo . }
  OPTIONAL { ?c wdt:P749 ?parent . }
  OPTIONAL { ?c wdt:P452 ?industry . }
  OPTIONAL { ?c p:P414 ?exs . ?exs ps:P414 ?exchange . OPTIONAL { ?exs pq:P249 ?ticker . } }
  OPTIONAL { ?c wdt:P571 ?inception . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" . }
}`;
}

interface Binding {
  [k: string]: { value: string } | undefined;
}

const val = (b: Binding, k: string) => b[k]?.value?.trim() ?? "";

function fmtNumber(n: string): string {
  const num = Number(n.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(num) || num <= 0) return n;
  return Math.round(num).toLocaleString("en-US");
}

// Reduce the SPARQL cross-product of rows into a single set of fields.
function reduceBindings(rows: Binding[]): {
  desc: string;
  hq: string;
  country: string;
  employees: string;
  empYear: string;
  ceos: string[];
  parent: string;
  industries: string[];
  ticker: string;
  exchange: string;
  inception: string;
} {
  const out = {
    desc: "",
    hq: "",
    country: "",
    employees: "",
    empYear: "",
    ceos: [] as string[],
    parent: "",
    industries: [] as string[],
    ticker: "",
    exchange: "",
    inception: "",
  };
  let bestYear = -1;
  for (const b of rows) {
    out.desc ||= val(b, "desc");
    out.hq ||= val(b, "hqLabel");
    out.country ||= val(b, "countryLabel");
    out.parent ||= val(b, "parentLabel");
    out.ticker ||= val(b, "ticker");
    out.exchange ||= val(b, "exchangeLabel");
    out.inception ||= val(b, "inception");

    const ceo = val(b, "ceoLabel");
    if (ceo && !out.ceos.includes(ceo) && !/^Q\d+$/.test(ceo)) out.ceos.push(ceo);
    const ind = val(b, "industryLabel");
    if (ind && !out.industries.includes(ind) && !/^Q\d+$/.test(ind)) out.industries.push(ind);

    // Most recent employee count wins.
    const emp = val(b, "employees");
    const yr = Number(val(b, "empYear")) || 0;
    if (emp && (yr > bestYear || (bestYear < 0 && !out.employees))) {
      out.employees = emp;
      out.empYear = val(b, "empYear");
      if (yr) bestYear = yr;
    }
  }
  return out;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Fetch a free firmographic profile for a company name. Returns null if no
// confident company match exists in Wikidata.
export async function fetchWikidataProfile(input: {
  name: string;
}): Promise<{ profile: CompanyProfile; officialName: string | null } | null> {
  let hits: SearchHit[];
  try {
    hits = await searchEntity(input.name);
  } catch {
    return null;
  }
  const cand = pickCandidate(input.name, hits);
  if (!cand) return null;

  let rows: Binding[];
  try {
    const res = await fetch(`${WD_SPARQL}?format=json&query=${encodeURIComponent(sparql(cand.id))}`, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { results?: { bindings?: Binding[] } };
    rows = j.results?.bindings ?? [];
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const r = reduceBindings(rows);

  // Require at least one real company property, otherwise the match was likely a
  // person/place, not a business.
  const isCompany = !!(r.hq || r.employees || r.ceos.length || r.parent || r.industries.length || r.exchange);
  if (!isCompany) return null;

  const whatTheyDo =
    (r.desc && cap(r.desc)) ||
    (r.industries.length ? `${cap(r.industries.join(", "))} company` : "") ||
    "unknown";
  const headquarters = [r.hq, r.country && r.country !== r.hq ? r.country : ""]
    .filter(Boolean)
    .join(", ") || "unknown";
  const employees = r.employees
    ? `About ${fmtNumber(r.employees)}${r.empYear ? ` (as of ${r.empYear})` : ""}`
    : "unknown";
  const executives = r.ceos.length ? `${r.ceos.join(", ")} (CEO)` : "unknown";
  const ownership = r.parent
    ? `Subsidiary of ${r.parent}`
    : r.exchange || r.ticker
    ? `Public${r.exchange ? ` (${r.exchange}${r.ticker ? `: ${r.ticker}` : ""})` : ""}`
    : "unknown";

  const profile: CompanyProfile = {
    whatTheyDo,
    headquarters,
    localPresence: "unknown", // Wikidata rarely has the local site; left for AI/manual.
    employees,
    executives,
    ownership,
  };

  const officialName =
    cand.label && cand.label.toLowerCase() !== input.name.toLowerCase() ? cand.label : null;

  return { profile, officialName };
}
