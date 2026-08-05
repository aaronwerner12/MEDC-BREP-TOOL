// BRE workflow model. Turns the tool from a detector into something an economic
// developer actually runs a retention program with: regular business visits,
// red/green flags tied to the concrete needs IEDC names ("what kinds of help do
// businesses need" — workforce, land/buildings, financing/equipment,
// permitting, infrastructure, technical assistance), each with an owner, an
// urgency, and a follow-up date, tracked to a resolution and its impact.

export type FlagKind = "red" | "green";
export type Urgency = "urgent" | "high" | "medium" | "low";
export type FlagStatus = "open" | "resolved";

// Need / issue categories, aligned to the IEDC "what kinds of help do businesses
// need" list plus the standard BRE red-flag types.
export const FLAG_CATEGORIES = [
  "Workforce / hiring / training",
  "Land / buildings / space",
  "Financing / equipment",
  "Permitting / licensing",
  "Infrastructure / utilities",
  "Regulatory / compliance",
  "Real estate / lease",
  "Supply chain / customers",
  "Closure / relocation risk",
  "Expansion / growth",
  "Technical assistance",
  "Other",
] as const;

export const URGENCIES: Urgency[] = ["urgent", "high", "medium", "low"];

export function urgencyRank(u: string | null | undefined): number {
  return { urgent: 0, high: 1, medium: 2, low: 3 }[(u ?? "") as Urgency] ?? 4;
}

export function urgencyLabel(u: string | null | undefined): string {
  const s = (u ?? "").toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

// IEDC BRE practice is regular visits; an employer not seen within this window is
// due for a visit.
export const VISIT_CADENCE_MONTHS = 12;

export interface VisitState {
  overdue: boolean;
  neverVisited: boolean;
  monthsSince: number | null;
  label: string;
}

// Derive an employer's visit-cadence state from its most recent visit date.
export function visitState(lastVisitIso: string | null | undefined): VisitState {
  if (!lastVisitIso) {
    return { overdue: true, neverVisited: true, monthsSince: null, label: "No visit on record" };
  }
  const t = new Date(lastVisitIso).getTime();
  if (Number.isNaN(t)) {
    return { overdue: true, neverVisited: true, monthsSince: null, label: "No visit on record" };
  }
  const months = (Date.now() - t) / (30.44 * 86_400_000);
  const overdue = months >= VISIT_CADENCE_MONTHS;
  const rounded = Math.max(0, Math.round(months));
  const ago =
    rounded === 0 ? "this month" : `${rounded} month${rounded === 1 ? "" : "s"} ago`;
  return {
    overdue,
    neverVisited: false,
    monthsSince: months,
    label: overdue ? `Last visit ${ago} · due for a visit` : `Last visit ${ago}`,
  };
}

// A follow-up (open flag) is overdue when its due date has passed.
export function isFollowupOverdue(dueDateIso: string | null | undefined, status: string): boolean {
  if (status !== "open" || !dueDateIso) return false;
  const t = new Date(dueDateIso).getTime();
  if (Number.isNaN(t)) return false;
  // Compare on date only (end of the due day).
  return Date.now() > t + 86_400_000;
}
