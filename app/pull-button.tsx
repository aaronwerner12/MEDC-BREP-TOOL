"use client";

import { useState, useTransition } from "react";
import { pullFeeds } from "./actions";

type PullReport = Awaited<ReturnType<typeof pullFeeds>>;

export function PullButton() {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<PullReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setReport(null);
    startTransition(async () => {
      try {
        setReport(await pullFeeds());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Feed pull failed. Check Vercel function logs.");
      }
    });
  }

  return (
    <div>
      <button className="btn-primary" type="button" onClick={run} disabled={pending}>
        {pending ? "Pulling feeds…" : "Pull feeds now"}
      </button>
      {error && <p role="alert" style={{ color: "#9E4A33" }}>Feed pull failed: {error}</p>}
      {report && (
        <section aria-live="polite" style={{ marginTop: 12, padding: 12, border: "1px solid #b8c9cc", borderRadius: 8 }}>
          <strong>Feed results</strong>
          <div style={{ fontSize: 12 }}>Completed {new Date(report.completedAt).toLocaleString()}</div>
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            {report.results.map((r) => (
              <li key={r.source}>
                <strong>{r.source}</strong>: {r.error
                  ? <span style={{ color: "#9E4A33" }}>Error: {r.error}</span>
                  : <span>{r.found ?? 0} found, {r.inserted ?? 0} new{r.dropped ? `, ${r.dropped} capped` : ""}</span>}
              </li>
            ))}
          </ul>
          <small>0 new can mean no matching items or previously imported items. Feed errors require investigation.</small>
        </section>
      )}
    </div>
  );
}
