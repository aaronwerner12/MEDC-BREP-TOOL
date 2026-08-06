import { sql } from "./db";
import { parseProfile } from "./profile";

// The intelligence report: what changed across tracked employers over a recent
// window. Built entirely from ingested signals and stored profiles, so it is
// free, deterministic, and never fabricates. Honors the two-tier rule: each
// development carries its tier so indicative items can be labeled "confirm
// before outreach" in the UI.

export type DevType = "risk" | "growth" | "neutral";

export interface ReportDevelopment {
  date: string;
  category: string;
  summary: string;
  tier: string;
  type: DevType;
  source: string;
  sourceUrl: string | null;
}

export interface ReportItem {
  employerId: number | null;
  company: string;
  band: string | null;
  status: DevType;
  hq: string | null;
  local: string | null;
  headline: string;
  developments: ReportDevelopment[];
}

export interface IntelReport {
  windowDays: number;
  items: ReportItem[];
  totalDevelopments: number;
}

interface Row {
  employer_id: number | null;
  company: string;
  band: string | null;
  profile: string | null;
  signal_type: DevType;
  category: string;
  summary: string;
  tier: string;
  source: string;
  source_url: string | null;
  event_date: string;
}

const SEV: Record<DevType, number> = { risk: 3, growth: 2, neutral: 1 };

function placeFromProfile(profile: string | null): { hq: string | null; local: string | null } {
  const { fields } = parseProfile(profile);
  const val = (label: string) => {
    const f = fields.find((x) => x.label === label);
    return f && f.value ? f.value : null;
  };
  return { hq: val("Headquarters"), local: val("McKinney / Collin County presence") };
}

// A plain, factual one-line read of what the period holds for a company. Counts
// only; no interpretation beyond what the signals already say.
function headlineFor(devs: ReportDevelopment[]): string {
  const s = (n: number) => (n === 1 ? "" : "s");
  const risks = devs.filter((d) => d.type === "risk");
  const growth = devs.filter((d) => d.type === "growth");
  const topCat = (arr: ReportDevelopment[]) => arr[0]?.category;
  if (risks.length > 0) {
    const cat = topCat(risks);
    return `${risks.length} risk signal${s(risks.length)} this period${cat ? `, led by ${cat}` : ""}.`;
  }
  if (growth.length > 0) {
    const cat = topCat(growth);
    return `${growth.length} expansion signal${s(growth.length)} this period${cat ? `, ${cat}` : ""}.`;
  }
  return `${devs.length} update${s(devs.length)} to review.`;
}

// Build the report for the last `windowDays` days. One entry per company that
// has open activity in the window, ordered risk-first then by recency.
export async function buildIntelReport(windowDays = 14): Promise<IntelReport> {
  const rows = (await sql`
    select s.employer_id,
           coalesce(
             e.official_name, e.name,
             s.raw->>'Recipient Name', s.raw->>'company_name', 'Unmatched signal'
           ) as company,
           e.band, e.profile,
           s.signal_type, s.category, s.summary, s.tier, s.source, s.source_url,
           coalesce(s.event_date, s.scored_at) as event_date
    from signals s
    left join employers e on e.id = s.employer_id
    where s.handled = false
      and coalesce(s.event_date, s.scored_at) >= now() - (${`${windowDays} days`})::interval
    order by coalesce(s.event_date, s.scored_at) desc
  `) as Row[];

  // Group by employer (or by company name when unmatched).
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.employer_id != null ? `e${r.employer_id}` : `n:${r.company.toLowerCase()}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const items: ReportItem[] = [];
  for (const arr of groups.values()) {
    const developments: ReportDevelopment[] = arr
      .map((r) => ({
        date: r.event_date,
        category: r.category,
        summary: r.summary,
        tier: r.tier,
        type: r.signal_type,
        source: r.source,
        sourceUrl: r.source_url,
      }))
      .slice(0, 8);
    const status = arr.reduce<DevType>(
      (acc, r) => (SEV[r.signal_type] > SEV[acc] ? r.signal_type : acc),
      "neutral"
    );
    const { hq, local } = placeFromProfile(arr[0].profile);
    items.push({
      employerId: arr[0].employer_id,
      company: arr[0].company,
      band: arr[0].band,
      status,
      hq,
      local,
      headline: headlineFor(developments),
      developments,
    });
  }

  // Risk first, then growth, then by number of developments, then most recent.
  items.sort((a, b) => {
    if (SEV[a.status] !== SEV[b.status]) return SEV[b.status] - SEV[a.status];
    if (a.developments.length !== b.developments.length)
      return b.developments.length - a.developments.length;
    return (b.developments[0]?.date ?? "").localeCompare(a.developments[0]?.date ?? "");
  });

  return { windowDays, items, totalDevelopments: rows.length };
}
