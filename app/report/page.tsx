import Link from "next/link";
import { EdcMark } from "../edc-mark";
import { ensureSchema } from "@/lib/setup";
import { buildIntelReport, type IntelReport, type ReportItem, type DevType } from "@/lib/report";

export const metadata = { title: "Report" };
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 14;

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function badgeClass(t: DevType): string {
  return t === "neutral" ? "watch" : t;
}
function badgeLabel(t: DevType): string {
  return t === "risk" ? "Risk" : t === "growth" ? "Growth" : "Watch";
}

async function load(): Promise<IntelReport | null> {
  try {
    return await buildIntelReport(WINDOW_DAYS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(msg)) {
      try {
        await ensureSchema();
        return await buildIntelReport(WINDOW_DAYS);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default async function ReportPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <div className="wrap">
        <div className="notice" style={{ marginTop: 28 }}>
          <h3>Database not connected</h3>
        </div>
      </div>
    );
  }

  const report = await load();
  const items = report?.items ?? [];
  const riskCount = items.filter((i) => i.status === "risk").length;
  const growthCount = items.filter((i) => i.status === "growth").length;

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <EdcMark />
        </div>
        <div>
          <h1>Intelligence report</h1>
          <div className="tag">What changed across tracked employers in the last {WINDOW_DAYS} days</div>
        </div>
      </header>

      <div className="section-head">
        <div className="section-headings">
          <h2 className="section-title">Developments</h2>
          <p className="section-sub">
            {items.length > 0
              ? `${items.length} compan${items.length === 1 ? "y" : "ies"} with activity · ` +
                `${report?.totalDevelopments ?? 0} signal${(report?.totalDevelopments ?? 0) === 1 ? "" : "s"}`
              : "No activity in this window"}
          </p>
        </div>
        <div className="section-meta">
          <div className="rep-stats">
            <span className="stat risk">{riskCount} risk</span>
            <span className="stat growth">{growthCount} growth</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          Nothing new in the last {WINDOW_DAYS} days. As feeds run, developments will appear here.
        </div>
      ) : (
        <div className="rep-list">
          {items.map((item) => (
            <ReportCard key={item.employerId ?? item.company} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ item }: { item: ReportItem }) {
  return (
    <section className={`rep-item ${item.status}`}>
      <div className="rep-head">
        <div className="rep-title">
          {item.employerId != null ? (
            <Link className="rep-company link" href={`/employer/${item.employerId}`}>
              {item.company}
            </Link>
          ) : (
            <span className="rep-company">{item.company}</span>
          )}
          {item.band && <span className="rep-band">{item.band}</span>}
        </div>
        <span className={`badge ${badgeClass(item.status)}`}>{badgeLabel(item.status)}</span>
      </div>

      {(item.hq || item.local) && (
        <div className="place-lines rep-place">
          {item.hq && (
            <div className="hq-line">
              <PinIcon />
              <span>
                <span className="place-lbl">HQ</span> {item.hq}
              </span>
            </div>
          )}
          {item.local && item.local !== item.hq && (
            <div className="hq-line">
              <BuildingIcon />
              <span>
                <span className="place-lbl">McKinney</span> {item.local}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="rep-headline">{item.headline}</p>

      <ul className="rep-devs">
        {item.developments.map((d, i) => (
          <li key={i} className={`rep-dev ${badgeClass(d.type)}`}>
            <span className="rep-dev-date">{fmtDate(d.date)}</span>
            <span className="rep-dev-body">
              <span className="rep-dev-cat">{d.category}</span>
              {d.summary}
              {d.tier === "indicative" && (
                <span className="rep-dev-confirm"> Indicative — confirm before outreach.</span>
              )}
              {d.sourceUrl && (
                <>
                  {" "}
                  <a className="rep-dev-src" href={d.sourceUrl} target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const sp = {
  width: 12,
  height: 12,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
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
