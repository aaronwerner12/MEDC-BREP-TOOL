import type { CompanyProfile } from "./profile";
import { fetchWikidataProfile } from "./wikidata";
import { fetchOpenCorporates } from "./opencorporates";
import { fetchGooglePlaces } from "./googlePlaces";
import { fetchGoogleKg } from "./googleKg";
import { fetchSiteDescription } from "./companySite";

// A partial, single-source view of a company. Each free source fills whatever
// fields it knows; the resolver merges them field-by-field. `website` is an
// internal hint (used to drive the company-site fetch), not a displayed field.
export interface PartialProfile {
  whatTheyDo?: string;
  headquarters?: string;
  localPresence?: string;
  employees?: string;
  executives?: string;
  ownership?: string;
  website?: string;
  officialName?: string | null;
}

const real = (v?: string): v is string =>
  !!v && v.trim().length > 0 && v.trim().toLowerCase() !== "unknown";

function clean(v: string): string {
  return v
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

// Free-first profile resolver. Runs the keyless/free-key sources in order,
// merges the best value for each field, and returns null only if nothing at all
// was found. No AI, no tokens. Sources that need a key are skipped when it is
// absent, so this always runs.
export async function resolveFreeProfile(input: {
  name: string;
  sector?: string | null;
}): Promise<{ profile: CompanyProfile; officialName: string | null; sources: string[] } | null> {
  const sources: { name: string; data: PartialProfile }[] = [];

  // 1. Wikidata (keyless).
  try {
    const wd = await fetchWikidataProfile({ name: input.name });
    if (wd) sources.push({ name: "Wikidata", data: { ...wd.profile, officialName: wd.officialName } });
  } catch {
    // skip
  }

  // 2. OpenCorporates (free key; skipped without OPENCORPORATES_API_TOKEN).
  try {
    const oc = await fetchOpenCorporates(input.name);
    if (oc) sources.push({ name: "OpenCorporates", data: oc });
  } catch {
    // skip
  }

  // 3. Google Places / Maps (skipped without a Places-enabled key). Best for
  //    small local businesses: address, website, category, editorial summary.
  try {
    const gp = await fetchGooglePlaces(input.name);
    if (gp) sources.push({ name: "Google Places", data: gp });
  } catch {
    // skip
  }

  // 4. Google Knowledge Graph (free key; skipped without GOOGLE_KG_API_KEY).
  try {
    const kg = await fetchGoogleKg(input.name);
    if (kg) sources.push({ name: "Google", data: kg });
  } catch {
    // skip
  }

  // 5. The company's own website (keyless), when any source gave us a URL.
  const website = sources.map((s) => s.data.website).find((w) => real(w));
  if (real(website)) {
    try {
      const site = await fetchSiteDescription(website);
      if (site) sources.push({ name: "Website", data: site });
    } catch {
      // skip
    }
  }

  if (sources.length === 0) return null;

  // Merge: first source (in run order) with a real value wins each field.
  const pick = (field: keyof PartialProfile): string => {
    for (const s of sources) {
      const v = s.data[field];
      if (typeof v === "string" && real(v)) return clean(v);
    }
    return "unknown";
  };
  let officialName: string | null = null;
  for (const s of sources) {
    if (s.data.officialName && s.data.officialName.trim()) {
      officialName = clean(s.data.officialName);
      break;
    }
  }

  const profile: CompanyProfile = {
    whatTheyDo: pick("whatTheyDo"),
    headquarters: pick("headquarters"),
    localPresence: pick("localPresence"),
    employees: pick("employees"),
    executives: pick("executives"),
    ownership: pick("ownership"),
  };

  const anyReal = Object.values(profile).some((v) => real(v));
  if (!anyReal) return null;
  return { profile, officialName, sources: sources.map((s) => s.name) };
}
