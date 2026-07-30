import Link from "next/link";
import { sql } from "@/lib/db";
import { unhandle } from "../actions";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  employer_id: number | null;
  company: string;
  signal_type: "risk" | "growth" | "neutral";
  category: string;
  summary: string;
  source: string;
  scored_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  usaspending: "USASpending",
  twc_warn: "Texas WARN (TWC)",
  sec_edgar: "SEC EDGAR",
  permits: "Permits",
  costar: "CoStar",
  epa_echo: "EPA / OSHA ECHO",
  manual: "Pasted",
};

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function HandledPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <div className="wrap">
        <div className="notice" style={{ marginTop: 28 }}>
          <h3>Database not connected</h3>
        </div>
      </div>
    );
  }

  let rows: Row[] = [];
  try {
    rows = (await sql`
      select s.id, s.employer_id,
             coalesce(e.name, s.raw->>'Recipient Name', s.raw->>'job_site_name', s.raw->>'company_name', 'Unmatched signal') as company,
             s.signal_type, s.category, s.summary, s.source, s.scored_at
      from signals s
      left join employers e on e.id = s.employer_id
      where s.handled = true
      order by s.scored_at desc
      limit 200
    `) as Row[];
  } catch {
    rows = [];
  }

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>Handled</h1>
          <div className="tag">Signals you have cleared. Undo returns one to the queue.</div>
        </div>
      </header>

      <div className="col-head" style={{ marginTop: 8 }}>
        Handled · {rows.length}
      </div>

      {rows.length === 0 ? (
        <div className="empty">Nothing handled yet.</div>
      ) : (
        <div className="card">
          {rows.map((r) => (
            <div className="handled-row" key={r.id}>
              <span className={`dot ${r.signal_type === "risk" ? "risk" : r.signal_type === "growth" ? "growth" : "watch"}`} />
              <span className="hr-cat">
                {r.employer_id != null ? (
                  <Link className="link" href={`/employer/${r.employer_id}`}>
                    {r.company}
                  </Link>
                ) : (
                  r.company
                )}
              </span>
              <span className="hr-sum">
                {r.category ? `${r.category}: ` : ""}
                {r.summary}
              </span>
              <span className="hr-date">
                {SOURCE_LABELS[r.source] ?? r.source} · {fmtDate(r.scored_at)}
              </span>
              <form action={unhandle} className="mark-form">
                <input type="hidden" name="id" value={r.id} />
                <button className="handle sm" type="submit" title="Return to queue">
                  Undo
                </button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
