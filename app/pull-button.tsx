"use client";

import { useState, useTransition } from "react";
import { pullFeed } from "./actions";
import type { FeedResult, FeedSource } from "@/lib/pipeline";

const SOURCES: FeedSource[] = ["twc_warn", "sec_edgar", "usaspending", "epa_echo", "news", "mckinney_permits", "job_postings", "texas_sales_tax", "collin_employment", "property_records"];

export function PullButton() {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<FeedResult[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setResults([]);
    setError(null);
    startTransition(async () => {
      // Separate server requests ensure one slow source cannot consume the
      // entire time budget for the other sources.
      for (const source of SOURCES) {
        setCurrent(source);
        try {
          const result = await pullFeed(source);
          setResults((previous) => [...previous, result]);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Server request failed";
          setResults((previous) => [...previous, { source, error: message }]);
          setError("Some feeds failed. Check individual results.");
        }
      }
      setCurrent(null);
    });
  }

  return (
    <div>
      <button className="btn-primary" type="button" onClick={run} disabled={pending}>
        {pending ? `Pulling ${current ?? "feeds"}…` : "Pull feeds now"}
      </button>
      {error && <p role="alert" style={{ color: "#9E4A33" }}>{error}</p>}
      {(results.length > 0 || pending) && (
        <section aria-live="polite" style={{ marginTop: 12, padding: 12, border: "1px solid #b8c9cc", borderRadius: 8 }}>
          <strong>Feed results ({results.length}/{SOURCES.length})</strong>
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            {results.map((r) => (
              <li key={r.source}>
                <strong>{r.source}</strong>: {r.error
                  ? <span style={{ color: "#9E4A33" }}>Error: {r.error}</span>
                  : <span>{r.found ?? 0} found, {r.inserted ?? 0} new{r.dropped ? `, ${r.dropped} capped` : ""}</span>}
              </li>
            ))}
          </ul>
          {pending && <small>Working on {current ?? "next source"}…</small>}
          {!pending && <small>News scans five employers per run. Refresh the dashboard to view newly saved signals.</small>}
        </section>
      )}
    </div>
  );
}
