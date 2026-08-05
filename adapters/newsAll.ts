import type { NormalizedSignal } from "../lib/types";
import type { EmployerRow } from "../lib/employers";
import { mergeNews } from "../lib/newsShared";
import { googleNewsSignals, googleNewsForEmployer } from "./googleNews";
import { gdeltSignals, gdeltForEmployer } from "./gdelt";

// Combined free news feed: Google News RSS + GDELT, merged and de-duplicated by
// headline so the same story from two sources collapses to one signal.

export async function newsSignals(employers: EmployerRow[]): Promise<NormalizedSignal[]> {
  const [google, gdelt] = await Promise.all([
    googleNewsSignals(employers).catch(() => [] as NormalizedSignal[]),
    gdeltSignals(employers).catch(() => [] as NormalizedSignal[]),
  ]);
  return mergeNews([google, gdelt]);
}

export async function newsForEmployer(emp: EmployerRow): Promise<NormalizedSignal[]> {
  const [google, gdelt] = await Promise.all([
    googleNewsForEmployer(emp).catch(() => [] as NormalizedSignal[]),
    gdeltForEmployer(emp).catch(() => [] as NormalizedSignal[]),
  ]);
  return mergeNews([google, gdelt]);
}
