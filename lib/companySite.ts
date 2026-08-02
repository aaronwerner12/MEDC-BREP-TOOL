import type { PartialProfile } from "./companyProfile";

// Keyless last-resort enrichment: fetch a company's own homepage and read its
// description meta tag. Works for any firm with a website, but only yields a
// "what they do" line (employees/executives are not reliably on a homepage
// without an LLM). Only called when an earlier source supplied a URL.
const UA =
  "Mozilla/5.0 (compatible; McKinneyWatchtower/1.0; +https://visitmckinney.com)";
const TIMEOUT_MS = 6000;
const MAX_BYTES = 200_000;

function attr(tagText: string, attrName: string): string {
  const m = tagText.match(new RegExp(`${attrName}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Pure extractor: pull the best description from HTML (og:description, then
// meta description, then <title>). Exported for offline testing.
export function extractSiteDescription(html: string): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  let ogDesc = "";
  let metaDesc = "";
  for (const tag of metas) {
    const prop = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (prop === "og:description" && !ogDesc) ogDesc = attr(tag, "content");
    else if (prop === "description" && !metaDesc) metaDesc = attr(tag, "content");
  }
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const raw = ogDesc || metaDesc || title;
  if (!raw) return null;
  const out = decode(raw);
  return out.length >= 12 ? out.slice(0, 300) : null;
}

export async function fetchSiteDescription(website: string): Promise<PartialProfile | null> {
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html/i.test(ct)) return null;
    const html = (await res.text()).slice(0, MAX_BYTES);
    const desc = extractSiteDescription(html);
    return desc ? { whatTheyDo: desc } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
