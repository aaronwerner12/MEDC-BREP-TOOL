import { NextResponse } from "next/server";
import { loadEmployers } from "@/lib/employers";
import { scoreSignal } from "@/lib/score";
import { ingestSignal } from "@/lib/ingest";
import { parseCostarEmail } from "@/adapters/costarEmail";

// Point your CoStar alert inbox's inbound-email webhook here (Resend inbound,
// Postmark, SendGrid inbound parse, etc). Body field names vary by provider;
// adjust the mapping below to match yours.
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, string | undefined>;

  const email = {
    subject: body.subject ?? "",
    text: body.text ?? body.plain ?? body["stripped-text"] ?? "",
    messageId: body.messageId ?? body["Message-Id"] ?? crypto.randomUUID(),
  };

  const employers = await loadEmployers();
  const raw = parseCostarEmail(email);

  let inserted = 0;
  for (const r of raw) {
    const scored = await scoreSignal(r, employers);
    if (await ingestSignal(scored)) inserted++;
  }
  return NextResponse.json({ source: "costar", found: raw.length, inserted });
}
