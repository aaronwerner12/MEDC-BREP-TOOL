import { NextResponse } from "next/server";
import { FEED_SOURCES, runSingleFeed } from "@/lib/pipeline";

export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Vercel Hobby allows only two configured cron jobs. Rotate the sources
  // rather than running all five plus profile enrichment in a single function.
  // Each source runs once per five days; news scans five employers per turn.
  const day = Math.floor(Date.now() / 86_400_000);
  const source = FEED_SOURCES[day % FEED_SOURCES.length];
  const result = await runSingleFeed(source);
  return NextResponse.json({ ranAt: new Date().toISOString(), result }, { status: result.error ? 502 : 200 });
}
