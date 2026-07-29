import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";

const ENDPOINT = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
// Collin County place of performance: state TX, county FIPS 085.
const COLLIN_COUNTY = { country: "USA", state: "TX", county: "085" };

interface Award {
  "Award ID": string;
  "Recipient Name": string;
  "Award Amount": number;
  "Start Date": string;
  "End Date": string;
  "Awarding Agency": string;
  generated_internal_id?: string;
}

async function fetchAwards(recipient: string): Promise<Award[]> {
  const body = {
    subawards: false,
    limit: 100,
    page: 1,
    filters: {
      award_type_codes: ["A", "B", "C", "D"], // contracts
      time_period: [{ start_date: "2024-01-01", end_date: "2026-12-31" }],
      recipient_search_text: [recipient],
      place_of_performance_locations: [COLLIN_COUNTY],
    },
    fields: [
      "Award ID", "Recipient Name", "Award Amount", "Start Date", "End Date",
      "Awarding Agency", "Awarding Sub Agency", "Contract Award Type",
    ],
    sort: "Award Amount",
    order: "desc",
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`USASpending ${res.status}`);
  const json = (await res.json()) as { results?: Award[] };
  return json.results ?? [];
}

const daysFromNow = (d: string) => (new Date(d).getTime() - Date.now()) / 86_400_000;
const daysSince = (d: string) => (Date.now() - new Date(d).getTime()) / 86_400_000;

function usdShort(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

// Materiality thresholds. A defense prime like Raytheon holds hundreds of
// contracts, so one contract expiring is normal churn, not a risk. We roll each
// employer's Collin County awards up into a portfolio and only flag when the
// movement is material: a large share (or dollar amount) of the book expiring
// soon, or a genuinely large new award. This yields at most one risk and one
// growth signal per employer instead of one row per contract.
const EXPIRY_ABS = 25_000_000; // >= $25M of active work expiring within the window
const EXPIRY_SHARE = 0.3; // ...or >= 30% of the tracked portfolio,
const EXPIRY_SHARE_MIN = 5_000_000; //    provided that share is at least $5M
const EXPIRY_WINDOW_DAYS = 120;
const NEW_AWARD_MIN = 10_000_000; // a newly started award >= $10M counts as growth
const NEW_AWARD_RECENT_DAYS = 365;

// Pull federal contracts for the defense cluster in Collin County and emit
// aggregate, portfolio-level signals rather than one per contract.
export async function usaspendingSignals(
  employers: EmployerRow[]
): Promise<NormalizedSignal[]> {
  const targets = employers.filter((e) =>
    [e.name, ...e.aliases].some((t) => /raytheon|rtx|l3|lockheed|northrop/i.test(t))
  );

  const out: NormalizedSignal[] = [];
  for (const e of targets) {
    const recipient = e.aliases.find((a) => /raytheon|rtx/i.test(a)) ?? e.name;
    const awards = await fetchAwards(recipient);
    out.push(...aggregateAwards(awards, e));
  }
  return out;
}

// Roll an employer's Collin County awards into at most one risk (expiry
// concentration) and one growth (new large awards) signal. Exported pure so it
// can be tested offline against sample award sets.
export function aggregateAwards(awards: Award[], e: EmployerRow): NormalizedSignal[] {
  const out: NormalizedSignal[] = [];
  if (awards.length === 0) return out;

  {
    const recipientName = awards[0]["Recipient Name"] || e.name;
    const active = awards.filter((a) => daysFromNow(a["End Date"]) > 0);
    if (active.length === 0) return out;

    const totalActive = active.reduce((s, a) => s + (a["Award Amount"] || 0), 0);
    const contractCount = active.length;

    // Expiring-soon concentration.
    const expiring = active.filter((a) => {
      const d = daysFromNow(a["End Date"]);
      return d > 0 && d <= EXPIRY_WINDOW_DAYS;
    });
    const expiringValue = expiring.reduce((s, a) => s + (a["Award Amount"] || 0), 0);
    const expiringShare = totalActive > 0 ? expiringValue / totalActive : 0;

    const materialExpiry =
      expiring.length > 0 &&
      (expiringValue >= EXPIRY_ABS ||
        (expiringShare >= EXPIRY_SHARE && expiringValue >= EXPIRY_SHARE_MIN));

    if (materialExpiry) {
      const pct = Math.round(expiringShare * 100);
      out.push({
        source: "usaspending",
        tier: "authoritative",
        // Stable per-employer id: one expiry-concentration row, not one per contract.
        externalId: `emp${e.id}:portfolio-expiry`,
        companyName: recipientName,
        sourceUrl: "https://www.usaspending.gov",
        observedText:
          `${recipientName} federal contract portfolio in Collin County: ` +
          `${usdShort(totalActive)} active across ${contractCount} tracked awards. ` +
          `${usdShort(expiringValue)} (${pct}%) across ${expiring.length} awards expires within ` +
          `${EXPIRY_WINDOW_DAYS} days. This is a material share of the book, not routine churn; ` +
          `worth confirming recompete / follow-on status.`,
        raw: {
          recipient: recipientName,
          totalActive,
          contractCount,
          expiringValue,
          expiringCount: expiring.length,
          expiringShare,
          kind: "portfolio-expiry",
        },
      });
    }

    // Newly started large awards (genuine expansion / hiring indicator).
    const newLarge = active.filter(
      (a) =>
        (a["Award Amount"] || 0) >= NEW_AWARD_MIN &&
        daysSince(a["Start Date"]) >= 0 &&
        daysSince(a["Start Date"]) <= NEW_AWARD_RECENT_DAYS
    );
    const newLargeValue = newLarge.reduce((s, a) => s + (a["Award Amount"] || 0), 0);

    if (newLarge.length > 0 && newLargeValue >= NEW_AWARD_MIN) {
      const largest = [...newLarge].sort((a, b) => b["Award Amount"] - a["Award Amount"])[0];
      out.push({
        source: "usaspending",
        tier: "authoritative",
        externalId: `emp${e.id}:portfolio-new`,
        companyName: recipientName,
        sourceUrl: largest.generated_internal_id
          ? `https://www.usaspending.gov/award/${largest.generated_internal_id}`
          : "https://www.usaspending.gov",
        observedText:
          `${recipientName} won ${newLarge.length} new large federal award(s) in Collin County ` +
          `in the last ${NEW_AWARD_RECENT_DAYS} days totaling ${usdShort(newLargeValue)} ` +
          `(largest ${usdShort(largest["Award Amount"])} from ${largest["Awarding Agency"]}). ` +
          `Possible expansion or hiring indicator.`,
        raw: {
          recipient: recipientName,
          newCount: newLarge.length,
          newLargeValue,
          largestAward: largest["Award ID"],
          kind: "portfolio-new",
        },
      });
    }
  }

  return out;
}
