"use client";

import { useTransition } from "react";
import { generateBrief } from "./actions";

// Triggers the grounded AI briefing for an employer and shows a pending state.
export function BriefButton({ employerId, hasBrief }: { employerId: number; hasBrief: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="handle"
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await generateBrief(employerId); })}
    >
      {pending ? "Generating…" : hasBrief ? "Regenerate briefing" : "Generate briefing"}
    </button>
  );
}
