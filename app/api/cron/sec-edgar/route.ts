import { NextResponse } from "next/server";
import { loadEmployers } from "@/lib/employers";
import { scoreSignal } from "@/lib/score";
import { ingestSignal } from "@/lib/ingest";
import { secEdgarSignals } from "@/adapters/secEdgar";

export const maxDuration = 60;

// Manual-trigger route for the SEC EDGAR feed. The scheduled run happens via
// the consolidated /api/cron/all dispatcher; this exists for parity/testing.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const employers = await loadEmployers();
  const raw = await secEdgarSignals(employers);

  let inserted = 0;
  for (const r of raw) {
    const scored = await scoreSignal(r, employers);
    if (await ingestSignal(scored)) inserted++;
  }
  return NextResponse.json({ source: "sec_edgar", found: raw.length, inserted });
}
