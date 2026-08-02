import { sql } from "./db";
import { scoreSignalRules } from "./rulesScore";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import { googleNewsForEmployer } from "../adapters/googleNews";
import { ensureSchema } from "./setup";

interface EmpLite {
  id: number;
  name: string;
  sector: string | null;
}

// Turn a lite employer row into the EmployerRow shape the free news adapter and
// the rules scorer expect. We look up the full row so entity matching and the
// display name (including any official_name alias) stay consistent.
function toEmployerRow(emp: EmpLite, employers: EmployerRow[]): EmployerRow {
  return (
    employers.find((e) => e.id === emp.id) ?? {
      id: emp.id,
      name: emp.name,
      aliases: [],
      uei: null,
      band: null,
      sector: emp.sector,
      addresses: [],
      active: true,
    }
  );
}

// Scan the free Google News feed for one employer and ingest each material item
// as an indicative signal. No API key, no tokens. Returns how many were added.
export async function ingestEmployerNews(emp: EmpLite, employers: EmployerRow[]): Promise<number> {
  const row = toEmployerRow(emp, employers);
  const items = await googleNewsForEmployer(row);
  let added = 0;
  for (const sig of items) {
    try {
      const scored = scoreSignalRules(sig, employers);
      if (await ingestSignal(scored)) added++;
    } catch {
      // skip an item that fails to score/ingest
    }
  }
  return added;
}

// Round-robin batch: scan the least-recently-scanned employers first so everyone
// gets covered over successive runs. Free, so the bound is only about staying
// within the function time budget, not cost.
export async function scanNewsBatch(limit: number): Promise<{ scanned: number; added: number }> {
  try {
    await ensureSchema();
  } catch {
    // best-effort schema upgrade
  }

  const emps = (await sql`
    select id, coalesce(official_name, name) as name, sector
    from employers
    where active = true
    order by news_scanned_at asc nulls first
    limit ${limit}
  `) as EmpLite[];
  if (emps.length === 0) return { scanned: 0, added: 0 };

  const employers = await loadEmployers();
  let added = 0;

  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < emps.length) {
      const e = emps[next++];
      try {
        added += await ingestEmployerNews(e, employers);
      } catch {
        // ignore a failing employer
      }
      try {
        await sql`update employers set news_scanned_at = now() where id = ${e.id}`;
      } catch {
        // ignore
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emps.length) }, worker));

  return { scanned: emps.length, added };
}
