import { NextResponse } from "next/server";
import { loadEmployers } from "@/lib/employers";
import { scoreSignal } from "@/lib/score";
import { ingestSignal } from "@/lib/ingest";
import { usaspendingSignals } from "@/adapters/usaspending";
import { twcWarnSignals } from "@/adapters/twcWarn";
import type { NormalizedSignal } from "@/lib/types";
import type { EmployerRow } from "@/lib/employers";

export const maxDuration = 60;

// Single daily dispatcher that runs every authoritative feed. Consolidating the
// per-feed crons into one keeps the project within the Vercel Hobby plan's
// two-cron limit (this dispatcher + the digest). The individual per-feed routes
// still exist for manual triggering; they are just no longer scheduled.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

const FEEDS: { source: string; run: (e: EmployerRow[]) => Promise<NormalizedSignal[]> }[] = [
  { source: "usaspending", run: usaspendingSignals },
  { source: "twc_warn", run: twcWarnSignals },
];

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const employers = await loadEmployers();
  const ran: Array<Record<string, unknown>> = [];

  // Run feeds independently so one failing feed does not abort the rest.
  for (const feed of FEEDS) {
    try {
      const raw = await feed.run(employers);
      let inserted = 0;
      for (const r of raw) {
        const scored = await scoreSignal(r, employers);
        if (await ingestSignal(scored)) inserted++;
      }
      ran.push({ source: feed.source, found: raw.length, inserted });
    } catch (err) {
      ran.push({ source: feed.source, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ran });
}
