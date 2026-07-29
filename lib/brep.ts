// BREP (Business Retention & Expansion Program) classification taxonomy.
// Single source of truth for the categories a signal can fall into, the healthy
// vs risk indicators that drive risk/growth classification, and the public
// sources that inform which feeds to build. The scorer uses `category`,
// `healthy`, and `risk`; the `sources` column is the adapter roadmap.

export interface BrepCategory {
  category: string;
  healthy: string;
  risk: string;
  sources: string;
}

export const BREP_CATEGORIES: BrepCategory[] = [
  {
    category: "Employment",
    healthy: "Hiring, wage growth",
    risk: "Layoffs, hiring freeze",
    sources: "LinkedIn Jobs, Indeed, State WARN Notices, Reddit, TheLayoff.com",
  },
  {
    category: "Revenue / Financial Health",
    healthy: "Growing sales",
    risk: "Declining revenue, shrinking market share",
    sources: "SEC EDGAR (public companies), earnings calls, Google News, D&B",
  },
  {
    category: "Facilities / Capital Investment",
    healthy: "Building additions, new equipment",
    risk: "Deferred maintenance, idle equipment",
    sources: "City building permits, Planning & Zoning agendas, CoStar, LoopNet",
  },
  {
    category: "Real Estate",
    healthy: "Purchasing property, expanding footprint",
    risk: "Building for sale, lease expiration",
    sources: "LoopNet, Crexi, CoStar, County Appraisal District",
  },
  {
    category: "Leadership Stability",
    healthy: "Long-tenured executives",
    risk: "CEO/CFO departures, ownership changes",
    sources: "LinkedIn, company press releases, Google News, PitchBook",
  },
  {
    category: "Ownership / M&A",
    healthy: "Stable ownership",
    risk: "Acquisition, PE buyout, merger",
    sources: "PitchBook, Crunchbase, Google News, SEC filings",
  },
  {
    category: "Capital Investment",
    healthy: "New machinery, automation",
    risk: "No investment for years",
    sources: "Building permits, city incentives, industry publications",
  },
  {
    category: "Workforce Availability",
    healthy: "Easy hiring",
    risk: "Persistent vacancies, turnover",
    sources: "Indeed, LinkedIn Jobs, Glassdoor, Reddit, local workforce boards",
  },
  {
    category: "Employee Morale",
    healthy: "Positive culture",
    risk: "Complaints, turnover, poor reviews",
    sources: "Glassdoor, Fishbowl, Reddit, TheLayoff.com",
  },
  {
    category: "Supply Chain",
    healthy: "Diverse customers/suppliers",
    risk: "Major customer loss, supplier disruptions",
    sources: "ImportYeti, Panjiva, industry news, Google News",
  },
  {
    category: "Infrastructure Needs",
    healthy: "Utilities sufficient",
    risk: "Electric, water, broadband constraints",
    sources: "CEO interviews, city utility departments, Planning & Zoning meetings",
  },
  {
    category: "Regulatory Issues",
    healthy: "Good local relationships",
    risk: "Permitting frustrations, code issues",
    sources: "City council agendas, Planning & Zoning, OSHA, EPA ECHO",
  },
  {
    category: "Legal / Litigation",
    healthy: "Minimal disputes",
    risk: "Lawsuits, contract disputes",
    sources: "County court records, PACER, Google News",
  },
  {
    category: "Environmental / Safety",
    healthy: "Clean record",
    risk: "OSHA citations, EPA violations",
    sources: "OSHA Establishment Search, EPA ECHO",
  },
  {
    category: "Expansion Plans",
    healthy: "New locations, permits",
    risk: "Expansion delayed or canceled",
    sources: "Building permits, LinkedIn, company news, economic development",
  },
];

export const BREP_CATEGORY_NAMES = BREP_CATEGORIES.map((c) => c.category);

// Compact healthy/risk guidance block for the scorer prompt.
export function brepGuidance(): string {
  return BREP_CATEGORIES.map((c) => `- ${c.category}: healthy = ${c.healthy}; risk = ${c.risk}`).join(
    "\n"
  );
}

// Normalize a model-returned category to the closest canonical name (exact, then
// case-insensitive). Falls back to the raw value so nothing is ever dropped.
export function normalizeCategory(raw: string): string {
  if (!raw) return "Signal";
  const exact = BREP_CATEGORY_NAMES.find((n) => n === raw);
  if (exact) return exact;
  const ci = BREP_CATEGORY_NAMES.find((n) => n.toLowerCase() === raw.toLowerCase().trim());
  return ci ?? raw;
}
