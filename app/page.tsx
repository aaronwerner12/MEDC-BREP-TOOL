import { sql } from "@/lib/db";
import { markHandled } from "./actions";

// Reads live Neon data, so never prerender at build time.
export const dynamic = "force-dynamic";

interface SignalRow {
  id: number;
  company: string;
  band: string | null;
  signal_type: "risk" | "growth" | "neutral";
  priority: number;
  category: string;
  summary: string;
  recommended_action: string;
  tier: string;
  source: string;
  source_url: string | null;
}

interface EmployerRow {
  id: number;
  name: string;
  band: string | null;
  sector: string | null;
}

type DeskData =
  | { state: "ok"; signals: SignalRow[]; employers: EmployerRow[] }
  | { state: "unconfigured" }
  | { state: "error"; message: string };

// MEDC size bands, largest first.
const BAND_ORDER = ["1,000+", "500+"];

async function loadDesk(): Promise<DeskData> {
  if (!process.env.DATABASE_URL) return { state: "unconfigured" };

  try {
    const signals = (await sql`
      select s.id,
             coalesce(
               e.name,
               s.raw->>'Recipient Name',
               s.raw->>'job_site_name',
               s.raw->>'company_name',
               'Unmatched signal'
             ) as company,
             e.band, s.signal_type, s.priority, s.category, s.summary,
             s.recommended_action, s.tier, s.source, s.source_url
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

    return { state: "ok", signals, employers };
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

function bandRank(band: string | null): number {
  const i = BAND_ORDER.indexOf(band ?? "");
  return i === -1 ? BAND_ORDER.length : i;
}

export default async function Desk() {
  const data = await loadDesk();

  return (
    <>
      <header className="topbar">
        <div className="inner">
          <div>
            <h1>McKinney Signal Desk</h1>
            <div className="sub">Business retention &amp; expansion early-warning</div>
          </div>
          {data.state === "ok" && (
            <div className="sub">
              {data.signals.length} open signal{data.signals.length === 1 ? "" : "s"} ·{" "}
              {data.employers.length} employers watched
            </div>
          )}
        </div>
      </header>

      <div className="wrap">
        {data.state === "unconfigured" && <UnconfiguredNotice />}
        {data.state === "error" && <ErrorNotice message={data.message} />}
        {data.state === "ok" && (
          <div className="grid">
            <main>
              <div className="section-head">
                <h2>Action queue</h2>
                <span className="count">authoritative first, then priority</span>
              </div>
              {data.signals.length === 0 ? (
                <div className="empty">No open signals. The desk is clear.</div>
              ) : (
                data.signals.map((s) => <SignalCard key={s.id} s={s} />)
              )}
            </main>

            <aside>
              <div className="section-head">
                <h2>Watchlist</h2>
                <span className="count">MEDC size band</span>
              </div>
              <Watchlist employers={data.employers} />
            </aside>
          </div>
        )}
      </div>
    </>
  );
}

function SignalCard({ s }: { s: SignalRow }) {
  const type = s.signal_type ?? "neutral";
  return (
    <div className={`signal card ${type}`}>
      <div className="rail" />
      <div className="body">
        <div className="row1">
          <span className="company">{s.company}</span>
          {s.band && <span className="chip band">{s.band}</span>}
          <span className={`chip ${type}`}>{type}</span>
          <span className="chip tier">{s.tier}</span>
          <span className="chip pri">P{s.priority}</span>
        </div>

        <div className="summary">
          {s.category ? <b>{s.category}: </b> : null}
          {s.summary}
        </div>

        {s.recommended_action && (
          <div className="move">
            <b>Move:</b> {s.recommended_action}
          </div>
        )}

        <div className="foot">
          {s.tier === "indicative" && (
            <span className="confirm">Indicative — confirm before outreach</span>
          )}
          {s.source_url && (
            <a className="src" href={s.source_url} target="_blank" rel="noreferrer">
              source ({s.source})
            </a>
          )}
          <form action={markHandled} style={{ marginLeft: "auto" }}>
            <input type="hidden" name="id" value={s.id} />
            <button className="handle" type="submit">
              Mark handled
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Watchlist({ employers }: { employers: EmployerRow[] }) {
  if (employers.length === 0) {
    return <div className="empty">Watchlist is empty. Run the seed migration.</div>;
  }

  const bands = [...new Set(employers.map((e) => e.band ?? "Other"))].sort(
    (a, b) => bandRank(a === "Other" ? null : a) - bandRank(b === "Other" ? null : b)
  );

  return (
    <>
      {bands.map((band) => (
        <div className="band" key={band}>
          <div className="band-label">{band}</div>
          <div className="card">
            {employers
              .filter((e) => (e.band ?? "Other") === band)
              .map((e) => (
                <div className="emp" key={e.id}>
                  <div className="name">{e.name}</div>
                  {e.sector && <div className="sector">{e.sector}</div>}
                </div>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function UnconfiguredNotice() {
  return (
    <div className="notice" style={{ marginTop: 28 }}>
      <h3>Database not connected yet</h3>
      <p>
        The desk is deployed and running, but <code>DATABASE_URL</code> is not set, so there
        is no data to show.
      </p>
      <p>
        Set <code>DATABASE_URL</code> (and the other environment variables from{" "}
        <code>.env.example</code>) in your Vercel project settings, then run the migrations
        against your Neon database:
      </p>
      <p>
        <code>psql "$DATABASE_URL" -f migrations/0001_init.sql</code>
        <br />
        <code>psql "$DATABASE_URL" -f migrations/0002_seed.sql</code>
      </p>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  const looksUnmigrated = /relation .* does not exist|table/i.test(message);
  return (
    <div className="notice err" style={{ marginTop: 28 }}>
      <h3>Could not read the database</h3>
      {looksUnmigrated ? (
        <p>
          The connection works but the tables are missing. Run the migrations:{" "}
          <code>psql "$DATABASE_URL" -f migrations/0001_init.sql</code> then{" "}
          <code>0002_seed.sql</code>.
        </p>
      ) : (
        <p>Check that <code>DATABASE_URL</code> points at a reachable Neon database.</p>
      )}
      <p>
        <code>{message}</code>
      </p>
    </div>
  );
}
