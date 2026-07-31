import { sql } from "./db";
import { scoreSignal } from "./score";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import type { NormalizedSignal, ScoredSignal } from "./types";
import { computeRiskIndex, FRESHNESS_MONTHS, type RiskInput } from "./risk";
import { usaspendingSignals } from "../adapters/usaspending";
import { twcWarnSignals } from "../adapters/twcWarn";
import { secEdgarSignals } from "../adapters/secEdgar";
import { echoSignals } from "../adapters/echo";

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
  // WARN is a current-year listing we re-fetch whole, so replace unhandled rows
  // each run -- this also retires any previously-ingested neighboring-city
  // notices now that the filter is McKinney-only.
  { source: "twc_warn", run: twcWarnSignals, replaceUnhandled: true },
  { source: "sec_edgar", run: secEdgarSignals },
  // ECHO reflects current compliance state, so replace unhandled rows each run.
  { source: "epa_echo", run: echoSignals, replaceUnhandled: true },
];

// Keep a single pull well within the serverless function time limit: cap how
// many items each feed contributes and score them concurrently rather than one
// at a time.
const MAX_PER_FEED = 15;
const SCORING_CONCURRENCY = 8;

export interface FeedResult {
  source: string;
  found?: number;
  inserted?: number;
  dropped?: number;
  error?: string;
}

// Score many signals with a bounded number of concurrent Claude calls. A single
// failing score is skipped (left undefined) rather than aborting the whole run.
async function scoreConcurrently(
  sigs: NormalizedSignal[],
  employers: EmployerRow[],
  limit: number
): Promise<(ScoredSignal | undefined)[]> {
  const out: (ScoredSignal | undefined)[] = new Array(sigs.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= sigs.length) return;
      try {
        out[i] = await scoreSignal(sigs[i], employers);
      } catch {
        out[i] = undefined; // skip this one; others continue
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, sigs.length) }, worker));
  return out;
}

// Run every feed: fetch all in parallel, score everything with bounded
// concurrency, then write per feed. One failing feed or one failing score never
// aborts the rest.
export async function runAllFeeds(): Promise<FeedResult[]> {
  const employers = await loadEmployers();

  // 1. Fetch all feeds in parallel; cap each feed's contribution.
  const fetched = await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const raw = await feed.run(employers);
        const capped = raw.slice(0, MAX_PER_FEED);
        return { feed, raw: capped, dropped: raw.length - capped.length, error: null as string | null };
      } catch (err) {
        return { feed, raw: [] as NormalizedSignal[], dropped: 0, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  // 2. Score everything at once with bounded concurrency.
  const flat: { source: string; sig: NormalizedSignal }[] = [];
  for (const f of fetched) for (const r of f.raw) flat.push({ source: f.feed.source, sig: r });
  const scored = await scoreConcurrently(flat.map((x) => x.sig), employers, SCORING_CONCURRENCY);

  const scoredBySource = new Map<string, ScoredSignal[]>();
  flat.forEach((x, i) => {
    const s = scored[i];
    if (!s) return;
    const arr = scoredBySource.get(x.source) ?? [];
    arr.push(s);
    scoredBySource.set(x.source, arr);
  });

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
