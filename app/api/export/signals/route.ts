import { sql } from "@/lib/db";
import { exportAuth, jsonError, readWithHeal, exportJson } from "@/lib/exportApi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/export/signals — open signals across the watchlist, most material
// first. Maps to CRM activity/notes on the matched Account.
export async function GET(req: Request) {
  const auth = exportAuth(req);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  try {
    const rows = await readWithHeal(
      () => sql`
        select
          s.id,
          s.employer_id,
          coalesce(e.official_name, e.name) as company,
          s.signal_type,
          s.category,
          s.priority,
          s.tier,
          s.source,
          s.summary,
          s.recommended_action,
          s.source_url,
          coalesce(s.event_date, s.scored_at) as event_date,
          s.scored_at
        from signals s
        left join employers e on e.id = s.employer_id
        where s.handled = false
        order by (s.tier = 'authoritative') desc, s.priority desc, s.scored_at desc
        limit 500
      `
    );
    return exportJson(rows as unknown[]);
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : "Export failed.");
  }
}
