import { sql } from "./db";
import type { ScoredSignal } from "./types";

// Write a scored signal to Neon. Idempotent: the unique(source, external_id)
// constraint means a re-run of the same feed never duplicates a row.
// Returns true when a new row was inserted, false when it was a duplicate.
export async function ingestSignal(s: ScoredSignal): Promise<boolean> {
  const rows = (await sql`
    insert into signals (
      employer_id, source, tier, signal_type, category, priority,
      summary, recommended_action, talking_point, source_url, external_id, raw,
      event_date
    ) values (
      ${s.employerId}, ${s.source}, ${s.tier}, ${s.signalType}, ${s.category},
      ${s.priority}, ${s.summary}, ${s.recommendedAction}, ${s.talkingPoint},
      ${s.sourceUrl ?? null}, ${s.externalId}, ${JSON.stringify(s.raw ?? null)}::jsonb,
      ${s.eventDate ?? null}
    )
    on conflict (source, external_id) do nothing
    returning id
  `) as { id: number }[];

  return rows.length > 0;
}
