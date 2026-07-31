import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import { BusinessDirectory, type DirEmployer, type DirStatus } from "../business-directory";

export const dynamic = "force-dynamic";

interface Row {
  id: number;
  name: string;
  sector: string | null;
  band: string | null;
  segment: string | null;
}

async function readDirectory(): Promise<{ employers: DirEmployer[] } | null> {
  const rows = (await sql`
    select id, coalesce(official_name, name) as name, sector, band, coalesce(segment, 'medc') as segment
    from employers
    where active = true
    order by name
  `) as Row[];

  const statusRows = (await sql`
    select employer_id,
           bool_or(signal_type = 'risk')   as hr,
           bool_or(signal_type = 'growth') as hg,
           bool_or(signal_type = 'neutral') as hn
    from signals
    where handled = false and employer_id is not null
    group by employer_id
  `) as { employer_id: number; hr: boolean; hg: boolean; hn: boolean }[];

  const statusById = new Map<number, DirStatus>();
  for (const s of statusRows) {
    statusById.set(s.employer_id, s.hr ? "risk" : s.hg ? "growth" : s.hn ? "watch" : "none");
  }

  const employers: DirEmployer[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sector: r.sector,
    band: r.band,
    segment: r.segment === "mckinney" ? "mckinney" : "medc",
    status: statusById.get(r.id) ?? "none",
  }));

  return { employers };
}

export default async function BusinessesPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <div className="wrap">
        <div className="notice" style={{ marginTop: 28 }}>
          <h3>Database not connected</h3>
          <p>Set DATABASE_URL to view the business directory.</p>
        </div>
      </div>
    );
  }

  let data: { employers: DirEmployer[] } | null = null;
  try {
    data = await readDirectory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(msg)) {
      try {
        await ensureSchema();
        data = await readDirectory();
      } catch {
        data = null;
      }
    }
  }

  return <BusinessDirectory employers={data?.employers ?? []} />;
}
