import { sql } from "./db";
import { scoreSignal } from "./score";
import { ingestSignal } from "./ingest";
import { loadEmployers, type EmployerRow } from "./employers";
import { fetchCompanyNews } from "./news";
import { ensureSchema } from "./setup";
import type { NormalizedSignal } from "./types";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);

interface EmpLite {
  id: number;
  name: string;
  sector: string | null;
}

// Scan the web for one employer's recent news and ingest each item as an
// indicative signal. Returns how many new items were added.
export async function ingestEmployerNews(emp: EmpLite, employers: EmployerRow[]): Promise<number> {
  const items = await fetchCompanyNews({ name: emp.name, sector: emp.sector });
  let added = 0;
  for (const it of items) {
    const sig: NormalizedSignal = {
      source: "news",
      tier: "indicative",
      externalId: `news:${emp.id}:${slugify(it.url || it.headline)}`,
      companyName: emp.name,
      observedText: `${it.headline}. ${it.summary}`.trim(),
      sourceUrl: it.url || undefined,
      eventDate: it.date || undefined,
      raw: { news: true, ...it },
    };
    try {
      const scored = await scoreSignal(sig, employers);
      if (await ingestSignal(scored)) added++;
    } catch {
      // skip an item that fails to score/ingest
    }
  }
  return added;
}

// Round-robin daily batch: scan the least-recently-scanned employers, bounded to
// control web-search cost, so everyone gets covered over successive days.
export async function scanNewsBatch(limit: number): Promise<{ scanned: number; added: number }> {
  try {
    await ensureSchema();
  } catch {
    // best-effort schema upgrade
  }

  const emps = (await sql`
    select id, name, sector
    from employers
    where active = true
    order by news_scanned_at asc nulls first
    limit ${limit}
  `) as EmpLite[];
  if (emps.length === 0) return { scanned: 0, added: 0 };

  const employers = await loadEmployers();
  let added = 0;

  // Small concurrency so the batch fits the function time budget.
  const CONCURRENCY = 3;
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
