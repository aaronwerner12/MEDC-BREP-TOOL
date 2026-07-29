import Link from "next/link";
import { sql } from "@/lib/db";
import { BREP_CATEGORIES } from "@/lib/brep";

export const dynamic = "force-dynamic";

type SigType = "risk" | "growth" | "neutral";

interface Employer {
  id: number;
  name: string;
  band: string | null;
  sector: string | null;
  aliases: string[];
}

interface Signal {
  id: number;
  signal_type: SigType;
  priority: number;
  category: string;
  summary: string;
  recommended_action: string;
  talking_point: string;
  tier: string;
  source: string;
  source_url: string | null;
  scored_at: string;
  handled: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  usaspending: "USASpending",
  twc_warn: "Texas WARN (TWC)",
  sec_edgar: "SEC EDGAR",
  permits: "Permits",
  costar: "CoStar",
  manual: "Pasted",
};

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function EmployerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employerId = Number(id);

  if (!Number.isFinite(employerId)) {
    return <NotFound />;
  }

  let employer: Employer | undefined;
  let signals: Signal[] = [];
  try {
    employer = (
      (await sql`
        select id, name, band, sector, aliases from employers where id = ${employerId}
      `) as Employer[]
    )[0];
    if (employer) {
      signals = (await sql`
        select id, signal_type, priority, category, summary, recommended_action,
               talking_point, tier, source, source_url, scored_at, handled
        from signals
        where employer_id = ${employerId}
        order by handled asc, priority desc, scored_at desc
      `) as Signal[];
    }
  } catch {
    // fall through to not-found / empty
  }

  if (!employer) return <NotFound />;

  const open = signals.filter((s) => !s.handled);
  const handled = signals.filter((s) => s.handled);
  const risks = open.filter((s) => s.signal_type === "risk");
  const positives = open.filter((s) => s.signal_type === "growth");
  const watches = open.filter((s) => s.signal_type === "neutral");

  const status: SigType | "none" = risks.length
    ? "risk"
    : positives.length
    ? "growth"
    : watches.length
    ? "neutral"
    : "none";

  // Categories that already have an active (open) signal, so the "what we're
  // watching" section can show the rest as still-open questions.
  const activeCategories = new Set(open.map((s) => s.category));

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>{employer.name}</h1>
          <div className="tag">
            {employer.band ? `${employer.band} employees` : "Watchlist employer"}
            {employer.sector ? ` · ${employer.sector}` : ""}
          </div>
        </div>
        <div className="spacer" />
        <Link className="pill" href="/">
          ← Back to desk
        </Link>
      </header>

      <div className="emp-status-row">
        <span className={`status ${status === "none" ? "" : status === "risk" ? "risk" : status === "growth" ? "growth" : "watch"}`}>
          {status === "risk"
            ? "At risk"
            : status === "growth"
            ? "Growing"
            : status === "neutral"
            ? "Watch"
            : "No signals"}
        </span>
        <span className="emp-counts">
          {open.length} open · {risks.length} risk · {positives.length} growth · {handled.length} handled
        </span>
        {employer.aliases?.length > 0 && (
          <span className="emp-aliases">Also known as: {employer.aliases.join(", ")}</span>
        )}
      </div>

      {/* Grounded risk / stability read from this employer's actual signals. */}
      <div className="col-head" style={{ marginTop: 24 }}>
        What could put them at risk
      </div>
      {risks.length + watches.length === 0 ? (
        <div className="empty">No active risk signals on record.</div>
      ) : (
        [...risks, ...watches].map((s) => <FactorCard key={s.id} s={s} tone="risk" />)
      )}

      <div className="col-head" style={{ marginTop: 24 }}>
        What is keeping them stable / growing
      </div>
      {positives.length === 0 ? (
        <div className="empty">No active growth signals on record.</div>
      ) : (
        positives.map((s) => <FactorCard key={s.id} s={s} tone="growth" />)
      )}

      {/* The BREP framework as the standing watch list. */}
      <div className="col-head" style={{ marginTop: 24 }}>
        What we&rsquo;re watching (BREP indicators)
      </div>
      <div className="card src-table-wrap">
        <table className="src-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Healthy signs</th>
              <th>Risk indicators</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {BREP_CATEGORIES.map((c) => {
              const active = activeCategories.has(c.category);
              const type = open.find((s) => s.category === c.category)?.signal_type;
              return (
                <tr key={c.category}>
                  <td className="cat">{c.category}</td>
                  <td>{c.healthy}</td>
                  <td>{c.risk}</td>
                  <td>
                    {active ? (
                      <span className={`cov ${type === "growth" ? "live" : "planned"}`} style={type === "risk" ? { color: "var(--brick-ink)", background: "var(--brick-bg)" } : undefined}>
                        {type === "risk" ? "Active risk" : type === "growth" ? "Positive" : "Active"}
                      </span>
                    ) : (
                      <span className="cov planned">Monitoring</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {handled.length > 0 && (
        <>
          <div className="col-head" style={{ marginTop: 24 }}>
            Handled history
          </div>
          {handled.map((s) => (
            <div className="handled-row" key={s.id}>
              <span className={`dot ${s.signal_type === "risk" ? "risk" : s.signal_type === "growth" ? "growth" : "watch"}`} />
              <span className="hr-cat">{s.category}</span>
              <span className="hr-sum">{s.summary}</span>
              <span className="hr-date">{fmtDate(s.scored_at)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function FactorCard({ s, tone }: { s: Signal; tone: "risk" | "growth" }) {
  const cls = tone === "growth" ? "growth" : s.signal_type;
  return (
    <div className={`signal ${cls}`}>
      <div className="sig-top">
        <span className="sig-company">{s.category}</span>
        <span className={`badge ${cls}`}>{s.signal_type}</span>
      </div>
      <div className="sig-meta">
        <span className="sig-src">
          {SOURCE_LABELS[s.source] ?? s.source}
          {s.scored_at ? ` · ${fmtDate(s.scored_at)}` : ""}
        </span>
        <span className="sig-score">{s.priority}</span>
      </div>
      <div className="sig-body">{s.summary}</div>
      {s.recommended_action && (
        <div className="move">
          <div className="move-label">Recommended move</div>
          <div className="move-text">{s.recommended_action}</div>
        </div>
      )}
      {s.talking_point && <div className="quote">&ldquo;{s.talking_point}&rdquo;</div>}
      {s.tier === "indicative" && (
        <div className="sig-foot">
          <span className="confirm">Indicative — confirm before outreach</span>
          {s.source_url && (
            <a className="src-link" href={s.source_url} target="_blank" rel="noreferrer">
              source
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="wrap">
      <div className="notice" style={{ marginTop: 28 }}>
        <h3>Employer not found</h3>
        <p>
          That employer is not on the watchlist. <Link href="/">Back to the desk</Link>.
        </p>
      </div>
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
