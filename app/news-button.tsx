"use client";

import { useState, useTransition } from "react";
import { scanNews } from "./actions";

// Triggers a web news scan for an employer and reports how many items landed.
export function NewsButton({ employerId }: { employerId: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="news-scan">
      <button
        className="handle"
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await scanNews(employerId);
            setMsg(
              r.ok
                ? r.added
                  ? `Added ${r.added} news item${r.added === 1 ? "" : "s"}.`
                  : "No new significant news found."
                : r.error ?? "Scan failed."
            );
          })
        }
      >
        {pending ? "Scanning news…" : "Scan for news"}
      </button>
      {msg && (
        <span className="brief-when" style={{ marginLeft: 8 }}>
          {msg}
        </span>
      )}
    </span>
  );
}
