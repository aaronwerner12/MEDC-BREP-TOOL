import Anthropic from "@anthropic-ai/sdk";

// Web-sourced company profile. Uses Anthropic's server-side web_search tool so
// the facts are grounded in real, cited sources rather than model memory. The
// prompt requires "unknown" for anything unverified and forbids speculation.
//
// Requires the web search tool to be enabled on the Anthropic account; if it is
// not, the API call throws and the caller surfaces a graceful error.
const MODEL = "claude-haiku-4-5-20251001";

// Structured, labeled profile fields. Stored as JSON in employers.profile so the
// employer page can render a clean labeled list instead of a run-on paragraph.
export interface CompanyProfile {
  whatTheyDo: string;
  headquarters: string;
  localPresence: string;
  employees: string;
  executives: string;
  ownership: string;
}

const PROFILE_FIELDS: { key: keyof CompanyProfile; label: string }[] = [
  { key: "whatTheyDo", label: "What they do" },
  { key: "headquarters", label: "Headquarters" },
  { key: "localPresence", label: "McKinney / Collin County presence" },
  { key: "employees", label: "Employees" },
  { key: "executives", label: "Key executives" },
  { key: "ownership", label: "Ownership" },
];

let _client: Anthropic | undefined;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  const candidate = text.slice(a, b + 1);
  // The model sometimes wraps values across multiple lines, putting literal
  // newlines/tabs inside string values. Those are invalid in JSON and make
  // JSON.parse throw. Collapse raw control characters to spaces first; JSON
  // tolerates extra whitespace between tokens, and this rescues the values.
  const attempts = [candidate, candidate.replace(/[\r\n\t]+/g, " ")];
  for (const c of attempts) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try the next form
    }
  }
  return null;
}

function clean(v: unknown): string {
  return String(v ?? "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ") // collapse internal line breaks / runs of whitespace
    .replace(/\s+;\s+/g, "; ") // tidy stray "word ; word" from wrapped values
    .replace(/^[\s;,]+/, "")
    .trim();
}

// Parse the stored profile column into structured fields. Handles both the new
// JSON shape and older plain-text profiles (rendered as a single "About" line).
export function parseProfile(
  raw: string | null
): { fields: { label: string; value: string }[]; text: string | null } {
  if (!raw) return { fields: [], text: null };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const fields = PROFILE_FIELDS.map((f) => ({
        label: f.label,
        value: clean(obj[f.key]),
      })).filter((f) => f.value && f.value.toLowerCase() !== "unknown");
      if (fields.length > 0) return { fields, text: null };
    } catch {
      // fall through to plain text
    }
  }
  return { fields: [], text: trimmed };
}

export async function generateCompanyProfile(input: {
  name: string;
  sector: string | null;
  city?: string;
}): Promise<{ profile: string; officialName: string | null }> {
  const loc = input.city ?? "McKinney, Texas";
  const prompt = `Compile a short, current public business profile for "${input.name}"${
    input.sector ? ` (${input.sector})` : ""
  }, focusing on its presence in ${loc}. Use web search for present-day public information. Describe the company as it operates today. If it was renamed, merged, or absorbed into a parent, profile the current operating entity and put its current name in officialName. Report ONLY facts supported by the sources you find and write "unknown" for any field you cannot verify.

Return ONLY a single JSON object and nothing else. No preamble, no explanation before it, no notes after it. Each value must be plain text on ONE line with no line breaks inside it.

{
  "officialName": "the current official / legal / commonly-used business name if it differs from what was given, otherwise an empty string",
  "whatTheyDo": "one plain sentence on the business",
  "headquarters": "city and state of the corporate headquarters",
  "localPresence": "the McKinney or Collin County site or role, or unknown",
  "employees": "approximate headcount overall, and local if known",
  "executives": "current CEO and any other named leaders",
  "ownership": "public (with ticker), private, or parent company"
}

Keep each value short (under 25 words), plain direct voice, no em dashes. Do not invent numbers, names, or facts. Write "unknown" rather than guessing. Do not add commentary or disclaimers outside the JSON.`;

  const res = await client().messages.create({
    model: MODEL,
    max_tokens: 1200,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as never],
    messages: [{ role: "user", content: prompt }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  const json = extractJson(text);
  if (json) {
    const profile: CompanyProfile = {
      whatTheyDo: clean(json.whatTheyDo),
      headquarters: clean(json.headquarters),
      localPresence: clean(json.localPresence),
      employees: clean(json.employees),
      executives: clean(json.executives),
      ownership: clean(json.ownership),
    };
    const officialRaw = clean(json.officialName);
    const officialName = officialRaw && officialRaw.length <= 120 ? officialRaw : null;

    // Only store JSON if at least one field came back; otherwise keep the raw
    // text so the caller still shows something.
    const anyField = Object.values(profile).some((v) => v && v.toLowerCase() !== "unknown");
    const stored = anyField ? JSON.stringify(profile) : text.replace(/\s*—\s*/g, ", ");
    return { profile: stored, officialName };
  }
  // Fallback: treat the whole response as the profile.
  return { profile: text.replace(/\s*—\s*/g, ", "), officialName: null };
}
