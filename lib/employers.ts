import { sql } from "./db";

// A row from the employers watchlist table (see migrations/0001_init.sql).
export interface EmployerRow {
  id: number;
  name: string;
  aliases: string[]; // alternate legal / acquirer names for entity matching
  uei: string | null; // SAM.gov unique entity id when known
  band: string | null; // MEDC size band label
  sector: string | null;
  addresses: unknown[]; // for place-of-performance / permit geofencing
  active: boolean;
}

export async function loadEmployers(): Promise<EmployerRow[]> {
  const rows = (await sql`
    select id, name, aliases, uei, band, sector, addresses, active
    from employers
    where active = true
    order by id
  `) as EmployerRow[];
  return rows;
}

// Normalize a company name for comparison: lowercase, drop common corporate
// suffixes and punctuation, collapse whitespace.
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|inc|corporation|corp|company|co|llc|l\.l\.c|lp|l\.p|ltd|the)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when `needle` appears in `hay` as a whole word / phrase (not a substring
// fragment). Prevents short aliases like "co" or "srs" from matching mid-word.
function phraseIn(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^| )${escapeRegex(needle)}( |$)`).test(hay);
}

// Resolve the company name a feed reports to a watchlist employer. Matches on
// the employer name and every alias, in both directions (the feed may report a
// longer legal name than the alias, or vice versa). UEI-based matching is
// preferred when a feed exposes one; callers with a UEI can filter directly on
// employers.uei before falling back to this name matcher.
export function matchEmployer(
  companyName: string | null | undefined,
  employers: EmployerRow[]
): EmployerRow | null {
  if (!companyName) return null;
  const needle = norm(companyName);
  if (!needle) return null;

  for (const e of employers) {
    const candidates = [e.name, ...e.aliases].map(norm).filter(Boolean);
    for (const c of candidates) {
      if (needle === c || phraseIn(needle, c) || phraseIn(c, needle)) {
        return e;
      }
    }
  }
  return null;
}
