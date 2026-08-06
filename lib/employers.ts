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
  segment?: string | null; // 'medc' = curated watchlist, 'mckinney' = discovered directory
}

export async function loadEmployers(): Promise<EmployerRow[]> {
  const rows = (await sql`
    select id, name, aliases, uei, band, sector, addresses, active,
           coalesce(segment, 'medc') as segment
    from employers
    where active = true
    order by id
  `) as EmployerRow[];
  return rows;
}

// The curated MEDC watchlist only (excludes discovered directory firms). Use
// this for authoritative risk feeds that match a company name reported anywhere
// in the state (e.g. Texas WARN): a distant notice should only ever resolve to a
// tracked employer, never to one of the hundreds of same-named local shops.
export function watchlistOnly(employers: EmployerRow[]): EmployerRow[] {
  return employers.filter((e) => (e.segment ?? "medc") === "medc");
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

// Generic words that appear in countless unrelated company names. A candidate
// made up ONLY of these must never match on its own, or a distant, unrelated
// firm (e.g. "United Supermarkets" in Lubbock) collides with a same-worded local
// business. A match still stands when the candidate carries at least one
// distinctive token alongside these (e.g. "Blount Fine Foods" keeps "blount").
const GENERIC_TOKENS = new Set([
  "united", "national", "american", "international", "general", "standard",
  "supermarket", "supermarkets", "market", "markets", "grocery", "foods", "food",
  "systems", "system", "services", "service", "solutions", "group", "holdings",
  "industries", "enterprises", "company", "corporation", "associates", "partners",
  "management", "financial", "bank", "banking", "insurance", "health", "medical",
  "center", "centers", "products", "supply", "distribution", "logistics",
  "technologies", "technology", "global", "north", "south", "east", "west",
  "texas", "city", "county", "state", "us", "usa",
]);

// A candidate name/alias is distinctive enough to anchor a match only if it
// contains at least one token that is not a generic business word.
function isDistinctive(normalized: string): boolean {
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.some((t) => !GENERIC_TOKENS.has(t));
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
      // Exact equality always matches. A phrase submatch only counts when the
      // candidate carries a distinctive (non-generic) token, so a shared generic
      // word like "united" or "systems" can never link two unrelated firms.
      if (needle === c) return e;
      if (isDistinctive(c) && (phraseIn(needle, c) || phraseIn(c, needle))) {
        return e;
      }
    }
  }
  return null;
}
