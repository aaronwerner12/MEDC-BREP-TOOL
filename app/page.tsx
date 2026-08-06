import Link from "next/link";
import { EdcMark } from "./edc-mark";
import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import {
  computeRiskIndex,
  trendArrow,
  FRESHNESS_MONTHS,
  WATCH_DAYS,
  type RiskInput,
  type RiskResult,
} from "@/lib/risk";
import { handleEmployer, pullFeeds } from "./actions";
import { PullButton } from "./pull-button";
import { RiskBadge } from "./risk-badge";
import { parseProfile } from "@/lib/profile";

// Pull the resolved headquarters location out of an employer's stored profile
// (real, sourced data from the free profile chain, never fabricated). Returns
// null when no profile or no verified HQ is on file.
function hqFromProfile(profile: string | null): string | null {
  const { fields } = parseProfile(profile);
  const hq = fields.find((f) => f.label === "Headquarters");
  return hq && hq.value ? hq.value : null;
}

// The desk uses the layout's default title, so its tab reads
// "McKinney Business Retention & Expansion Monitor" with no suffix.

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

interface Workflow {
  openFollowups: number;
  overdueFollowups: number;
  visitsDue: number;
}

type DeskData =
  | {
      state: "ok";
      signals: SignalRow[];
      employers: EmployerRow[];
      statusByEmployer: Map<number, Status>;
      scoreByEmployer: Map<number, RiskResult>;
      prevScoreByEmployer: Map<number, number>;
      hqByEmployer: Map<number, string>;
      kpis: Kpis;
      workflow: Workflow;
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

    // Headquarters per employer, parsed from stored profiles. Bounded to the
    // employers actually shown (watchlist + anyone appearing in open signals).
    const hqByEmployer = new Map<number, string>();
    const empIds = new Set<number>(employers.map((e) => e.id));
    for (const s of signals) if (s.employer_id != null) empIds.add(s.employer_id);
    const idList = [...empIds];
    if (idList.length) {
      const profRows = (await sql`
        select id, profile from employers
        where id = any(${idList}) and profile is not null
      `) as { id: number; profile: string | null }[];
      for (const r of profRows) {
        const hq = hqFromProfile(r.profile);
        if (hq) hqByEmployer.set(r.id, hq);
      }
    }

    const kpis: Kpis = {
      employers: employers.length,
      risks: signals.filter((s) => s.signal_type === "risk").length,
      growth: signals.filter((s) => s.signal_type === "growth").length,
      outreach: signals.length,
    };

    // BRE workflow counts: open follow-ups (and overdue), plus notable employers
    // due for a visit (no visit logged in the last cadence window).
    const fu = (await sql`
      select
        count(*)::int as open,
        count(*) filter (where due_date is not null and due_date < current_date)::int as overdue
      from flags where status = 'open'
    `) as { open: number; overdue: number }[];
    const vd = (await sql`
      select count(*)::int as n
      from employers e
      where e.active = true and coalesce(e.segment, 'medc') = 'medc'
        and not exists (
          select 1 from visits v
          where v.employer_id = e.id and v.visited_on >= current_date - interval '12 months'
        )
    `) as { n: number }[];
    const workflow: Workflow = {
      openFollowups: fu[0]?.open ?? 0,
      overdueFollowups: fu[0]?.overdue ?? 0,
      visitsDue: vd[0]?.n ?? 0,
    };

    return {
      state: "ok",
      signals,
      employers,
      statusByEmployer,
      scoreByEmployer,
      prevScoreByEmployer,
      hqByEmployer,
      kpis,
      workflow,
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
          <EdcMark />
        </div>
        <div>
          <h1>McKinney Business Retention &amp; Expansion Monitor</h1>
          <div className="tag">
            Early warning, visits, and follow-up for local employers
          </div>
        </div>
      </header>

      {data.state === "unconfigured" && <UnconfiguredNotice />}
      {data.state === "error" && <ErrorNotice message={data.message} />}

      {data.state === "ok" && (
        <>
          <DailyBriefing kpis={data.kpis} workflow={data.workflow} signals={data.signals} />

          <TopWatch signals={data.signals} hqByEmployer={data.hqByEmployer} />

          <div className="grid">
            <main className="section">
              <SectionHead
                title="Action queue"
                sub="Every open item, most material first. One row per company."
              />
              <Legend />
              <ActionQueue signals={data.signals} hqByEmployer={data.hqByEmployer} />
            </main>

            <aside className="section">
              <SectionHead title="Notable employers" sub="Tracked by MEDC, grouped by size." />
              <Watchlist
                employers={data.employers}
                statusByEmployer={data.statusByEmployer}
                scoreByEmployer={data.scoreByEmployer}
                prevScoreByEmployer={data.prevScoreByEmployer}
                hqByEmployer={data.hqByEmployer}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// A prominent, consistent header for every desk section: a big title, a
// one-line subtitle, and optional right-aligned meta (a legend, an action).
function SectionHead({
  title,
  sub,
  meta,
}: {
  title: string;
  sub?: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div className="section-headings">
        <h2 className="section-title">{title}</h2>
        {sub && <p className="section-sub">{sub}</p>}
      </div>
      {meta && <div className="section-meta">{meta}</div>}
    </div>
  );
}

interface Todo {
  tone: "risk" | "watch" | "neutral";
  text: string;
  href: string;
}

// The lead of the desk: a plain-language read of what matters today plus the
// concrete next steps, built only from real workflow state and open signals.
// Absorbs the old summary banner, KPI tiles, and workflow strip into one
// action-first block, so each fact appears once.
function DailyBriefing({
  kpis,
  workflow,
  signals,
}: {
  kpis: Kpis;
  workflow: Workflow;
  signals: SignalRow[];
}) {
  const today = fmtDate(new Date().toISOString());
  const topRisk = groupSignals(signals).find((g) => g.status === "risk");
  const s = (n: number) => (n === 1 ? "" : "s");

  const headline =
    workflow.overdueFollowups > 0
      ? "You have overdue follow-ups. Start there."
      : topRisk
      ? `${topRisk.company} needs a look today.`
      : workflow.visitsDue > 0
      ? "Time to line up a retention visit."
      : kpis.outreach > 0
      ? `${kpis.outreach} open signal${s(kpis.outreach)} to review.`
      : "The desk is clear. Nothing needs action today.";

  const todos: Todo[] = [];
  if (topRisk) {
    todos.push({
      tone: "risk",
      text: `Review ${topRisk.company} — top retention concern${
        topRisk.categories[0] ? ` (${topRisk.categories[0]})` : ""
      }`,
      href: topRisk.employerId != null ? `/employer/${topRisk.employerId}` : "#",
    });
  }
  if (workflow.openFollowups > 0) {
    todos.push({
      tone: workflow.overdueFollowups > 0 ? "risk" : "neutral",
      text:
        `${workflow.openFollowups} open follow-up${s(workflow.openFollowups)}` +
        (workflow.overdueFollowups > 0 ? ` — ${workflow.overdueFollowups} overdue` : ""),
      href: "/followups",
    });
  }
  if (workflow.visitsDue > 0) {
    todos.push({
      tone: "watch",
      text: `${workflow.visitsDue} notable employer${s(workflow.visitsDue)} due for a retention visit`,
      href: "/followups",
    });
  }

  return (
    <section className="brief">
      <div className="brief-top">
        <span className="brief-eyebrow">What to do today · {today}</span>
        <div className="statline">
          <span className="stat"><BuildingIcon /> {kpis.employers} tracked</span>
          <span className="stat risk"><AlertIcon /> {kpis.risks} risk{s(kpis.risks)}</span>
          <span className="stat growth"><TrendIcon /> {kpis.growth} growth</span>
          <span className="stat watch"><PulseIcon /> {kpis.outreach} open</span>
        </div>
      </div>

      <h2 className="brief-headline">{headline}</h2>

      {todos.length > 0 ? (
        <ul className="brief-todos">
          {todos.map((t, i) => (
            <li key={i}>
              <Link className={`brief-todo ${t.tone}`} href={t.href}>
                <span className={`sdot ${t.tone === "neutral" ? "neutral" : t.tone}`} />
                <span className="brief-todo-text">{t.text}</span>
                <span className="brief-todo-go">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="brief-clear">
          No open follow-ups or visits due. {kpis.outreach > 0
            ? `${kpis.outreach} signal${s(kpis.outreach)} below to skim when you have a moment.`
            : "Nothing in the queue."}
        </p>
      )}

      <div className="brief-actions">
        <Link className="brief-worksheet" href="/followups">
          Open the retention worksheet →
        </Link>
        <form action={pullFeeds}>
          <PullButton />
        </form>
      </div>
    </section>
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

// The top few open items right now as scannable card blocks, ranked by severity
// + recency so a fresh risk or a new material headline surfaces first. One card
// per company. Bounded to recent activity (WATCH_DAYS) so stale items never
// pose as a current priority.
function TopWatch({
  signals,
  hqByEmployer,
}: {
  signals: SignalRow[];
  hqByEmployer: Map<number, string>;
}) {
  const cutoff = Date.now() - WATCH_DAYS * 86_400_000;
  const top = groupSignals(signals)
    .filter((g) => g.topDateMs >= cutoff)
    .slice(0, 5);
  const labelFor = (s: SigType) => (s === "risk" ? "Risk" : s === "growth" ? "Growth" : "Watch");
  const months = Math.round(WATCH_DAYS / 30);

  return (
    <section className="topwatch section">
      <SectionHead
        title="Top things to watch"
        sub={
          top.length > 0
            ? `The ${top.length} biggest items with activity in the last ${months} months`
            : `Nothing new in the last ${months} months`
        }
      />

      {top.length === 0 ? (
        <div className="card empty" style={{ marginTop: 8 }}>
          No recent priorities. Nothing with activity in the last {months} months.
        </div>
      ) : (
        <div className="tw-grid">
          {top.map((g, i) => {
            const badge = g.status === "neutral" ? "watch" : g.status;
            const inner = (
              <>
                <div className="twc-top">
                  <span className="twc-rank">{i + 1}</span>
                  <span className={`badge ${badge}`}>{labelFor(g.status)}</span>
                  {g.topDateIso && <span className="twc-date">{fmtDate(g.topDateIso)}</span>}
                </div>
                <div className="twc-company">{g.company}</div>
                {g.categories[0] && <div className="twc-cat">{g.categories[0]}</div>}
                {g.employerId != null && hqByEmployer.get(g.employerId) && (
                  <div className="hq-line">
                    <PinIcon /> {hqByEmployer.get(g.employerId)}
                  </div>
                )}
                <div className="twc-reason">{g.topSummary}</div>
                <div className="twc-foot">
                  {g.count > 1 ? `${g.count} open signals` : "1 open signal"}
                  {g.employerId != null && <span className="twc-go">View →</span>}
                </div>
              </>
            );
            return g.employerId != null ? (
              <Link className={`twc ${g.status}`} key={g.key} href={`/employer/${g.employerId}`}>
                {inner}
              </Link>
            ) : (
              <div className={`twc ${g.status}`} key={g.key}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActionQueue({
  signals,
  hqByEmployer,
}: {
  signals: SignalRow[];
  hqByEmployer: Map<number, string>;
}) {
  const groups = groupSignals(signals);
  if (groups.length === 0) {
    return <div className="empty">No open signals. The desk is clear.</div>;
  }
  return (
    <>
      {groups.map((g) => (
        <QueueGroupRow
          key={g.key}
          g={g}
          hq={g.employerId != null ? hqByEmployer.get(g.employerId) ?? null : null}
        />
      ))}
    </>
  );
}

function QueueGroupRow({ g, hq }: { g: QueueGroup; hq: string | null }) {
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

      {hq && (
        <div className="hq-line">
          <PinIcon /> {hq}
        </div>
      )}

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
  hqByEmployer,
}: {
  employers: EmployerRow[];
  statusByEmployer: Map<number, Status>;
  scoreByEmployer: Map<number, RiskResult>;
  prevScoreByEmployer: Map<number, number>;
  hqByEmployer: Map<number, string>;
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
                    {hqByEmployer.get(e.id) && (
                      <div className="hq-line">
                        <PinIcon /> {hqByEmployer.get(e.id)}
                      </div>
                    )}
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
