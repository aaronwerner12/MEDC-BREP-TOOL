import Link from "next/link";
import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import {
  computeRiskIndex,
  trendArrow,
  FRESHNESS_MONTHS,
  type RiskInput,
  type RiskResult,
} from "@/lib/risk";
import { handleEmployer, pullFeeds } from "./actions";
import { PullButton } from "./pull-button";
import { RiskBadge } from "./risk-badge";

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
  event_date: string;
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
      scoreByEmployer: Map<number, RiskResult>;
      prevScoreByEmployer: Map<number, number>;
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
  epa_echo: "EPA / OSHA ECHO",
  news: "News",
  manual: "Pasted",
};

async function loadDesk(): Promise<DeskData> {
  if (!process.env.DATABASE_URL) return { state: "unconfigured" };

  try {
    return await readDesk();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Self-heal: if a table or column is missing, create/upgrade the schema once, then retry.
    if (/does not exist/i.test(msg)) {
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
               e.official_name, e.name,
               s.raw->>'Recipient Name',
               s.raw->>'job_site_name',
               s.raw->>'company_name',
               'Unmatched signal'
             ) as company,
             e.band, s.signal_type, s.priority, s.category, s.summary,
             s.recommended_action, s.talking_point, s.tier, s.source,
             s.source_url, s.scored_at, coalesce(s.event_date, s.scored_at) as event_date
      from signals s
      left join employers e on e.id = s.employer_id
      where s.handled = false
        and coalesce(s.event_date, s.scored_at) >= now() - (${`${FRESHNESS_MONTHS} months`})::interval
      order by (s.tier = 'authoritative') desc, s.priority desc, s.scored_at desc
    `) as SignalRow[];

    const employers = (await sql`
      select id, coalesce(official_name, name) as name, band, sector
      from employers
      where active = true and coalesce(segment, 'medc') = 'medc'
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

    // Risk index per employer (from open signals + size band).
    const bandById = new Map<number, string | null>(employers.map((e) => [e.id, e.band]));
    const sigsByEmp = new Map<number, RiskInput[]>();
    for (const s of signals) {
      if (s.employer_id == null) continue;
      const arr = sigsByEmp.get(s.employer_id) ?? [];
      arr.push({
        signal_type: s.signal_type,
        tier: s.tier,
        priority: s.priority,
        category: s.category,
        date: s.event_date,
      });
      sigsByEmp.set(s.employer_id, arr);
    }
    const scoreByEmployer = new Map<number, RiskResult>();
    for (const [id, sigs] of sigsByEmp) {
      scoreByEmployer.set(id, computeRiskIndex(sigs, bandById.get(id) ?? null));
    }

    // Previous snapshot per employer (older than 12h) for the trend arrow.
    const prevRows = (await sql`
      select distinct on (employer_id) employer_id, score
      from risk_snapshots
      where taken_at < now() - interval '12 hours'
      order by employer_id, taken_at desc
    `) as { employer_id: number; score: number }[];
    const prevScoreByEmployer = new Map<number, number>(prevRows.map((r) => [r.employer_id, r.score]));

    const kpis: Kpis = {
      employers: employers.length,
      risks: signals.filter((s) => s.signal_type === "risk").length,
      growth: signals.filter((s) => s.signal_type === "growth").length,
      outreach: signals.length,
    };

    return {
      state: "ok",
      signals,
      employers,
      statusByEmployer,
      scoreByEmployer,
      prevScoreByEmployer,
      kpis,
    };
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
          <h1>McKinney Watchtower</h1>
          <div className="tag">
            Business Retention and Expansion Monitor
          </div>
        </div>
      </header>

      {data.state === "unconfigured" && <UnconfiguredNotice />}
      {data.state === "error" && <ErrorNotice message={data.message} />}

      {data.state === "ok" && (
        <>
          <Banner kpis={data.kpis} top={data.signals[0]} />

          <section className="kpis">
            <Kpi label="Notable employers" value={data.kpis.employers} icon={<BuildingIcon />} />
            <Kpi label="Active risks" value={data.kpis.risks} tone="risk" icon={<AlertIcon />} />
            <Kpi label="Growth signals" value={data.kpis.growth} tone="growth" icon={<TrendIcon />} />
            <Kpi label="Needs outreach" value={data.kpis.outreach} tone="watch" icon={<PulseIcon />} />
          </section>

          <div className="grid">
            <main>
              <div className="col-head">Action queue · by priority</div>
              <Legend />
              <ActionQueue signals={data.signals} />
            </main>

            <aside>
              <div className="col-head">Notable Employers (Tracked by MEDC)</div>
              <Watchlist
                employers={data.employers}
                statusByEmployer={data.statusByEmployer}
                scoreByEmployer={data.scoreByEmployer}
                prevScoreByEmployer={data.prevScoreByEmployer}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function Banner({ kpis, top }: { kpis: Kpis; top: SignalRow | undefined }) {
  const lead =
    kpis.risks > 0 && top
      ? `${top.company} is your top priority right now (${top.category}).`
      : kpis.outreach > 0
      ? `${kpis.outreach} open signal${kpis.outreach === 1 ? "" : "s"} to review across notable employers.`
      : "The desk is clear. No open signals right now.";

  return (
    <div className="banner">
      <div className="banner-main">
        <h2>Here&rsquo;s where things stand.</h2>
        <p>{lead}</p>
      </div>
      <div className="banner-actions">
        <span className="pill">
          <PulseIcon /> {kpis.outreach} open
        </span>
        <form action={pullFeeds}>
          <PullButton />
        </form>
      </div>
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

interface QueueGroup {
  key: string;
  employerId: number | null;
  company: string;
  status: SigType;
  count: number;
  topPriority: number;
  categories: string[];
  topSummary: string;
  topDateMs: number; // freshest event date in the group
  topDateIso: string;
}

const SEV: Record<SigType, number> = { risk: 3, growth: 2, neutral: 1 };

// One row per company: collapse a company's many signals into a single entry
// carrying its most-severe status, reason count, top priority, and the date of
// its freshest signal.
function groupSignals(signals: SignalRow[]): QueueGroup[] {
  const now = Date.now();
  const buckets = new Map<string, SignalRow[]>();
  for (const s of signals) {
    const key = s.employer_id != null ? `e${s.employer_id}` : `n:${s.company.toLowerCase()}`;
    const arr = buckets.get(key);
    if (arr) arr.push(s);
    else buckets.set(key, [s]);
  }

  const groups: QueueGroup[] = [];
  for (const [key, arr] of buckets) {
    const top = arr.reduce((a, b) => (b.priority > a.priority ? b : a));
    const status = arr.reduce<SigType>(
      (acc, s) => (SEV[s.signal_type] > SEV[acc] ? s.signal_type : acc),
      "neutral"
    );
    const times = arr.map((s) => new Date(s.event_date).getTime()).filter((t) => !Number.isNaN(t));
    const topDateMs = times.length ? Math.max(...times) : 0;
    groups.push({
      key,
      employerId: top.employer_id,
      company: top.company,
      status,
      count: arr.length,
      topPriority: Math.max(...arr.map((s) => s.priority)),
      categories: [...new Set(arr.map((s) => s.category).filter(Boolean))],
      topSummary: top.summary,
      topDateMs,
      topDateIso: topDateMs ? new Date(topDateMs).toISOString() : "",
    });
  }

  // Rank blends priority, severity, and recency, so older news sinks to the
  // bottom even when its priority is high. Each month of age costs ~6 points.
  const rank = (g: QueueGroup) => {
    const sevBonus = g.status === "risk" ? 25 : g.status === "growth" ? 12 : 0;
    const ageDays = g.topDateMs ? (now - g.topDateMs) / 86_400_000 : 0;
    const agePenalty = Math.max(0, (ageDays / 30) * 6);
    return g.topPriority + sevBonus - agePenalty;
  };
  groups.sort((a, b) => rank(b) - rank(a));
  return groups;
}

function ActionQueue({ signals }: { signals: SignalRow[] }) {
  const groups = groupSignals(signals);
  if (groups.length === 0) {
    return <div className="empty">No open signals. The desk is clear.</div>;
  }
  return (
    <>
      {groups.map((g) => (
        <QueueGroupRow key={g.key} g={g} />
      ))}
    </>
  );
}

function QueueGroupRow({ g }: { g: QueueGroup }) {
  return (
    <div className={`signal compact ${g.status}`}>
      <div className="sig-top">
        <span className={`sdot ${g.status}`} />
        {g.employerId != null ? (
          <Link className="sig-company link" href={`/employer/${g.employerId}`}>
            {g.company}
          </Link>
        ) : (
          <span className="sig-company">{g.company}</span>
        )}
        {g.count > 1 && <span className="reasons-chip">{g.count} reasons</span>}
        <span className="sig-score" title="top priority">
          {g.topPriority}
        </span>
        {g.employerId != null && (
          <form action={handleEmployer} className="mark-form">
            <input type="hidden" name="employerId" value={g.employerId} />
            <button className="handle sm" type="submit" title="Mark all handled">
              <CheckIcon />
            </button>
          </form>
        )}
      </div>

      <div className="sig-body clamp">{g.topSummary}</div>

      <div className="sig-meta">
        {g.topDateIso && <span className="sig-date">{fmtDate(g.topDateIso)}</span>}
        {g.categories.length > 0 && (
          <span className="sig-src">{g.categories.slice(0, 3).join(" · ")}</span>
        )}
        {g.employerId != null && (
          <Link className="src-link" href={`/employer/${g.employerId}`}>
            view all reasons →
          </Link>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span className="legend-item">
        <span className="sdot risk" /> Risk — retention concern
      </span>
      <span className="legend-item">
        <span className="sdot growth" /> Growth — expansion to support
      </span>
      <span className="legend-item">
        <span className="sdot neutral" /> Watch — review, often needs confirming
      </span>
      <span className="legend-note">Number is priority (0 to 100).</span>
    </div>
  );
}

function Watchlist({
  employers,
  statusByEmployer,
  scoreByEmployer,
  prevScoreByEmployer,
}: {
  employers: EmployerRow[];
  statusByEmployer: Map<number, Status>;
  scoreByEmployer: Map<number, RiskResult>;
  prevScoreByEmployer: Map<number, number>;
}) {
  if (employers.length === 0) {
    return <div className="empty">No notable employers yet. Run the seed migrations.</div>;
  }

  const bands = [...new Set(employers.map((e) => e.band ?? "Other"))].sort(
    (a, b) => bandRank(a === "Other" ? null : a) - bandRank(b === "Other" ? null : b)
  );

  return (
    <>
      {bands.map((band) => {
        const firms = employers
          .filter((e) => (e.band ?? "Other") === band)
          .sort((a, b) => (scoreByEmployer.get(b.id)?.score ?? 0) - (scoreByEmployer.get(a.id)?.score ?? 0));
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
              const risk = scoreByEmployer.get(e.id);
              const trend = risk ? trendArrow(risk.score, prevScoreByEmployer.get(e.id) ?? null) : undefined;
              return (
                <Link className="emp emp-link" key={e.id} href={`/employer/${e.id}`}>
                  <span className={`dot ${st}`} />
                  <div className="info">
                    <div className="name">{e.name}</div>
                    {e.sector && <div className="sector">{e.sector}</div>}
                  </div>
                  {risk && (risk.level === "growth" || risk.level === "stable") ? (
                    <span className={`status ${st}`}>{statusLabel(st)}</span>
                  ) : risk ? (
                    <RiskBadge score={risk.score} level={risk.level} trend={trend} />
                  ) : (
                    <span className={`status ${st}`}>{statusLabel(st)}</span>
                  )}
                </Link>
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
