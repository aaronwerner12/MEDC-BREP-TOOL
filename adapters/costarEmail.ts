import type { NormalizedSignal } from "../lib/types";

// Parse a CoStar saved-search alert email into normalized signals.
//
// Setup: in CoStar, create saved searches geofenced to the McKinney submarket
// (and your watchlist addresses) for (1) new subleases, (2) new availabilities,
// (3) new leases. Route the alert emails to a dedicated inbox whose provider
// posts inbound mail to /api/inbound/costar.
//
// The line parser below is intentionally simple; tune the split/regex to match
// your actual alert format. A sublease listing from a watchlist tenant is the
// single highest-value soft-risk signal, so bias toward capturing those.
export function parseCostarEmail(input: {
  subject: string;
  text: string;
  messageId: string;
}): NormalizedSignal[] {
  const { subject, text, messageId } = input;

  const kind = /sublease/i.test(subject)
    ? "sublease"
    : /availab/i.test(subject)
    ? "availability"
    : /lease|signed|tenant/i.test(subject)
    ? "lease"
    : "listing";

  // Keep only lines that look like a listing (square footage or listing keyword).
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\d[\d,]{2,}\s?(SF|sq\s?ft)|sublease|available/i.test(l));

  return lines.map((line, i) => {
    // e.g. "123 Main St - Tenant Name - 24,500 SF - Sublease"
    const parts = line.split(/\s[—\-|]\s/);
    const company = (parts[1] ?? "Unidentified").trim();
    return {
      source: "costar",
      tier: "indicative" as const,
      externalId: `${messageId}:${i}`,
      companyName: company,
      observedText: `CoStar ${kind} alert (McKinney submarket): ${line}`,
      raw: { subject, line, kind },
    };
  });
}
