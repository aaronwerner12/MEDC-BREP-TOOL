import Link from "next/link";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Allocation = {
  city?: string;
  report_year?: string;
  report_month?: string;
  net_payment_this_period?: string;
  comparable_payment_prior_year?: string;
  period_percent_change?: string;
  payments_to_date?: string;
  ytd_percent_change?: string;
};
const DATASET = "https://data.texas.gov/resource/vfba-b57j.json";
const PAGE = "https://data.texas.gov/dataset/Sales-Tax-Allocation-City/vfba-b57j";

function money(value: string | undefined) {
  const n = Number(value);
  return value && Number.isFinite(n) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n) : "Not reported";
}
function percent(value: string | undefined) {
  const n = Number(value);
  return value && Number.isFinite(n) ? `${n.toFixed(1)}%` : "Not reported";
}
async function getAllocations(): Promise<Allocation[]> {
  const url = new URL(DATASET);
  url.searchParams.set("$where", "upper(city) = 'MCKINNEY'");
  url.searchParams.set("$order", "report_year DESC, report_month DESC");
  url.searchParams.set("$limit", "24");
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Comptroller API returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("Unexpected Comptroller response format");
  return body.filter((item): item is Allocation => !!item && typeof item === "object");
}
export default async function EconomicIndicatorsPage() {
  let rows: Allocation[] = [];
  let error: string | null = null;
  try { rows = await getAllocations(); }
  catch (e) { error = e instanceof Error ? e.message : "Data unavailable"; }
  const latest = rows[0];
  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 24px" }}>
      <p><Link href="/">← Back to BRE dashboard</Link></p>
      <h1>McKinney economic indicators</h1>
      <p>Official Texas Comptroller monthly city sales tax allocations. These are citywide payments, not individual company sales or revenue.</p>
      <p><a href={PAGE} target="_blank" rel="noopener noreferrer">Source: Texas Comptroller public data</a></p>
      {error ? <p role="alert">Live data unavailable: {error}. No stale figures are shown.</p> :
       !latest ? <p role="status">No McKinney records returned by the public dataset. Check the source before relying on this indicator.</p> : (
        <>
          <section style={{ padding: 20, border: "1px solid #ccd5d8", borderRadius: 8, margin: "24px 0" }}>
            <h2>Latest published allocation: {latest.report_month}/{latest.report_year}</h2>
            <p><strong>Current payment:</strong> {money(latest.net_payment_this_period)}</p>
            <p><strong>Same period last year:</strong> {money(latest.comparable_payment_prior_year)}</p>
            <p><strong>Year-over-year change:</strong> {percent(latest.period_percent_change)}</p>
            <p><strong>Year-to-date allocation:</strong> {money(latest.payments_to_date)}</p>
            <p><strong>YTD change:</strong> {percent(latest.ytd_percent_change)}</p>
          </section>
          <h2>Recent monthly allocations</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead><tr><th>Period</th><th>Payment</th><th>Prior year</th><th>Change</th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={`${r.report_year}-${r.report_month}-${i}`}>
                  <td style={{ padding: "8px 4px" }}>{r.report_month}/{r.report_year}</td>
                  <td>{money(r.net_payment_this_period)}</td>
                  <td>{money(r.comparable_payment_prior_year)}</td>
                  <td>{percent(r.period_percent_change)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
