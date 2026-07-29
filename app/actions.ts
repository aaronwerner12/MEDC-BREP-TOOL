"use server";

import { sql } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { runAllFeeds } from "@/lib/pipeline";

// Server action: mark a signal handled so it drops out of the open queue.
export async function markHandled(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  await sql`update signals set handled = true where id = ${id}`;
  revalidatePath("/");
}

// Server action: pull every feed on demand, score each item, and ingest.
// Same work as the daily /api/cron/all dispatcher, invoked from the dashboard
// button so no secret or URL is needed.
export async function pullFeeds() {
  await runAllFeeds();
  revalidatePath("/");
}
