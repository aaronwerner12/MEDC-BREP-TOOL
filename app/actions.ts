"use server";

import { sql } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { runAllFeeds } from "@/lib/pipeline";
import { generateEmployerBrief, type BriefSignal } from "@/lib/brief";
import { generateCompanyProfile } from "@/lib/profile";
import { ingestEmployerNews } from "@/lib/newsPipeline";
import { discoverMcKinneyEmployers } from "@/lib/discover";
import { loadEmployers } from "@/lib/employers";
import { ensureSchema } from "@/lib/setup";

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
    // Upsert: re-adding a previously removed company reactivates it.
    await sql`
      insert into employers (name, sector, segment, active)
      values (${name}, ${sector}, 'mckinney', true)
      on conflict (name) do update set active = true`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add business." };
  }
  revalidatePath("/businesses");
  revalidatePath("/");
  return { ok: true };
}

// Server action: remove a business from the tracked lists. Soft delete (marks
// inactive) so signal history is preserved and re-adding restores it.
export async function removeBusiness(id: number): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(id)) return { ok: false, error: "Bad id." };
  try {
    await sql`update employers set active = false where id = ${id}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove." };
  }
  revalidatePath("/businesses");
  revalidatePath("/");
  return { ok: true };
}

// Server action: scan the web for recent news about an employer and ingest each
// significant item as an indicative signal.
export async function scanNews(
  employerId: number
): Promise<{ ok: boolean; added?: number; error?: string }> {
  const emp = (
    (await sql`select id, name, sector from employers where id = ${employerId}`) as {
      id: number;
      name: string;
      sector: string | null;
    }[]
  )[0];
  if (!emp) return { ok: false, error: "Employer not found." };

  try {
    await ensureSchema();
  } catch {
    // best-effort schema upgrade
  }

  const employers = await loadEmployers();
  let added: number;
  try {
    added = await ingestEmployerNews(emp, employers);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "News lookup failed." };
  }
  // Best-effort: never let the tracking timestamp fail the scan.
  try {
    await sql`update employers set news_scanned_at = now() where id = ${employerId}`;
  } catch {
    // ignore
  }

  revalidatePath(`/employer/${employerId}`);
  revalidatePath("/");
  return { ok: true, added };
}

// Server action: web-discover major McKinney employers and add them to the
// tracked directory (segment 'mckinney'). Flagged as needs-verification.
export async function discoverEmployers(): Promise<{
  ok: boolean;
  added?: number;
  found?: number;
  error?: string;
}> {
  try {
    await ensureSchema();
  } catch {
    // best-effort schema upgrade
  }

  let found;
  try {
    found = await discoverMcKinneyEmployers();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Discovery failed." };
  }

  let added = 0;
  for (const f of found) {
    const name = f.name.trim();
    if (!name) continue;
    const sector = (f.sector ?? "").trim() || null;
    try {
      const rows = (await sql`
        insert into employers (name, sector, segment, active)
        values (${name}, ${sector}, 'mckinney', true)
        on conflict (name) do nothing
        returning id
      `) as { id: number }[];
      if (rows.length > 0) added++;
    } catch {
      // skip a bad row
    }
  }

  revalidatePath("/businesses");
  revalidatePath("/");
  return { ok: true, added, found: found.length };
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
    await ensureSchema();
  } catch {
    // best-effort
  }

  try {
    const { profile, officialName } = await generateCompanyProfile({
      name: emp.name,
      sector: emp.sector,
      city: "McKinney, Texas",
    });
    await sql`update employers set profile = ${profile}, profile_at = now() where id = ${employerId}`;

    // If the web found a different official name, use it as the heading and keep
    // the entered name as an alias so feed matching is unaffected.
    if (
      officialName &&
      officialName.toLowerCase() !== emp.name.toLowerCase() &&
      officialName.length >= 2
    ) {
      try {
        await sql`
          update employers
          set official_name = ${officialName},
              aliases = case when ${emp.name} = any(aliases) then aliases else aliases || array[${emp.name}] end
          where id = ${employerId}`;
      } catch {
        // best-effort name update
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Profile lookup failed." };
  }

  revalidatePath(`/employer/${employerId}`);
  revalidatePath("/");
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
