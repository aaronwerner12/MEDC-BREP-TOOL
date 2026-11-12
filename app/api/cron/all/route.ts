import { NextResponse } from "next/server";
import { runSingleFeed } from "@/lib/pipeline";

export const maxDuration = 60;

// Preserve the existing single daily cron slot. Run news every day, and
// rotate the remaining sources so none are abandoned.
const OTHER_FEEDS = ["twc_warn", "sec_edgar", "usaspending", "epa_echo"] as const;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const day = Math.floor(Date.now() / 86_400_000);
  const otherSource = OTHER_FEEDS[day % OTHER_FEEDS.length];
  // Execute concurrently so the news scan does not wait for another feed.
  const [news, other] = await Promise.all([
    runSingleFeed("news"),
    runSingleFeed(otherSource),
  ]);
  const results = [news, other];
  return NextResponse.json(
    { ranAt: new Date().toISOString(), results },
    { status: results.some((r) => r.error) ? 502 : 200 }
  );
}
