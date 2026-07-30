"use client";

import { useTransition } from "react";
import { generateProfile } from "./actions";

// Fetches a web-sourced company profile for an employer, with a pending state.
export function ProfileButton({ employerId, hasProfile }: { employerId: number; hasProfile: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="handle"
      type="button"
      disabled={pending}
      onClick={() => start(async () => { await generateProfile(employerId); })}
    >
      {pending ? "Looking up…" : hasProfile ? "Refresh profile" : "Look up company info"}
    </button>
  );
}
