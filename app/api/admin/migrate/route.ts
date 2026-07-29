import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { ensureSchema } from "@/lib/setup";

export const maxDuration = 60;

// One-time (idempotent) setup endpoint. The dashboard also self-heals on the
// "tables missing" error, so this is mostly a manual re-seed / verification
// hook. Auth: CRON_SECRET via `Authorization: Bearer <secret>` or `?key=`.
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set. Add it in the Vercel project env, then retry." },
      { status: 500 }
    );
  }
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  let steps;
  try {
    steps = await ensureSchema();
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const byBand = (await sql`
    select band, count(*)::int as n from employers group by band order by min(id)
  `) as { band: string; n: number }[];
  const total = byBand.reduce((s, b) => s + b.n, 0);

  return NextResponse.json({ ok: true, steps, employers: total, byBand });
}
