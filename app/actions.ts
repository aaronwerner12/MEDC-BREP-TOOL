"use server";

import { sql } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { runAllFeeds } from "@/lib/pipeline";
import { generateEmployerBrief, type BriefSignal } from "@/lib/brief";
import { generateCompanyProfile } from "@/lib/profile";

// Server action: mark a signal handled so it drops out of the open queue.
export async function markHandled(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await sql`update signals set handled = true where id = ${id}`;
  revalidatePath("/");
}

// Server action: mark every open signal for one employer handled at once.
export async function handleEmployer(formData: FormData) {
  const id = Number(formData.get("employerId"));
  if (!Number.isFinite(id)) return;
  await sql`update signals set handled = true where employer_id = ${id} and handled = false`;
  revalidatePath("/");
}

// Server action: restore a handled signal back into the open queue.
export async function unhandle(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await sql`update signals set handled = false where id = ${id}`;
  revalidatePath("/");
  revalidatePath("/handled");
}

// Server action: pull every feed on demand, score each item, and ingest.
// Same work as the daily /api/cron/all dispatcher, invoked from the dashboard
// button so no secret or URL is needed.
export async function pullFeeds() {
  await runAllFeeds();
  revalidatePath("/");
}

// Server action: add a business to the tracked McKinney directory.
export async function addBusiness(input: {
  name: string;
  sector?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Name is required." };
  const sector = (input.sector ?? "").trim() || null;
  try {
    await sql`
      insert into employers (name, sector, segment, active)
      values (${name}, ${sector}, 'mckinney', true)
      on conflict (name) do nothing`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add business." };
  }
  revalidatePath("/businesses");
  revalidatePath("/");
  return { ok: true };
}

// Server action: fetch and cache a web-sourced company profile for one
// employer (location, employees, executives, ownership).
export async function generateProfile(
  employerId: number
): Promise<{ ok: boolean; error?: string }> {
  const emp = (
    (await sql`select id, name, sector from employers where id = ${employerId}`) as {
      id: number;
      name: string;
      sector: string | null;
    }[]
  )[0];
  if (!emp) return { ok: false, error: "Employer not found." };

  try {
    const profile = await generateCompanyProfile({
      name: emp.name,
      sector: emp.sector,
      city: "McKinney, Texas",
    });
    await sql`update employers set profile = ${profile}, profile_at = now() where id = ${employerId}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile lookup failed." };
  }

  revalidatePath(`/employer/${employerId}`);
  return { ok: true };
}

// Server action: generate and cache a grounded AI briefing for one employer,
// synthesized only from that employer's own open signals.
export async function generateBrief(
  employerId: number
): Promise<{ ok: boolean; error?: string }> {
  const emp = (
    (await sql`select id, name, band, sector from employers where id = ${employerId}`) as {
      id: number;
      name: string;
      band: string | null;
      sector: string | null;
    }[]
  )[0];
  if (!emp) return { ok: false, error: "Employer not found." };

  const signals = (await sql`
    select signal_type, category, summary, tier
    from signals
    where employer_id = ${employerId} and handled = false
    order by (tier = 'authoritative') desc, priority desc
    limit 20
  `) as { signal_type: string; category: string; summary: string; tier: string }[];

  const briefSignals: BriefSignal[] = signals.map((s) => ({
    signalType: s.signal_type,
    category: s.category,
    summary: s.summary,
    tier: s.tier,
  }));

  try {
    const brief = await generateEmployerBrief({
      name: emp.name,
      band: emp.band,
      sector: emp.sector,
      signals: briefSignals,
    });
    await sql`update employers set brief = ${brief}, brief_at = now() where id = ${employerId}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Briefing failed." };
  }

  revalidatePath(`/employer/${employerId}`);
  return { ok: true };
}
