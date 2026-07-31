import { NextResponse } from "next/server";
import { runAllFeeds } from "@/lib/pipeline";
import { scanNewsBatch } from "@/lib/newsPipeline";
import { aiEnabled } from "@/lib/ai";

export const maxDuration = 60;

// How many employers to news-scan per daily run (round-robin, oldest first).
const NEWS_BATCH = 6;

// Single daily dispatcher that runs every feed. Consolidating the per-feed
// crons into one keeps the project within the Vercel Hobby plan's two-cron
// limit (this dispatcher + the digest). The individual per-feed routes still
// exist for manual triggering; they are just no longer scheduled.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const ran = await runAllFeeds();

  // Bounded daily news scan (only when the optional AI features are enabled).
  let news: { scanned: number; added: number } | { error: string } | null = null;
  if (aiEnabled()) {
    try {
      news = await scanNewsBatch(NEWS_BATCH);
    } catch (e) {
      news = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ ran, news });
}
