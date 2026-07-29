import Link from "next/link";
import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import { markHandled, pullFeeds } from "./actions";
import { PullButton } from "./pull-button";

// Reads live Neon data, so never prerender at build time.
export const dynamic = "force-dynamic";
// Feed pulls score each item with Claude, so allow up to 60s.
export const maxDuration = 60;

type SigType = "risk" | "growth" | "neutral";

interface SignalRow {
  id: number;
  employer_id: number | null;
  company: string;
  band: string | null;
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
}

interface EmployerRow {
  id: number;
  name: string;
  band: string | null;
  sector: string | null;
}

type Status = "risk" | "growth" | "watch" | "none";

interface Kpis {
  employers: number;
  risks: number;
  growth: number;
  outreach: number;
}

type DeskData =
  | {
      state: "ok";
      signals: SignalRow[];
      employers: EmployerRow[];
      statusByEmployer: Map<number, Status>;
      kpis: Kpis;
    }
  | { state: "unconfigured" }
  | { state: "error"; message: string };

// MEDC size bands, largest first.
const BAND_ORDER = ["1,000+", "500+", "250+", "100+", "50+"];

const SOURCE_LABELS: Record<string, string> = {
  usaspending: "USASpending",
  twc_warn: "Texas WARN (TWC)",
  sec_edgar: "SEC EDGAR",
  permits: "Permits",
  costar: "CoStar",
};

async function loadDesk(): Promise<DeskData> {
  if (!process.env.DATABASE_URL) return { state: "unconfigured" };

  try {
    return await readDesk();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Self-heal: if the tables are missing, create + seed them once, then retry.
    if (/relation .* does not exist/i.test(msg)) {
      try {
        await ensureSchema();
        return await readDesk();
      } catch (err2) {
        return { state: "error", message: err2 instanceof Error ? err2.message : String(err2) };
      }
    }
    return { state: "error", message: msg };
  }
}

async function readDesk(): Promise<DeskData> {
  {
    const signals = (await sql`
      select s.id, s.employer_id,
             coalesce(
               e.name,
               s.raw->>'Recipient Name',
               s.raw->>'job_site_name',
               s.raw->>'company_name',
               'Unmatched signal'
             ) as company,
             e.band, s.signal_type, s.priority, s.category, s.summary,
             s.recommended_action, s.talking_point, s.tier, s.source,
             s.source_url, s.scored_at
      from signals s
      left join employers e on e.id = s.employer_id
      where s.handled = false
      order by (s.tier = 'authoritative') desc, s.priority desc, s.scored_at desc
    `) as SignalRow[];

    const employers = (await sql`
      select id, name, band, sector
      from employers
      where active = true
      order by name
    `) as EmployerRow[];

    // Derive a status per employer from its open signals (most severe wins).
    const statusByEmployer = new Map<number, Status>();
    for (const s of signals) {
      if (s.employer_id == null) continue;
      const cur = statusByEmployer.get(s.employer_id) ?? "none";
      const next = statusRank(sigToStatus(s.signal_type)) > statusRank(cur)
        ? sigToStatus(s.signal_type)
        : cur;
      statusByEmployer.set(s.employer_id, next);
    }

    const kpis: Kpis = {
      employers: employers.length,
      risks: signals.filter((s) => s.signal_type === "risk").length,
      growth: signals.filter((s) => s.signal_type === "growth").length,
      outreach: signals.length,
    };

    return { state: "ok", signals, employers, statusByEmployer, kpis };
  }
}

function sigToStatus(t: SigType): Status {
  return t === "risk" ? "risk" : t === "growth" ? "growth" : "watch";
}
function statusRank(s: Status): number {
  return { none: 0, watch: 1, growth: 2, risk: 3 }[s];
}
function bandRank(band: string | null): number {
  const i = BAND_ORDER.indexOf(band ?? "");
  return i === -1 ? BAND_ORDER.length : i;
}
function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function Desk() {
  const data = await loadDesk();

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>McKinney Signal Desk</h1>
          <div className="tag">
            <PinIcon /> Business retention &amp; expansion, before they call.
          </div>
        </div>
        <div className="spacer" />
        {data.state === "ok" && (
          <div className="head-actions">
            <Link className="navlink" href="/sources">
              Sources
            </Link>
            <span className="pill">
              <PulseIcon /> {data.kpis.outreach} open signal{data.kpis.outreach === 1 ? "" : "s"}
            </span>
            {process.env.ANTHROPIC_API_KEY ? (
              <form action={pullFeeds}>
                <PullButton />
              </form>
            ) : (
              <span className="hint">Set ANTHROPIC_API_KEY in Vercel to pull feeds</span>
            )}
          </div>
        )}
      </header>

      {data.state === "unconfigured" && <UnconfiguredNotice />}
      {data.state === "error" && <ErrorNotice message={data.message} />}

      {data.state === "ok" && (
        <>
          <section className="kpis">
            <Kpi label="Employers watched" value={data.kpis.employers} icon={<BuildingIcon />} />
            <Kpi label="Active risks" value={data.kpis.risks} tone="risk" icon={<AlertIcon />} />
            <Kpi label="Growth signals" value={data.kpis.growth} tone="growth" icon={<TrendIcon />} />
            <Kpi label="Needs outreach" value={data.kpis.outreach} tone="watch" icon={<PulseIcon />} />
          </section>

          <div className="grid">
            <main>
              <div className="col-head">Action queue · by priority</div>
              {data.signals.length === 0 ? (
                <div className="empty">No open signals. The desk is clear.</div>
              ) : (
                data.signals.map((s) => <SignalCard key={s.id} s={s} />)
              )}
            </main>

            <aside>
              <div className="col-head">Watchlist · by employment size</div>
              <Watchlist employers={data.employers} statusByEmployer={data.statusByEmployer} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone?: "risk" | "growth" | "watch";
  icon: React.ReactNode;
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="label">
        {icon} {label}
      </div>
      <div className="num">{value}</div>
    </div>
  );
}

function SignalCard({ s }: { s: SignalRow }) {
  const type = s.signal_type ?? "neutral";
  const sourceLabel = SOURCE_LABELS[s.source] ?? s.source;
  const width = Math.max(0, Math.min(100, s.priority));
  return (
    <div className={`signal ${type}`}>
      <div className="sig-top">
        <span className="sig-company">{s.company}</span>
        <span className={`badge ${type}`}>
          {type === "risk" ? <AlertIcon /> : type === "growth" ? <TrendIcon /> : <PulseIcon />}
          {type}
        </span>
      </div>

      <div className="sig-meta">
        {s.category && <span className="sig-cat">{s.category}</span>}
        <span className="sig-src">
          {sourceLabel}
          {s.scored_at ? ` · ${fmtDate(s.scored_at)}` : ""}
        </span>
        <span className="sig-score">{s.priority}</span>
      </div>

      <div className="bar">
        <span style={{ width: `${width}%` }} />
      </div>

      <div className="sig-body">{s.summary}</div>

      {s.recommended_action && (
        <div className="move">
          <div className="move-label">Recommended move</div>
          <div className="move-text">{s.recommended_action}</div>
        </div>
      )}

      {s.talking_point && <div className="quote">&ldquo;{s.talking_point}&rdquo;</div>}

      <div className="sig-foot">
        {s.tier === "indicative" && (
          <span className="confirm">Indicative — confirm before outreach</span>
        )}
        {s.source_url && (
          <a className="src-link" href={s.source_url} target="_blank" rel="noreferrer">
            source
          </a>
        )}
        <form action={markHandled} className="mark-form">
          <input type="hidden" name="id" value={s.id} />
          <button className="handle" type="submit">
            <CheckIcon /> Mark handled
          </button>
        </form>
      </div>
    </div>
  );
}

function Watchlist({
  employers,
  statusByEmployer,
}: {
  employers: EmployerRow[];
  statusByEmployer: Map<number, Status>;
}) {
  if (employers.length === 0) {
    return <div className="empty">Watchlist is empty. Run the seed migrations.</div>;
  }

  const bands = [...new Set(employers.map((e) => e.band ?? "Other"))].sort(
    (a, b) => bandRank(a === "Other" ? null : a) - bandRank(b === "Other" ? null : b)
  );

  return (
    <>
      {bands.map((band) => {
        const firms = employers.filter((e) => (e.band ?? "Other") === band);
        return (
          <div className="band" key={band}>
            <div className="band-head">
              <span className="b-label">{band === "Other" ? "Other" : `${band} employees`}</span>
              <span className="b-count">
                {firms.length} firm{firms.length === 1 ? "" : "s"}
              </span>
            </div>
            {firms.map((e) => {
              const st = statusByEmployer.get(e.id) ?? "none";
              return (
                <div className="emp" key={e.id}>
                  <span className={`dot ${st}`} />
                  <div className="info">
                    <div className="name">{e.name}</div>
                    {e.sector && <div className="sector">{e.sector}</div>}
                  </div>
                  <span className={`status ${st}`}>{statusLabel(st)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function statusLabel(s: Status): string {
  return s === "risk"
    ? "At risk"
    : s === "growth"
    ? "Growing"
    : s === "watch"
    ? "Watch"
    : "No signals";
}

function UnconfiguredNotice() {
  return (
    <div className="notice">
      <h3>Database not connected yet</h3>
      <p>
        The desk is deployed and running, but <code>DATABASE_URL</code> is not set, so there is
        no data to show.
      </p>
      <p>
        Set <code>DATABASE_URL</code> (and the other variables from <code>.env.example</code>) in
        your Vercel project settings, then run the migrations against your Neon database:
      </p>
      <p>
        <code>psql "$DATABASE_URL" -f migrations/0001_init.sql</code>
        <br />
        <code>psql "$DATABASE_URL" -f migrations/0002_seed.sql</code>
        <br />
        <code>psql "$DATABASE_URL" -f migrations/0003_seed_watchlist.sql</code>
      </p>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  const looksUnmigrated = /relation .* does not exist|table/i.test(message);
  return (
    <div className="notice err">
      <h3>Could not read the database</h3>
      {looksUnmigrated ? (
        <p>
          The connection works but the tables are missing. Run the migrations in{" "}
          <code>migrations/</code> in order (0001, 0002, 0003).
        </p>
      ) : (
        <p>
          Check that <code>DATABASE_URL</code> points at a reachable Neon database.
        </p>
      )}
      <p>
        <code>{message}</code>
      </p>
    </div>
  );
}

/* Inline icons (no external dependency) ----------------------------------- */
const sp = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function ScanIcon() {
  return (
    <svg {...sp} width={24} height={24}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg {...sp}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function BuildingIcon() {
  return (
    <svg {...sp}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h6" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg {...sp}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}
function TrendIcon() {
  return (
    <svg {...sp}>
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
      <path d="M16 7h6v6" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg {...sp}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg {...sp}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
