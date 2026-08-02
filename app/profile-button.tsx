"use client";

import { useState, useTransition } from "react";
import { generateProfile } from "./actions";

// Fetches a company profile for an employer, free-first (Wikidata) with an
// optional AI fallback, and surfaces any error message.
export function ProfileButton({ employerId, hasProfile }: { employerId: number; hasProfile: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="btn-with-msg">
      <button
        className="handle"
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const r = await generateProfile(employerId);
            if (!r.ok) setMsg(r.error ?? "Could not build a profile.");
          })
        }
      >
        {pending ? "Looking up…" : hasProfile ? "Refresh profile" : "Look up company info"}
      </button>
      {msg && <span className="add-biz-msg">{msg}</span>}
    </span>
  );
}
