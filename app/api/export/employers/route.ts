import { sql } from "@/lib/db";
import { exportAuth, jsonError, readWithHeal, exportJson } from "@/lib/exportApi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/export/employers — the tracked directory with the latest risk index,
// last visit, and open-flag count. Maps cleanly to a CRM Account.
export async function GET(req: Request) {
  const auth = exportAuth(req);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  try {
    const rows = await readWithHeal(
      () => sql`
        select
          e.id,
          coalesce(e.official_name, e.name) as name,
          e.name as entered_name,
          e.sector,
          e.band,
          coalesce(e.segment, 'medc') as segment,
          e.uei,
          (e.profile is not null and e.profile <> '') as has_profile,
          (select max(v.visited_on) from visits v where v.employer_id = e.id) as last_visit,
          (select count(*) from flags f where f.employer_id = e.id and f.status = 'open')::int as open_flags,
          rs.score as risk_score,
          rs.level as risk_level
        from employers e
        left join lateral (
          select score, level from risk_snapshots r
          where r.employer_id = e.id order by r.taken_at desc limit 1
        ) rs on true
        where e.active = true
        order by name
      `
    );
    return exportJson(rows as unknown[]);
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : "Export failed.");
  }
}
