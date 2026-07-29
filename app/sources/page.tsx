import Link from "next/link";
import { BREP_CATEGORIES } from "@/lib/brep";
import { SOURCES } from "@/lib/sources";

export const dynamic = "force-static";

// Which BREP categories are covered by at least one LIVE source.
const liveCovered = new Set(
  SOURCES.filter((s) => s.status === "live").flatMap((s) => s.covers)
);

export default function SourcesPage() {
  const live = SOURCES.filter((s) => s.status === "live");
  const planned = SOURCES.filter((s) => s.status === "planned");

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>Sources</h1>
          <div className="tag">Where the desk gets its signals</div>
        </div>
        <div className="spacer" />
        <Link className="pill" href="/">
          ← Back to desk
        </Link>
      </header>

      <div className="col-head">Live feeds · {live.length}</div>
      <div className="src-grid">
        {live.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </div>

      <div className="col-head" style={{ marginTop: 28 }}>
        Planned · {planned.length}
      </div>
      <div className="src-grid">
        {planned.map((s) => (
          <SourceCard key={s.name} s={s} />
        ))}
      </div>

      <div className="col-head" style={{ marginTop: 28 }}>
        BREP coverage
      </div>
      <div className="card src-table-wrap">
        <table className="src-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Healthy signs</th>
              <th>Risk indicators</th>
              <th>Public sources</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody>
            {BREP_CATEGORIES.map((c) => {
              const covered = liveCovered.has(c.category);
              return (
                <tr key={c.category}>
                  <td className="cat">{c.category}</td>
                  <td>{c.healthy}</td>
                  <td>{c.risk}</td>
                  <td className="muted">{c.sources}</td>
                  <td>
                    <span className={`cov ${covered ? "live" : "planned"}`}>
                      {covered ? "Live" : "Planned"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="src-note">
        Authoritative sources can drive action directly. Indicative sources (web scan, reviews,
        job boards) need a human to confirm before any outreach or public document.
      </p>
    </div>
  );
}

function SourceCard({ s }: { s: (typeof SOURCES)[number] }) {
  return (
    <div className="src-card card">
      <div className="src-card-head">
        <span className="src-name">{s.name}</span>
        <span className={`chip tier-${s.tier}`}>{s.tier}</span>
      </div>
      <div className="src-meta">{s.cadence}</div>
      <p className="src-detail">{s.detail}</p>
      <div className="src-covers">
        {s.covers.map((c) => (
          <span className="covers-chip" key={c}>
            {c}
          </span>
        ))}
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
