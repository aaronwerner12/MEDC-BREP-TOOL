import { sql } from "./db";
import { scoreSignalRules } from "./rulesScore";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import type { NormalizedSignal, ScoredSignal } from "./types";
import { computeRiskIndex, FRESHNESS_MONTHS, type RiskInput } from "./risk";
import {
  usaspendingSignals,
  fetchAwardsForEmployer,
  activeContractTotal,
  contractDropSignal,
  DEFENSE_RE,
} from "../adapters/usaspending";
import { twcWarnSignals } from "../adapters/twcWarn";
import { secEdgarSignals } from "../adapters/secEdgar";
import { echoSignals } from "../adapters/echo";
import { newsSignals } from "../adapters/newsAll";

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
  { source: "news", run: newsSignals, maxItems: 80 },
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

// Run exactly one feed per invocation to avoid the 60-second combined pull timeout.
// News uses a rotating small employer batch; other feeds run independently.
// This deliberately skips expensive contract/risk snapshot maintenance.
export const FEED_SOURCES = ["twc_warn", "sec_edgar", "usaspending", "epa_echo", "news"] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];

export async function runSingleFeed(source: FeedSource): Promise<FeedResult> {
  const feed = FEEDS.find((f) => f.source === source);
  if (!feed) return { source, error: "Unknown feed" };
  try {
    let employers = await loadEmployers();
    if (source === "news") {
      // Rotate through employers in groups of five. Timestamp is a scan
      // checkpoint, not a claim that news was found.
      const selected = (await sql`
        select id from employers where active = true
        order by news_scanned_at asc nulls first, id asc limit 5
      `) as { id: number }[];
      const ids = new Set(selected.map((r) => r.id));
      employers = employers.filter((e) => ids.has(e.id));
    }
    const raw = await feed.run(employers);
    const capped = raw.slice(0, feed.maxItems ?? MAX_PER_FEED);
    // Never clear snapshot-style rows if a source returns nothing: an empty
    // response can reflect a transient upstream outage.
    if (feed.replaceUnhandled && capped.length > 0) {
      await sql`delete from signals where source = ${source} and handled = false`;
    }
    let inserted = 0;
    let failures = 0;
    for (const signal of capped) {
      try {
        if (await ingestSignal(scoreSignalRules(signal, employers))) inserted++;
      } catch {
        failures++;
      }
    }
    if (source === "news" && failures === 0 && employers.length > 0) {
      const ids = employers.map((e) => e.id);
      await sql`update employers set news_scanned_at = now() where id = any(${ids}::int[])`;
    }
    return {
      source, found: raw.length, inserted,
      dropped: raw.length - capped.length,
      ...(failures ? { error: `${failures} signals failed to save` } : {}),
    };
  } catch (err) {
    return { source, error: err instanceof Error ? err.message : String(err) };
  }
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

  // Snapshot each employer's federal contract book and flag material shrinkage
  // (non-renewal) vs. the last snapshot.
  try {
    await snapshotAndDiffContracts(employers);
  } catch {
    // Never let contract snapshotting break a pull.
  }

  // Record a risk-index snapshot per employer with open signals, for trends.
  try {
    await snapshotRiskScores();
  } catch {
    // Never let snapshotting break a pull.
  }

  return results;
}

// Snapshot the active federal-contract total for employers who either already
// have a snapshot (i.e. have had contracts) or are in the defense cluster, and
// emit a risk signal when the book shrinks materially since the last snapshot.
// Bounded to that set so it does not re-fetch the whole watchlist.
async function snapshotAndDiffContracts(employers: EmployerRow[]): Promise<void> {
  let priorRows: { employer_id: number; total_active: number }[] = [];
  try {
    priorRows = (await sql`
      select distinct on (employer_id) employer_id, total_active
      from contract_snapshots
      order by employer_id, taken_at desc
    `) as { employer_id: number; total_active: number }[];
  } catch {
    // Table may not exist yet on a fresh DB; the desk's self-heal creates it.
    return;
  }
  const priorMap = new Map(priorRows.map((r) => [r.employer_id, Number(r.total_active)]));

  const targets = employers.filter(
    (e) =>
      e.active !== false &&
      (priorMap.has(e.id) || [e.name, ...(e.aliases ?? [])].some((t) => DEFENSE_RE.test(t)))
  );
  if (targets.length === 0) return;

  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const e = targets[next++];
      try {
        const awards = await fetchAwardsForEmployer(e);
        const curr = activeContractTotal(awards);
        const recipient =
          (awards[0] && (awards[0]["Recipient Name"] as string)) || e.name;
        const prev = priorMap.get(e.id);
        if (prev != null) {
          const sig = contractDropSignal(prev, curr, recipient, e.id);
          if (sig) await ingestSignal(scoreSignalRules(sig, employers));
        }
        await sql`
          insert into contract_snapshots (employer_id, total_active, contract_count)
          values (${e.id}, ${curr.totalActive}, ${curr.contractCount})`;
      } catch {
        // Skip an employer that errors; others continue.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
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
