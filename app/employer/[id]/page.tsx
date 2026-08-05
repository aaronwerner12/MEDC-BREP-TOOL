import Link from "next/link";
import { sql } from "@/lib/db";
import { BREP_CATEGORIES } from "@/lib/brep";
import { ensureSchema } from "@/lib/setup";
import {
  computeRiskIndex,
  trendArrow,
  riskLevelLabel,
  riskLevelRead,
  FRESHNESS_MONTHS,
} from "@/lib/risk";
import { parseProfile } from "@/lib/profile";
import { parseBrief } from "@/lib/brief";
import { BriefButton } from "../../brief-button";
import { ProfileButton } from "../../profile-button";
import { NewsButton } from "../../news-button";

export const dynamic = "force-dynamic";

// Browser tab title: the company's name, so open employer tabs are tellable
// apart. Falls back to a generic title if the lookup fails.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  const employerId = Number(id);
  if (!Number.isFinite(employerId)) return { title: "Employer" };
  try {
    const rows = (await sql`
      select coalesce(official_name, name) as name from employers where id = ${employerId}
    `) as { name: string }[];
    return { title: rows[0]?.name ?? "Employer" };
  } catch {
    return { title: "Employer" };
  }
}

type SigType = "risk" | "growth" | "neutral";

interface Employer {
  id: number;
  name: string;
  band: string | null;
  sector: string | null;
  aliases: string[];
  official_name: string | null;
  brief: string | null;
  brief_at: string | null;
  profile: string | null;
  profile_at: string | null;
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
  event_date: string;
  handled: boolean;
}

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

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function trendLabel(t: "up" | "down" | "flat" | "new"): string {
  return t === "up" ? "↑ rising" : t === "down" ? "↓ improving" : t === "flat" ? "steady" : "new";
}

async function readEmployer(
  employerId: number
): Promise<{ employer?: Employer; signals: Signal[] }> {
  const employer = (
    (await sql`
      select id, name, band, sector, aliases, official_name, brief, brief_at, profile, profile_at
      from employers where id = ${employerId}
    `) as Employer[]
  )[0];
  if (!employer) return { employer: undefined, signals: [] };

  const signals = (await sql`
    select id, signal_type, priority, category, summary, recommended_action,
           talking_point, tier, source, source_url, scored_at,
           coalesce(event_date, scored_at) as event_date, handled
    from signals
    where employer_id = ${employerId}
    order by handled asc, priority desc, scored_at desc
  `) as Signal[];

  return { employer, signals };
}

export default async function EmployerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employerId = Number(id);

  if (!Number.isFinite(employerId)) {
    return <NotFound />;
  }

  let result: { employer?: Employer; signals: Signal[] };
  try {
    result = await readEmployer(employerId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Self-heal if a table or column is missing (e.g. the brief columns on a
    // database provisioned before this feature).
    if (/does not exist/i.test(msg)) {
      try {
        await ensureSchema();
        result = await readEmployer(employerId);
      } catch {
        return <NotFound />;
      }
    } else {
      return <NotFound />;
    }
  }

  const { employer, signals } = result;
  if (!employer) return <NotFound />;

  const handled = signals.filter((s) => s.handled);
  const openAll = signals.filter((s) => !s.handled);

  // Only recent events count toward the checkup; older ones are shown separately.
  const freshMs = FRESHNESS_MONTHS * 30.44 * 86_400_000;
  const isFresh = (s: Signal) => {
    const t = new Date(s.event_date).getTime();
    return Number.isNaN(t) ? true : Date.now() - t <= freshMs;
  };
  const open = openAll.filter(isFresh);
  const openStale = openAll.filter((s) => !isFresh(s));

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

  // Retention risk index for this employer, plus the trend vs. the last snapshot.
  const riskResult = computeRiskIndex(
    open.map((s) => ({
      signal_type: s.signal_type,
      tier: s.tier,
      priority: s.priority,
      category: s.category,
      date: s.event_date,
    })),
    employer.band
  );
  let prevScore: number | null = null;
  try {
    const pr = (await sql`
      select score from risk_snapshots
      where employer_id = ${employer.id} and taken_at < now() - interval '12 hours'
      order by taken_at desc limit 1
    `) as { score: number }[];
    prevScore = pr[0]?.score ?? null;
  } catch {
    prevScore = null;
  }
  const trend = trendArrow(riskResult.score, prevScore);

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>{employer.official_name || employer.name}</h1>
          <div className="tag">
            {employer.band ? `${employer.band} employees` : "Watchlist employer"}
            {employer.sector ? ` · ${employer.sector}` : ""}
            {employer.official_name &&
              employer.official_name.toLowerCase() !== employer.name.toLowerCase() &&
              ` · entered as ${employer.name}`}
          </div>
        </div>
        <div className="spacer" />
        <Link className="pill" href="/">
          ← Back to desk
        </Link>
      </header>

      {(() => {
        // Wording is driven by the calibrated retention-risk level, not by a raw
        // count of risk signals, so "At risk" is reserved for real threats.
        const statusClass = riskResult.level;
        const statusText = riskLevelLabel(riskResult.level);
        const read = riskLevelRead(riskResult.level);
        return (
          <div className="health card">
            <div className={`risk-index ${riskResult.level}`}>
              <div className="ri-num">{riskResult.score}</div>
              <div className="ri-meta">
                <span className="ri-label">Risk index</span>
                <span className="ri-level">{riskLevelLabel(riskResult.level)}</span>
                <span className="ri-trend">{trendLabel(trend)}</span>
              </div>
            </div>
            <div className="health-main">
              <span className={`health-status ${statusClass}`}>{statusText}</span>
              <p className="health-read">{read}</p>
              {employer!.aliases?.length > 0 && (
                <p className="emp-aliases">Also known as: {employer!.aliases.join(", ")}</p>
              )}
            </div>
            <div className="health-stats">
              <div className="hstat">
                <div className="hnum">{open.length}</div>
                <div className="hlab">Open signals</div>
              </div>
              <div className="hstat">
                <div className="hnum brick">{risks.length}</div>
                <div className="hlab">Risk</div>
              </div>
              <div className="hstat">
                <div className="hnum mint">{positives.length}</div>
                <div className="hlab">Growth</div>
              </div>
              <div className="hstat">
                <div className="hnum">{activeCategories.size}</div>
                <div className="hlab">Active areas</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Company profile. Free-first: Wikidata firmographics, with an optional
          AI web lookup as fallback when enabled. */}
      <div className="brief card" style={{ borderLeftColor: "var(--navy)" }}>
        <div className="brief-head">
          <span className="brief-title">Company profile</span>
          <div className="brief-actions">
            {employer.profile_at && (
              <span className="brief-when">Updated {fmtDate(employer.profile_at)}</span>
            )}
            <ProfileButton employerId={employer.id} hasProfile={!!employer.profile} />
          </div>
        </div>
        {employer.profile ? (
          (() => {
            const { fields, text } = parseProfile(employer.profile);
            return (
              <>
                {fields.length > 0 ? (
                  <dl className="profile-list">
                    {fields.map((f) => (
                      <div className="profile-row" key={f.label}>
                        <dt className="profile-label">{f.label}</dt>
                        <dd className="profile-value">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="brief-body" style={{ whiteSpace: "pre-line" }}>
                    {text}
                  </p>
                )}
                <p className="brief-when" style={{ marginTop: 8 }}>
                  From public web sources. Verify before using in any public document.
                </p>
              </>
            );
          })()
        ) : (
          <p className="brief-body muted">
            No profile yet. Look up public business info (location, employees, executives,
            ownership). Free, from public sources (Wikidata, OpenCorporates, Google, the company
            site).
          </p>
        )}
        <ProfileSources />
      </div>

      {/* Briefing, grounded in this employer's own signals. Free rules-based
          synthesis by default; AI prose as an upgrade when enabled. */}
      <div className="brief card">
        <div className="brief-head">
          <span className="brief-title">Briefing</span>
          <div className="brief-actions">
            {employer.brief_at && (
              <span className="brief-when">Updated {fmtDate(employer.brief_at)}</span>
            )}
            <BriefButton employerId={employer.id} hasBrief={!!employer.brief} />
          </div>
        </div>
        {employer.brief ? (
          (() => {
            const { fields, text } = parseBrief(employer.brief);
            return fields.length > 0 ? (
              <dl className="profile-list">
                {fields.map((f) => (
                  <div className="profile-row" key={f.label}>
                    <dt className="profile-label">{f.label}</dt>
                    <dd className="profile-value">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="brief-body">{text}</p>
            );
          })()
        ) : (
          <p className="brief-body muted">
            No briefing yet. Generate one to get a short, grounded read of this employer&rsquo;s
            current signals.
          </p>
        )}
      </div>

      {/* Free Google News scan. Results land as indicative signals below and in
          the queue. No API key needed. */}
      <div className="brief card" style={{ borderLeftColor: "var(--sunflower)" }}>
        <div className="brief-head">
          <span className="brief-title">Recent news</span>
          <div className="brief-actions">
            <NewsButton employerId={employer.id} />
          </div>
        </div>
        <p className="brief-body muted">
          Scan Google News for recent material coverage (layoffs, expansions, M&amp;A, leadership,
          litigation). Free. Results appear as indicative signals in the queue and below (confirm
          before outreach).
        </p>
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

      {openStale.length > 0 && (
        <>
          <div className="col-head" style={{ marginTop: 24 }}>
            Older signals · not counted (over {FRESHNESS_MONTHS} months)
          </div>
          {openStale.map((s) => (
            <div className="handled-row" key={s.id}>
              <span className={`dot ${s.signal_type === "risk" ? "risk" : s.signal_type === "growth" ? "growth" : "watch"}`} />
              <span className="hr-cat">{s.category}</span>
              <span className="hr-sum">{s.summary}</span>
              <span className="hr-date">{fmtDate(s.event_date)}</span>
            </div>
          ))}
        </>
      )}

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

// Shows which free profile sources are active, so it is clear at a glance
// whether the optional (free) keys are wired up. Wikidata and the website need
// no key; OpenCorporates and Google need a free key each.
function ProfileSources() {
  const oc = !!process.env.OPENCORPORATES_API_TOKEN;
  const google = !!(process.env.GOOGLE_KG_API_KEY || process.env.GOOGLE_PLACES_API_KEY);
  const items: { name: string; on: boolean }[] = [
    { name: "Wikidata", on: true },
    { name: "OpenCorporates", on: oc },
    { name: "Google", on: google },
    { name: "Website", on: true },
  ];
  const missing = [!oc && "OpenCorporates", !google && "Google"].filter(Boolean) as string[];
  return (
    <p className="profile-sources">
      <span className="ps-label">Free sources:</span>{" "}
      {items.map((it, i) => (
        <span key={it.name} className={it.on ? "ps-on" : "ps-off"}>
          {it.name} {it.on ? "✓" : "○"}
          {i < items.length - 1 ? "  ·  " : ""}
        </span>
      ))}
      {missing.length > 0 && (
        <span className="ps-hint">
          {" "}
          Add the {missing.join(" and ")} key{missing.length > 1 ? "s" : ""} to cover small private
          firms for free.
        </span>
      )}
    </p>
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
