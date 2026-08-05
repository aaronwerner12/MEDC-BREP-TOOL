// Keyless structured employer discovery via OpenStreetMap's Overpass API. Pulls
// named office / industrial / works features inside the McKinney bounding box.
// Fully free, no key, so discovery works even with no Google key configured.
// Coverage skews to what mappers have tagged, so it complements (not replaces)
// the Places source.
const OVERPASS = "https://overpass-api.de/api/interpreter";

// McKinney, TX bounding box: south, west, north, east.
const BBOX = "33.10,-96.75,33.28,-96.55";

const OVERPASS_QUERY = `[out:json][timeout:25];(
  node["office"]["name"](${BBOX});
  way["office"]["name"](${BBOX});
  node["industrial"]["name"](${BBOX});
  way["industrial"]["name"](${BBOX});
  node["man_made"="works"]["name"](${BBOX});
  way["man_made"="works"]["name"](${BBOX});
  way["landuse"="industrial"]["name"](${BBOX});
);out center tags 250;`;

interface OsmElement {
  tags?: Record<string, string>;
}

function humanize(v: string): string {
  return v.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pure: turn an Overpass payload into a deduped employer list with a derived
// sector. Exported for offline testing.
export function collectOsm(json: { elements?: OsmElement[] }): { name: string; sector: string | null }[] {
  const out = new Map<string, { name: string; sector: string | null }>();
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    const name = (t.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (out.has(key)) continue;

    // Derive a rough sector from the most descriptive tag.
    const rawSector =
      (t.office && t.office !== "yes" ? t.office : "") ||
      (t.industry && t.industry !== "yes" ? t.industry : "") ||
      (t.industrial && t.industrial !== "yes" ? t.industrial : "") ||
      (t["man_made"] === "works" ? "manufacturing" : "") ||
      (t.office ? "office" : "");
    out.set(key, { name, sector: rawSector ? humanize(rawSector) : null });
  }
  return [...out.values()];
}

export async function discoverOsmEmployers(): Promise<{ name: string; sector: string | null }[]> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    let json: { elements?: OsmElement[] };
    try {
      const res = await fetch(OVERPASS, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Accept: "application/json" },
        body: OVERPASS_QUERY,
        signal: ctrl.signal,
      });
      if (!res.ok) return [];
      json = (await res.json()) as { elements?: OsmElement[] };
    } finally {
      clearTimeout(timer);
    }
    return collectOsm(json);
  } catch {
    return [];
  }
}
