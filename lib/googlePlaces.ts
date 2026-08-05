import type { PartialProfile } from "./companyProfile";

// Google Places (Maps) data. The best free-tier source for small LOCAL
// businesses: a firm's Google Business listing carries its address, website,
// category, and often an editorial summary, even when it is in no registry or
// encyclopedia. We bias the search to McKinney, TX so we get the local entity.
//
// Uses a Google Cloud API key with the Places API enabled. Reuses
// GOOGLE_PLACES_API_KEY, or GOOGLE_KG_API_KEY if the same Cloud key has both
// APIs enabled. Skipped when neither is set. Note: Places billing must be
// enabled on the Cloud project, but Google's monthly free credit covers typical
// EDC use.
const FIND = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json";
const DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";

function apiKey(): string | undefined {
  return process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_KG_API_KEY || undefined;
}

// Map common Google place types to a readable "what they do" line.
const TYPE_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  bar: "Bar",
  bakery: "Bakery",
  meal_takeaway: "Takeout restaurant",
  meal_delivery: "Food delivery",
  food: "Food service",
  grocery_or_supermarket: "Grocery store",
  store: "Retail store",
  clothing_store: "Clothing store",
  furniture_store: "Furniture store",
  hardware_store: "Hardware store",
  car_dealer: "Auto dealer",
  car_repair: "Auto repair",
  bank: "Bank",
  finance: "Financial services",
  insurance_agency: "Insurance agency",
  real_estate_agency: "Real estate agency",
  lawyer: "Law firm",
  doctor: "Medical practice",
  hospital: "Hospital",
  dentist: "Dental practice",
  gym: "Gym / fitness",
  lodging: "Hotel / lodging",
  school: "School",
  general_contractor: "Contractor",
  moving_company: "Moving company",
  storage: "Storage",
  electrician: "Electrical contractor",
  plumber: "Plumbing contractor",
};

export function readableType(types: string[]): string {
  for (const t of types) if (TYPE_LABEL[t]) return TYPE_LABEL[t];
  const skip = new Set(["point_of_interest", "establishment", "food", "premise", "geocode"]);
  const t = types.find((x) => !skip.has(x));
  return t ? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

interface PlaceDetails {
  name?: string;
  formatted_address?: string;
  website?: string;
  editorial_summary?: { overview?: string };
  types?: string[];
}

// Build a PartialProfile from a Place Details result. Pure, for offline testing.
export function buildPlacesProfile(details: PlaceDetails): PartialProfile {
  const p: PartialProfile = {};
  const addr = (details.formatted_address ?? "").trim();
  if (addr) {
    if (/mckinney/i.test(addr)) p.localPresence = addr;
    else p.headquarters = addr;
  }
  if (details.website) p.website = details.website;

  const summary = details.editorial_summary?.overview?.trim() ?? "";
  const typeLabel = readableType(details.types ?? []);
  const what = summary || typeLabel;
  if (what) p.whatTheyDo = what;

  if (details.name) p.officialName = details.name;
  return p;
}

export async function fetchGooglePlaces(name: string): Promise<PartialProfile | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const input = encodeURIComponent(`${name} McKinney TX`);
    const fr = await fetch(
      `${FIND}?input=${input}&inputtype=textquery&fields=place_id&key=${key}`,
      { headers: { Accept: "application/json" } }
    );
    if (!fr.ok) return null;
    const fj = (await fr.json()) as { candidates?: { place_id?: string }[] };
    const placeId = fj.candidates?.[0]?.place_id;
    if (!placeId) return null;

    const fields = "name,formatted_address,website,editorial_summary,types";
    const dr = await fetch(`${DETAILS}?place_id=${placeId}&fields=${fields}&key=${key}`, {
      headers: { Accept: "application/json" },
    });
    if (!dr.ok) return null;
    const dj = (await dr.json()) as { result?: PlaceDetails };
    if (!dj.result) return null;

    const p = buildPlacesProfile(dj.result);
    return Object.keys(p).length ? p : null;
  } catch {
    return null;
  }
}
