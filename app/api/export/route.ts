import { NextResponse } from "next/server";
import { exportAuth, jsonError } from "@/lib/exportApi";

export const dynamic = "force-dynamic";

// GET /api/export — index of the available read-only export endpoints. Token
// required, so it doubles as a quick "is my token working" check.
export async function GET(req: Request) {
  const auth = exportAuth(req);
  if (!auth.ok) return jsonError(auth.status, auth.message);

  return NextResponse.json({
    ok: true,
    endpoints: [
      { path: "/api/export/employers", describes: "Tracked directory: risk index, last visit, open flags. Maps to CRM Account." },
      { path: "/api/export/signals", describes: "Open signals, most material first. Maps to CRM activity/notes." },
      { path: "/api/export/followups", describes: "Open red/green flags with owner, urgency, due date. Maps to CRM Task." },
    ],
    auth: "Send the export token as an Authorization: Bearer header (or ?token= query param).",
  });
}
