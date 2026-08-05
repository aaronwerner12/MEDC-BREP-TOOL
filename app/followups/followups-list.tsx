"use client";

import Link from "next/link";
import { useTransition } from "react";
import { resolveFlag } from "../actions";
import { urgencyLabel, urgencyRank, isFollowupOverdue } from "@/lib/workflow";

export interface FollowupRow {
  id: number;
  employer_id: number;
  company: string;
  kind: "red" | "green";
  category: string | null;
  note: string | null;
  urgency: string | null;
  owner: string | null;
  status: "open" | "resolved";
  due_date: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function FollowupsList({ rows }: { rows: FollowupRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    const ao = isFollowupOverdue(a.due_date, a.status) ? 0 : 1;
    const bo = isFollowupOverdue(b.due_date, b.status) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const ur = urgencyRank(a.urgency) - urgencyRank(b.urgency);
    if (ur !== 0) return ur;
    // Undated last, else earliest due first.
    const at = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const bt = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    return at - bt;
  });

  if (sorted.length === 0) {
    return <div className="empty">No open follow-ups. Add flags from an employer page.</div>;
  }
  return (
    <div className="card">
      {sorted.map((f) => (
        <Row key={f.id} f={f} />
      ))}
    </div>
  );
}

function Row({ f }: { f: FollowupRow }) {
  const [pending, start] = useTransition();
  const overdue = isFollowupOverdue(f.due_date, f.status);
  return (
    <div className={`fu-row ${overdue ? "overdue" : ""}`}>
      <span className={`flag-dot ${f.kind}`} />
      <div className="fu-main">
        <div className="fu-top">
          <Link className="fu-company link" href={`/employer/${f.employer_id}`}>
            {f.company}
          </Link>
          <span className="fu-cat">{f.category || (f.kind === "red" ? "Issue" : "Opportunity")}</span>
          {f.urgency && <span className={`urg ${f.urgency}`}>{urgencyLabel(f.urgency)}</span>}
        </div>
        {f.note && <div className="fu-note">{f.note}</div>}
        <div className="fu-meta">
          {f.owner && <span className="flag-owner">Owner: {f.owner}</span>}
          {f.due_date && (
            <span className={`flag-due ${overdue ? "overdue" : ""}`}>
              {overdue ? "Overdue " : "Due "}
              {fmtDate(f.due_date)}
            </span>
          )}
        </div>
      </div>
      <button
        className="handle sm"
        type="button"
        disabled={pending}
        onClick={() => {
          const outcome = window.prompt("Outcome / impact (optional):") ?? "";
          start(async () => {
            await resolveFlag({ flagId: f.id, employerId: f.employer_id, outcome });
          });
        }}
      >
        Resolve
      </button>
    </div>
  );
}
