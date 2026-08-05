"use server";

import { sql } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { runAllFeeds } from "@/lib/pipeline";
import { generateEmployerBrief, type BriefSignal } from "@/lib/brief";
import { generateEmployerBriefRules } from "@/lib/briefRules";
import { generateCompanyProfile } from "@/lib/profile";
import { resolveFreeProfile } from "@/lib/companyProfile";
import { ingestEmployerNews } from "@/lib/newsPipeline";
import { discoverMcKinneyEmployers } from "@/lib/discover";
import { discoverPlacesEmployers } from "@/lib/discoverPlaces";
import { discoverOsmEmployers } from "@/lib/discoverOsm";
import { discoverComptrollerEmployers } from "@/lib/discoverComptroller";
import { loadEmployers } from "@/lib/employers";
import { ensureSchema } from "@/lib/setup";
import { aiEnabled, friendlyAiError } from "@/lib/ai";

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
  // Free feed (Google News RSS): no API key required.
  const emp = (
    (await sql`select id, coalesce(official_name, name) as name, sector from employers where id = ${employerId}`) as {
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

// Server action: scan the free news feed for every active employer at once and
// ingest each material item. Free (Google News RSS), bounded concurrency.
export async function scanAllNews(): Promise<{
  ok: boolean;
  scanned: number;
  added: number;
  error?: string;
}> {
  try {
    await ensureSchema();
  } catch {
    // best-effort
  }

  let emps: { id: number; name: string; sector: string | null }[];
  try {
    emps = (await sql`
      select id, coalesce(official_name, name) as name, sector
      from employers
      where active = true
      order by news_scanned_at asc nulls first
      limit 60
    `) as { id: number; name: string; sector: string | null }[];
  } catch (e) {
    return { ok: false, scanned: 0, added: 0, error: e instanceof Error ? e.message : "Query failed." };
  }
  if (emps.length === 0) return { ok: true, scanned: 0, added: 0 };

  const employers = await loadEmployers();
  let added = 0;
  const CONCURRENCY = 4;
  let next = 0;
  async function worker() {
    while (next < emps.length) {
      const e = emps[next++];
      try {
        added += await ingestEmployerNews(e, employers);
      } catch {
        // skip a failing employer
      }
      try {
        await sql`update employers set news_scanned_at = now() where id = ${e.id}`;
      } catch {
        // ignore
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emps.length) }, worker));

  revalidatePath("/");
  revalidatePath("/businesses");
  return { ok: true, scanned: emps.length, added };
}

// Server action: discover McKinney employers from structured free sources
// (Google Places categories + OpenStreetMap), plus AI web discovery when
// enabled, and add the new ones to the directory (segment 'mckinney'). Flagged
// as needs-verification. Runs free with no key via OpenStreetMap.
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

  const found = new Map<string, { name: string; sector: string | null }>();
  const merge = (list: { name: string; sector: string | null }[]) => {
    for (const f of list) {
      const name = (f.name ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!found.has(key)) found.set(key, { name, sector: (f.sector ?? "")?.trim() || null });
    }
  };

  // Free structured sources, in parallel. Each returns [] on failure.
  const [places, osm, comptroller] = await Promise.all([
    discoverPlacesEmployers().catch(() => [] as { name: string; sector: string | null }[]),
    discoverOsmEmployers().catch(() => [] as { name: string; sector: string | null }[]),
    discoverComptrollerEmployers().catch(() => [] as { name: string; sector: string | null }[]),
  ]);
  merge(places);
  merge(osm);
  merge(comptroller);

  // Optional AI web discovery on top.
  if (aiEnabled()) {
    try {
      merge(await discoverMcKinneyEmployers());
    } catch {
      // AI failure (e.g. credits) never blocks the free discovery
    }
  }

  let added = 0;
  for (const f of found.values()) {
    try {
      const rows = (await sql`
        insert into employers (name, sector, segment, active)
        values (${f.name}, ${f.sector}, 'mckinney', true)
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
  return { ok: true, added, found: found.size };
}

// --- BRE workflow: visits and flags -------------------------------------

// Log a business visit (the core BRE activity).
export async function logVisit(input: {
  employerId: number;
  visitedOn?: string;
  contactName?: string;
  notes?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.employerId)) return { ok: false, error: "Bad employer." };
  const visitedOn = (input.visitedOn ?? "").trim() || null;
  const contact = (input.contactName ?? "").trim() || null;
  const notes = (input.notes ?? "").trim() || null;
  try {
    await ensureSchema();
  } catch {
    // best-effort
  }
  try {
    await sql`
      insert into visits (employer_id, visited_on, contact_name, notes)
      values (${input.employerId}, coalesce(${visitedOn}::date, current_date), ${contact}, ${notes})`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not log visit." };
  }
  revalidatePath(`/employer/${input.employerId}`);
  revalidatePath("/");
  return { ok: true };
}

// Add a red (issue) or green (opportunity) flag with an owner, urgency, and
// optional follow-up date.
export async function addFlag(input: {
  employerId: number;
  kind: "red" | "green";
  category?: string;
  note?: string;
  urgency?: string;
  owner?: string;
  dueDate?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.employerId)) return { ok: false, error: "Bad employer." };
  if (input.kind !== "red" && input.kind !== "green") return { ok: false, error: "Bad flag kind." };
  const category = (input.category ?? "").trim() || null;
  const note = (input.note ?? "").trim() || null;
  const urgency = ["urgent", "high", "medium", "low"].includes((input.urgency ?? "").trim())
    ? (input.urgency ?? "").trim()
    : null;
  const owner = (input.owner ?? "").trim() || null;
  const dueDate = (input.dueDate ?? "").trim() || null;
  try {
    await ensureSchema();
  } catch {
    // best-effort
  }
  try {
    await sql`
      insert into flags (employer_id, kind, category, note, urgency, owner, due_date)
      values (${input.employerId}, ${input.kind}, ${category}, ${note}, ${urgency}, ${owner}, ${dueDate}::date)`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add flag." };
  }
  revalidatePath(`/employer/${input.employerId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  return { ok: true };
}

// Resolve a flag, optionally recording the outcome (impact: jobs retained,
// issue closed, etc.).
export async function resolveFlag(input: {
  flagId: number;
  employerId?: number;
  outcome?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.flagId)) return { ok: false, error: "Bad flag." };
  const outcome = (input.outcome ?? "").trim() || null;
  try {
    await sql`
      update flags set status = 'resolved', resolved_at = now(),
        outcome = coalesce(${outcome}, outcome)
      where id = ${input.flagId}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not resolve." };
  }
  if (input.employerId) revalidatePath(`/employer/${input.employerId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  return { ok: true };
}

// Reopen a resolved flag.
export async function reopenFlag(input: {
  flagId: number;
  employerId?: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(input.flagId)) return { ok: false, error: "Bad flag." };
  try {
    await sql`update flags set status = 'open', resolved_at = null where id = ${input.flagId}`;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reopen." };
  }
  if (input.employerId) revalidatePath(`/employer/${input.employerId}`);
  revalidatePath("/followups");
  revalidatePath("/");
  return { ok: true };
}

// Store a profile string and, if the source found a different official name, set
// it as the heading while keeping the entered name as a matching alias.
async function storeProfile(
  employerId: number,
  enteredName: string,
  profile: string,
  officialName: string | null
): Promise<void> {
  await sql`update employers set profile = ${profile}, profile_at = now() where id = ${employerId}`;
  if (officialName && officialName.toLowerCase() !== enteredName.toLowerCase() && officialName.length >= 2) {
    try {
      await sql`
        update employers
        set official_name = ${officialName},
            aliases = case when ${enteredName} = any(aliases) then aliases else aliases || array[${enteredName}] end
        where id = ${employerId}`;
    } catch {
      // best-effort name update
    }
  }
}

// Server action: fetch and cache a company profile for one employer. Free-first:
// runs the free source chain (Wikidata, OpenCorporates, Google Knowledge Graph,
// the company website) and only falls back to the AI web-search profile if the
// free chain finds nothing and AI is enabled.
export async function generateProfile(
  employerId: number
): Promise<{ ok: boolean; source?: "free" | "ai"; sources?: string[]; error?: string }> {
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

  // 1. Free path: the source chain.
  try {
    const free = await resolveFreeProfile({ name: emp.name, sector: emp.sector });
    if (free) {
      await storeProfile(employerId, emp.name, JSON.stringify(free.profile), free.officialName);
      revalidatePath(`/employer/${employerId}`);
      revalidatePath("/");
      return { ok: true, source: "free", sources: free.sources };
    }
  } catch {
    // fall through to AI / not-found
  }

  // Free chain came up empty. Build a message that leads with the free fix
  // (this is a free feature; small private firms need the extra free sources).
  const hasOC = !!process.env.OPENCORPORATES_API_TOKEN;
  const hasKg = !!process.env.GOOGLE_KG_API_KEY;
  const missing = [!hasOC && "OpenCorporates", !hasKg && "Google Knowledge Graph"].filter(
    Boolean
  ) as string[];
  const freeMsg = missing.length
    ? `No free record found for "${emp.name}". Wikidata only covers larger firms; small private companies need the free ${missing.join(
        " and "
      )} key${missing.length > 1 ? "s" : ""} set in your environment to resolve for free.`
    : `No free record found for "${emp.name}" in the free sources. Try the official or legal company name.`;

  // 2. Optional paid path: AI web search, only if enabled.
  if (!aiEnabled()) {
    return { ok: false, error: freeMsg };
  }

  try {
    const { profile, officialName } = await generateCompanyProfile({
      name: emp.name,
      sector: emp.sector,
      city: "McKinney, Texas",
    });
    await storeProfile(employerId, emp.name, profile, officialName);
  } catch (e) {
    // Free chain was empty and the AI fallback also failed. Lead with the free
    // fix rather than the AI billing error.
    const aiErr = friendlyAiError(e);
    const creditIssue = /credit|billing/i.test(aiErr);
    return {
      ok: false,
      error: creditIssue ? `${freeMsg} (The AI fallback is also out of credits.)` : aiErr,
    };
  }

  revalidatePath(`/employer/${employerId}`);
  revalidatePath("/");
  return { ok: true, source: "ai" };
}

// Fill profiles for every tracked company that does not have one yet, using the
// free source chain only (no AI, no cost). Bounded per call so it stays within
// the serverless time budget; returns how many still remain so the UI can run
// it again. Shared by the "Fill missing profiles" button and the daily cron.
export async function fillMissingProfiles(
  limit = 15
): Promise<{ ok: boolean; scanned: number; filled: number; remaining: number; error?: string }> {
  try {
    await ensureSchema();
  } catch {
    // best-effort
  }

  let emps: { id: number; name: string; sector: string | null }[];
  try {
    emps = (await sql`
      select id, coalesce(official_name, name) as name, sector
      from employers
      where active = true and (profile is null or profile = '')
      order by band nulls last, id
      limit ${limit}
    `) as { id: number; name: string; sector: string | null }[];
  } catch (e) {
    return { ok: false, scanned: 0, filled: 0, remaining: 0, error: e instanceof Error ? e.message : "Query failed." };
  }

  let filled = 0;
  const CONCURRENCY = 3;
  let next = 0;
  async function worker() {
    while (next < emps.length) {
      const e = emps[next++];
      try {
        const free = await resolveFreeProfile({ name: e.name, sector: e.sector });
        if (free) {
          await storeProfile(e.id, e.name, JSON.stringify(free.profile), free.officialName);
          filled++;
        }
      } catch {
        // skip a company that fails; others continue
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, emps.length) }, worker));

  // Count how many are still missing a profile after this batch.
  let remaining = 0;
  try {
    const r = (await sql`
      select count(*)::int as n from employers where active = true and (profile is null or profile = '')
    `) as { n: number }[];
    remaining = r[0]?.n ?? 0;
  } catch {
    remaining = 0;
  }

  revalidatePath("/businesses");
  revalidatePath("/");
  return { ok: true, scanned: emps.length, filled, remaining };
}

// Server action: generate and cache a grounded briefing for one employer,
// synthesized only from that employer's own open signals. Free-first: a
// deterministic rules briefing always works at no cost; when AI is enabled the
// nicer AI prose is used, falling back to the rules briefing if the AI call
// fails (e.g. out of credits) so the button never errors.
export async function generateBrief(
  employerId: number
): Promise<{ ok: boolean; source?: "free" | "ai"; error?: string }> {
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
    select signal_type, category, summary, tier, priority,
           coalesce(event_date, scored_at) as event_date
    from signals
    where employer_id = ${employerId} and handled = false
    order by (tier = 'authoritative') desc, priority desc
    limit 20
  `) as {
    signal_type: "risk" | "growth" | "neutral";
    category: string;
    summary: string;
    tier: string;
    priority: number;
    event_date: string;
  }[];

  // Optional upgrade: AI prose when enabled. Any failure falls through to free.
  if (aiEnabled()) {
    try {
      const briefSignals: BriefSignal[] = signals.map((s) => ({
        signalType: s.signal_type,
        category: s.category,
        summary: s.summary,
        tier: s.tier,
      }));
      const brief = await generateEmployerBrief({
        name: emp.name,
        band: emp.band,
        sector: emp.sector,
        signals: briefSignals,
      });
      await sql`update employers set brief = ${brief}, brief_at = now() where id = ${employerId}`;
      revalidatePath(`/employer/${employerId}`);
      return { ok: true, source: "ai" };
    } catch {
      // fall through to the free rules briefing
    }
  }

  // Free path: deterministic rules briefing from the signals on record.
  const brief = generateEmployerBriefRules({
    name: emp.name,
    band: emp.band,
    signals: signals.map((s) => ({
      signalType: s.signal_type,
      category: s.category,
      summary: s.summary,
      tier: s.tier,
      priority: s.priority,
      date: s.event_date,
    })),
  });
  await sql`update employers set brief = ${brief}, brief_at = now() where id = ${employerId}`;
  revalidatePath(`/employer/${employerId}`);
  return { ok: true, source: "free" };
}
