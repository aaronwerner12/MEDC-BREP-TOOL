// Registry of the feeds the desk uses (and plans to use), for the /sources page.
// `covers` lists the BREP category names (see lib/brep.ts) each source informs.

export interface SourceDef {
  name: string;
  status: "live" | "planned";
  tier: "authoritative" | "indicative";
  cadence: string;
  covers: string[];
  detail: string;
}

export const SOURCES: SourceDef[] = [
  {
    name: "USASpending (federal contracts)",
    status: "live",
    tier: "authoritative",
    cadence: "Daily",
    covers: ["Revenue / Financial Health", "Expansion Plans", "Employment"],
    detail:
      "Collin County contract awards for the defense cluster (Raytheon/RTX). Rolled up to portfolio-level expiry concentration and new large awards, not per contract.",
  },
  {
    name: "Texas WARN (TWC)",
    status: "live",
    tier: "authoritative",
    cadence: "Daily",
    covers: ["Employment"],
    detail:
      "State layoff and closure notices from the Texas Open Data Portal, filtered to McKinney / Collin County or a watchlist employer.",
  },
  {
    name: "SEC EDGAR",
    status: "live",
    tier: "authoritative",
    cadence: "Daily",
    covers: ["Revenue / Financial Health", "Ownership / M&A", "Leadership Stability"],
    detail:
      "Recent 8-K / 10-K / 10-Q filings for public watchlist employers (Globe Life, Independent Financial / SouthState, and others).",
  },
  {
    name: "Web news scan",
    status: "live",
    tier: "indicative",
    cadence: "On demand",
    covers: [
      "Employment",
      "Ownership / M&A",
      "Leadership Stability",
      "Revenue / Financial Health",
      "Expansion Plans",
      "Legal / Litigation",
    ],
    detail:
      "Per-company web search (via Claude) for recent significant news: layoffs, expansions, M&A, leadership, results, legal/regulatory. Cited sources; confirm before outreach.",
  },
  {
    name: "CoStar (lease alerts)",
    status: "live",
    tier: "indicative",
    cadence: "On inbound email",
    covers: ["Real Estate", "Facilities / Capital Investment"],
    detail:
      "Parses CoStar saved-search alert emails for the McKinney submarket (subleases, availabilities, leases). A sublease from a watchlist tenant is a quiet-contraction signal.",
  },
  {
    name: "City / County Permits + Planning & Zoning",
    status: "planned",
    tier: "authoritative",
    cadence: "Daily",
    covers: [
      "Facilities / Capital Investment",
      "Expansion Plans",
      "Capital Investment",
      "Infrastructure Needs",
      "Regulatory Issues",
    ],
    detail: "Building permits geofenced to watchlist addresses; new construction vs. demolition/decommission.",
  },
  {
    name: "EPA / OSHA ECHO",
    status: "live",
    tier: "authoritative",
    cadence: "Daily",
    covers: ["Environmental / Safety", "Regulatory Issues"],
    detail:
      "Facility compliance and enforcement status for McKinney watchlist employers from EPA/OSHA ECHO; a current violation flag becomes a risk signal.",
  },
  {
    name: "County court / PACER",
    status: "planned",
    tier: "authoritative",
    cadence: "Daily",
    covers: ["Legal / Litigation"],
    detail: "Lawsuits and contract disputes involving watchlist employers.",
  },
  {
    name: "Glassdoor / Indeed / Reddit",
    status: "planned",
    tier: "indicative",
    cadence: "Web scan",
    covers: ["Employee Morale", "Workforce Availability", "Employment"],
    detail: "Reviews and job postings. Indicative — a human confirms before outreach.",
  },
  {
    name: "PitchBook / Crunchbase",
    status: "planned",
    tier: "indicative",
    cadence: "Web scan",
    covers: ["Ownership / M&A", "Leadership Stability"],
    detail: "Ownership changes, PE buyouts, and mergers for private companies.",
  },
  {
    name: "ImportYeti / Panjiva",
    status: "planned",
    tier: "indicative",
    cadence: "Web scan",
    covers: ["Supply Chain"],
    detail: "Customer/supplier concentration and shipping disruptions.",
  },
];
