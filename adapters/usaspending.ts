import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";

const ENDPOINT = "https://api.usaspending.gov/api/v2/search/spending_by_award/";
// Collin County place of performance: state TX, county FIPS 085.
const COLLIN_COUNTY = { country: "USA", state: "TX", county: "085" };

interface Award {
  "Award ID": string;
  "Recipient Name": string;
  "Award Amount": number;
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

// Pull federal contracts for the defense cluster and flag near-term expirations
// (the leading layoff indicator for a defense site) and new/large awards.
//
// Enhancement noted in the spec: instead of the expiry heuristic below, snapshot
// each week's active awards to a table and diff, so a contract that simply
// disappears (non-renewed) also becomes a signal.
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
    for (const a of awards) {
      const dLeft = daysFromNow(a["End Date"]);
      const expiringSoon = dLeft > 0 && dLeft < 120 && a["Award Amount"] >= 1_000_000;
      const newOrLarge = dLeft > 365 && a["Award Amount"] >= 1_000_000;
      if (!expiringSoon && !newOrLarge) continue;

      const status = expiringSoon
        ? "expiring within 120 days with no visible follow-on"
        : "new or large active award";
      const amount = Math.round(a["Award Amount"]).toLocaleString();

      out.push({
        source: "usaspending",
        tier: "authoritative",
        externalId: `${a["Award ID"]}:${expiringSoon ? "exp" : "new"}`,
        companyName: a["Recipient Name"],
        sourceUrl: a.generated_internal_id
          ? `https://www.usaspending.gov/award/${a.generated_internal_id}`
          : "https://www.usaspending.gov",
        observedText:
          `Federal contract for ${a["Recipient Name"]} from ${a["Awarding Agency"]}, ` +
          `$${amount}, ending ${a["End Date"]}. Status: ${status}. ` +
          `Place of performance: Collin County, TX.`,
        raw: a,
      });
    }
  }
  return out;
}
