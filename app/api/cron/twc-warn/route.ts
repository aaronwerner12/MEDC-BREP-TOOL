import { NextResponse } from "next/server";
import { loadEmployers } from "@/lib/employers";
import { scoreSignal } from "@/lib/score";
import { ingestSignal } from "@/lib/ingest";
import { twcWarnSignals } from "@/adapters/twcWarn";

export const maxDuration = 60;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
// when CRON_SECRET is set in the project env.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const employers = await loadEmployers();
  const raw = await twcWarnSignals(employers);

  let inserted = 0;
  for (const r of raw) {
    const scored = await scoreSignal(r, employers);
    if (await ingestSignal(scored)) inserted++;
  }
  return NextResponse.json({ source: "twc_warn", found: raw.length, inserted });
}
