"use server";

import { sql } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { loadEmployers } from "@/lib/employers";
import { scoreSignal } from "@/lib/score";
import { ingestSignal } from "@/lib/ingest";
import { usaspendingSignals } from "@/adapters/usaspending";
import { twcWarnSignals } from "@/adapters/twcWarn";
import type { NormalizedSignal } from "@/lib/types";
import type { EmployerRow } from "@/lib/employers";

// Server action: mark a signal handled so it drops out of the open queue.
export async function markHandled(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await sql`update signals set handled = true where id = ${id}`;
  revalidatePath("/");
}

// Server action: pull every feed on demand, score each item with Claude, and
// ingest. Runs the same work as the daily /api/cron/all dispatcher, but invoked
// from the dashboard button so no secret or URL is needed. Feeds run
// independently so one failing feed does not abort the others.
export async function pullFeeds() {
  const employers = await loadEmployers();
  const feeds: ((e: EmployerRow[]) => Promise<NormalizedSignal[]>)[] = [
    usaspendingSignals,
    twcWarnSignals,
  ];

  for (const run of feeds) {
    try {
      const raw = await run(employers);
      for (const r of raw) {
        const scored = await scoreSignal(r, employers);
        await ingestSignal(scored);
      }
    } catch {
      // Skip a failing feed; the page will show whatever successfully ingested.
    }
  }

  revalidatePath("/");
}
