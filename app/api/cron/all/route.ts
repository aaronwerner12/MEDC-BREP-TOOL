import { NextResponse } from "next/server";
import { runAllFeeds } from "@/lib/pipeline";

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
  return NextResponse.json({ ran });
}
