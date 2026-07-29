import { NextResponse } from "next/server";
import { loadEmployers } from "@/lib/employers";
import { echoSignals } from "@/adapters/echo";

export const maxDuration = 60;

// Diagnostic + manual-trigger route for the EPA/OSHA ECHO feed. Because the
// ECHO contract could not be verified when this was built, hitting this route
// (with the cron secret) returns what the adapter actually mapped, so the field
// mapping can be confirmed against a real pull. The scheduled run happens via
// /api/cron/all.
function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const employers = await loadEmployers();
  const raw = await echoSignals(employers);

  return NextResponse.json({
    source: "epa_echo",
    matched: raw.length,
    sample: raw.slice(0, 5).map((s) => ({ company: s.companyName, text: s.observedText })),
  });
}
