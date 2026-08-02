import { NextResponse } from "next/server";
import { runAllFeeds } from "@/lib/pipeline";
import { fillMissingProfiles } from "@/app/actions";

export const maxDuration = 60;

// Single daily dispatcher that runs every feed, including the free Google News
// RSS feed. Consolidating the per-feed crons into one keeps the project within
// the Vercel Hobby plan's two-cron limit (this dispatcher + the digest). The
// individual per-feed routes still exist for manual triggering; they are just
// no longer scheduled. No API key is required: scoring is rules-based and the
// news feed is keyless.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const ran = await runAllFeeds();

  // Best-effort: fill a small batch of missing profiles from the free source
  // chain each day, so newly added companies self-populate over time. Never let
  // it fail the feed run.
  let profiles: { scanned: number; filled: number; remaining: number } | { error: string } | null = null;
  try {
    const r = await fillMissingProfiles(8);
    profiles = { scanned: r.scanned, filled: r.filled, remaining: r.remaining };
  } catch (e) {
    profiles = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({ ran, profiles });
}
