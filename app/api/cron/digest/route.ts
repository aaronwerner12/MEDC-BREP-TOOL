import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sql } from "@/lib/db";

const resend = new Resend(process.env.RESEND_API_KEY!);

function authorized(req: Request) {
  return req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
}

interface Row {
  company: string;
  band: string | null;
  signal_type: "risk" | "growth" | "neutral";
  priority: number;
  category: string;
  summary: string;
  recommended_action: string;
  tier: string;
  source_url: string | null;
}

export async function GET(req: Request) {
  if (!authorized(req)) return new NextResponse("Unauthorized", { status: 401 });

  const rows = (await sql`
    select coalesce(e.name, s.raw->>'Recipient Name', 'Unidentified') as company,
           e.band, s.signal_type, s.priority, s.category, s.summary,
           s.recommended_action, s.tier, s.source_url
    from signals s
    left join employers e on e.id = s.employer_id
    where s.handled = false
      and s.signal_type <> 'neutral'
      and s.scored_at > now() - interval '24 hours'
    order by (s.tier = 'authoritative') desc, s.priority desc
  `) as Row[];

  if (rows.length === 0) {
    return NextResponse.json({ sent: false, reason: "no new signals" });
  }

  const items = rows
    .map((r) => {
      const color = r.signal_type === "risk" ? "#C0473B" : "#3FA981";
      return `
      <tr><td style="padding:10px 12px 2px;font-weight:600;color:#17324B;">
        ${r.company}${r.band ? ` <span style="color:#7A93A8;font-weight:400;">· ${r.band}</span>` : ""}
        <span style="float:right;color:${color};text-transform:uppercase;font-size:12px;">${r.signal_type} · ${r.priority}</span>
      </td></tr>
      <tr><td style="padding:0 12px 12px;color:#17324B;font-size:14px;">
        <div>${r.category}: ${r.summary}</div>
        <div style="color:#2E5A7D;margin-top:4px;">Move: ${r.recommended_action}</div>
        ${r.tier === "indicative" ? `<div style="color:#7A93A8;font-size:12px;margin-top:2px;">Indicative — confirm before outreach.</div>` : ""}
        ${r.source_url ? `<a href="${r.source_url}" style="color:#2E5A7D;font-size:12px;">source</a>` : ""}
      </td></tr>`;
    })
    .join("");

  await resend.emails.send({
    from: "Signal Desk <signal-desk@your-domain.org>",
    to: process.env.BRE_LEAD_EMAIL!,
    subject: `McKinney Signal Desk — ${rows.length} new signal${rows.length > 1 ? "s" : ""}`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:640px;">
      <h2 style="color:#17324B;">Morning signal digest</h2>
      <table style="width:100%;border-collapse:collapse;">${items}</table>
    </div>`,
  });

  return NextResponse.json({ sent: true, count: rows.length });
}
