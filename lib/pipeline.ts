import { sql } from "./db";
import { scoreSignalRules } from "./rulesScore";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import type { NormalizedSignal, ScoredSignal } from "./types";
import { computeRiskIndex, FRESHNESS_MONTHS, type RiskInput } from "./risk";
import { usaspendingSignals } from "../adapters/usaspending";
import { twcWarnSignals } from "../adapters/twcWarn";
import { secEdgarSignals } from "../adapters/secEdgar";
import { echoSignals } from "../adapters/echo";
import { googleNewsSignals } from "../adapters/googleNews";

interface FeedDef {
  source: string;
  run: (e: EmployerRow[]) => Promise<NormalizedSignal[]>;
  // Snapshot-style feeds represent current state, not discrete events. For
  // those we clear the existing unhandled rows before inserting the fresh set,
  // so superseded signals (e.g. old per-contract USASpending rows) don't linger.
  replaceUnhandled?: boolean;
  // Per-feed contribution cap. Defaults to MAX_PER_FEED. News fans out across
  // every watchlist employer, so it needs a higher ceiling.
  maxItems?: number;
}

const FEEDS: FeedDef[] = [
  { source: "usaspending", run: usaspendingSignals, replaceUnhandled: true },
  // WARN is a current-year listing we re-fetch whole, so replace unhandled rows
  // each run -- this also retires any previously-ingested neighboring-city
  // notices now that the filter is McKinney-only.
  { source: "twc_warn", run: twcWarnSignals, replaceUnhandled: true },
  { source: "sec_edgar", run: secEdgarSignals },
  // ECHO reflects current compliance state, so replace unhandled rows each run.
  { source: "epa_echo", run: echoSignals, replaceUnhandled: true },
  // Free Google News RSS feed. Discrete articles (no replaceUnhandled); deduped
  // by article id via unique(source, external_id). Higher cap since it spans the
  // whole watchlist.
  { source: "news", run: googleNewsSignals, maxItems: 60 },
];

// Cap how many items each feed contributes so a single pull stays well within
// the serverless time limit. Scoring is now rules-based (synchronous, free), so
// there is no per-item network call to bound.
const MAX_PER_FEED = 15;

export interface FeedResult {
  source: string;
  found?: number;
  inserted?: number;
  dropped?: number;
  error?: string;
}

// Run every feed: fetch all in parallel, score everything with the deterministic
// rules scorer, then write per feed. One failing feed or one failing score never
// aborts the rest. No API key is required.
export async function runAllFeeds(): Promise<FeedResult[]> {
  const employers = await loadEmployers();

  // 1. Fetch all feeds in parallel; cap each feed's contribution.
  const fetched = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const raw = await feed.run(employers);
        const capped = raw.slice(0, feed.maxItems ?? MAX_PER_FEED);
        return { feed, raw: capped, dropped: raw.length - capped.length, error: null as string | null };
      } catch (err) {
        return { feed, raw: [] as NormalizedSignal[], dropped: 0, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  // 2. Score every fetched signal with the rules scorer.
  const scoredBySource = new Map<string, ScoredSignal[]>();
  for (const f of fetched) {
    for (const sig of f.raw) {
      try {
        const s = scoreSignalRules(sig, employers);
        const arr = scoredBySource.get(f.feed.source) ?? [];
        arr.push(s);
        scoredBySource.set(f.feed.source, arr);
      } catch {
        // skip a single bad signal; others continue
      }
    }
  }

  // 3. Write per feed (replace-unhandled first for snapshot-style feeds).
  const results: FeedResult[] = [];
  for (const f of fetched) {
    if (f.error) {
      results.push({ source: f.feed.source, error: f.error });
      continue;
    }
    try {
      if (f.feed.replaceUnhandled) {
        await sql`delete from signals where source = ${f.feed.source} and handled = false`;
      }
      const scoredForFeed = scoredBySource.get(f.feed.source) ?? [];
      let inserted = 0;
      for (const s of scoredForFeed) if (await ingestSignal(s)) inserted++;
      results.push({
        source: f.feed.source,
        found: f.raw.length + f.dropped,
        inserted,
        dropped: f.dropped || undefined,
      });
    } catch (err) {
      results.push({ source: f.feed.source, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Record a risk-index snapshot per employer with open signals, for trends.
  try {
    await snapshotRiskScores();
  } catch {
    // Never let snapshotting break a pull.
  }

  return results;
}

// Compute each employer's current risk index from their open signals and record
// one snapshot row per employer, so trends can be derived over time.
async function snapshotRiskScores(): Promise<void> {
  const rows = (await sql`
    select s.employer_id, s.signal_type, s.tier, s.priority, s.category,
           coalesce(s.event_date, s.scored_at) as event_date, e.band
    from signals s
    join employers e on e.id = s.employer_id
    where s.handled = false and s.employer_id is not null
      and coalesce(s.event_date, s.scored_at) >= now() - (${`${FRESHNESS_MONTHS} months`})::interval
  `) as {
    employer_id: number;
    signal_type: RiskInput["signal_type"];
    tier: string;
    priority: number;
    category: string | null;
    event_date: string;
    band: string | null;
  }[];

  const byEmployer = new Map<number, { band: string | null; sigs: RiskInput[] }>();
  for (const r of rows) {
    const e = byEmployer.get(r.employer_id) ?? { band: r.band, sigs: [] };
    e.sigs.push({
      signal_type: r.signal_type,
      tier: r.tier,
      priority: r.priority,
      category: r.category,
      date: r.event_date,
    });
    byEmployer.set(r.employer_id, e);
  }

  for (const [employerId, { band, sigs }] of byEmployer) {
    const { score, level } = computeRiskIndex(sigs, band);
    await sql`insert into risk_snapshots (employer_id, score, level) values (${employerId}, ${score}, ${level})`;
  }
}
