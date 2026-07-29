import { sql } from "./db";
import { scoreSignal } from "./score";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import type { NormalizedSignal } from "./types";
import { usaspendingSignals } from "../adapters/usaspending";
import { twcWarnSignals } from "../adapters/twcWarn";

interface FeedDef {
  source: string;
  run: (e: EmployerRow[]) => Promise<NormalizedSignal[]>;
  // Snapshot-style feeds represent current state, not discrete events. For
  // those we clear the existing unhandled rows before inserting the fresh set,
  // so superseded signals (e.g. old per-contract USASpending rows) don't linger.
  replaceUnhandled?: boolean;
}

const FEEDS: FeedDef[] = [
  { source: "usaspending", run: usaspendingSignals, replaceUnhandled: true },
  { source: "twc_warn", run: twcWarnSignals },
];

export interface FeedResult {
  source: string;
  found?: number;
  inserted?: number;
  error?: string;
}

// Run every feed independently: one failing feed does not abort the others.
export async function runAllFeeds(): Promise<FeedResult[]> {
  const employers = await loadEmployers();
  const results: FeedResult[] = [];

  for (const feed of FEEDS) {
    try {
      const raw = await feed.run(employers);

      // Score everything first, so a scoring failure never leaves us having
      // deleted the existing rows without a replacement set.
      const scored = [];
      for (const r of raw) scored.push(await scoreSignal(r, employers));

      if (feed.replaceUnhandled) {
        await sql`delete from signals where source = ${feed.source} and handled = false`;
      }

      let inserted = 0;
      for (const s of scored) if (await ingestSignal(s)) inserted++;

      results.push({ source: feed.source, found: raw.length, inserted });
    } catch (err) {
      results.push({ source: feed.source, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}
