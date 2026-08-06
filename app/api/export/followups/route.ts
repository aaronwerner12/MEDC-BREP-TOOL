import { sql } from "@/lib/db";
import { exportAuth, jsonError, readWithHeal, exportJson } from "@/lib/exportApi";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/export/followups — open red/green flags with owner, urgency, and due
// date. Maps to CRM Tasks on the matched Account.
export async function GET(req: Request) {
  const auth = exportAuth(req);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  try {
    const rows = await readWithHeal(
      () => sql`
        select
          f.id,
          f.employer_id,
          coalesce(e.official_name, e.name) as company,
          f.kind,
          f.category,
          f.note,
          f.urgency,
          f.owner,
          f.status,
          f.due_date,
          f.created_at
        from flags f
        join employers e on e.id = f.employer_id
        where f.status = 'open'
        order by f.due_date nulls last, f.created_at desc
      `
    );
    return exportJson(rows as unknown[]);
  } catch (e) {
    return jsonError(500, e instanceof Error ? e.message : "Export failed.");
  }
}
