import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";
import { FollowupsList, type FollowupRow } from "./followups-list";

export const metadata = { title: "Follow-ups" };
export const dynamic = "force-dynamic";

async function readFollowups(): Promise<FollowupRow[]> {
  return (await sql`
    select f.id, f.employer_id, coalesce(e.official_name, e.name) as company,
           f.kind, f.category, f.note, f.urgency, f.owner, f.status, f.due_date
    from flags f
    join employers e on e.id = f.employer_id
    where f.status = 'open'
  `) as FollowupRow[];
}

export default async function FollowupsPage() {
  if (!process.env.DATABASE_URL) {
    return (
      <div className="wrap">
        <div className="notice" style={{ marginTop: 28 }}>
          <h3>Database not connected</h3>
        </div>
      </div>
    );
  }

  let rows: FollowupRow[] = [];
  try {
    rows = await readFollowups();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(msg)) {
      try {
        await ensureSchema();
        rows = await readFollowups();
      } catch {
        rows = [];
      }
    }
  }

  const overdue = rows.filter((r) => {
    if (!r.due_date) return false;
    const t = new Date(r.due_date).getTime();
    return !Number.isNaN(t) && Date.now() > t + 86_400_000;
  }).length;

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>Follow-ups</h1>
          <div className="tag">Open flags across every employer. Act on the urgent ones first.</div>
        </div>
      </header>

      <div className="col-head" style={{ marginTop: 8 }}>
        {rows.length} open
        {overdue > 0 && <span className="fu-overdue-count"> · {overdue} overdue</span>}
      </div>

      <FollowupsList rows={rows} />
    </div>
  );
}

function ScanIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
