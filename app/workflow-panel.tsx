"use client";

import { useState, useTransition } from "react";
import { logVisit, addFlag, resolveFlag, reopenFlag } from "./actions";
import {
  FLAG_CATEGORIES,
  URGENCIES,
  urgencyLabel,
  urgencyRank,
  visitState,
  isFollowupOverdue,
} from "@/lib/workflow";

export interface VisitRow {
  id: number;
  visited_on: string;
  contact_name: string | null;
  notes: string | null;
}
export interface FlagRow {
  id: number;
  kind: "red" | "green";
  category: string | null;
  note: string | null;
  urgency: string | null;
  owner: string | null;
  status: "open" | "resolved";
  due_date: string | null;
  outcome: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function WorkflowPanel({
  employerId,
  visits,
  flags,
}: {
  employerId: number;
  visits: VisitRow[];
  flags: FlagRow[];
}) {
  const vs = visitState(visits[0]?.visited_on ?? null);
  const open = flags
    .filter((f) => f.status === "open")
    .sort((a, b) => {
      const ao = isFollowupOverdue(a.due_date, a.status) ? 0 : 1;
      const bo = isFollowupOverdue(b.due_date, b.status) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return urgencyRank(a.urgency) - urgencyRank(b.urgency);
    });
  const resolved = flags.filter((f) => f.status === "resolved");

  return (
    <div className="brief card" style={{ borderLeftColor: "var(--sun)" }}>
      <div className="brief-head">
        <span className="brief-title">Retention workflow</span>
        <span className={`visit-state ${vs.overdue ? "due" : "ok"}`}>{vs.label}</span>
      </div>

      <VisitForm employerId={employerId} />

      {visits.length > 0 && (
        <div className="visit-log">
          {visits.slice(0, 3).map((v) => (
            <div className="visit-row" key={v.id}>
              <span className="visit-date">{fmtDate(v.visited_on)}</span>
              <span className="visit-who">{v.contact_name || "Visit"}</span>
              {v.notes && <span className="visit-notes">{v.notes}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="flags-head">Flags &amp; follow-ups</div>
      <FlagForm employerId={employerId} />

      {open.length === 0 ? (
        <div className="empty sm">No open flags. Add issues to resolve or opportunities to pursue.</div>
      ) : (
        <div className="flag-list">
          {open.map((f) => (
            <FlagItem key={f.id} f={f} employerId={employerId} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="resolved-flags">
          <summary>{resolved.length} resolved</summary>
          {resolved.map((f) => (
            <FlagItem key={f.id} f={f} employerId={employerId} resolved />
          ))}
        </details>
      )}
    </div>
  );
}

function VisitForm({ employerId }: { employerId: number }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button className="handle" type="button" onClick={() => setOpen(true)}>
        Log a visit
      </button>
    );
  }
  return (
    <form
      className="wf-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        start(async () => {
          await logVisit({ employerId, visitedOn: date, contactName: contact, notes });
          setDate("");
          setContact("");
          setNotes("");
          setOpen(false);
        });
      }}
    >
      <div className="wf-row">
        <input className="paste-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          className="paste-input"
          placeholder="Who you met (name / title)"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
        />
      </div>
      <textarea
        className="paste-input"
        rows={2}
        placeholder="Notes from the visit (needs, plans, concerns)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="wf-actions">
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save visit"}
        </button>
        <button className="handle" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FlagForm({ employerId }: { employerId: number }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"red" | "green">("red");
  const [category, setCategory] = useState<string>(FLAG_CATEGORIES[0]);
  const [urgency, setUrgency] = useState<string>("medium");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button className="handle" type="button" onClick={() => setOpen(true)}>
        + Add flag
      </button>
    );
  }
  return (
    <form
      className="wf-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        start(async () => {
          await addFlag({ employerId, kind, category, urgency, owner, dueDate: due, note });
          setOwner("");
          setDue("");
          setNote("");
          setOpen(false);
        });
      }}
    >
      <div className="wf-row">
        <div className="kind-toggle">
          <button
            type="button"
            className={kind === "red" ? "kt on red" : "kt"}
            onClick={() => setKind("red")}
          >
            Issue (red)
          </button>
          <button
            type="button"
            className={kind === "green" ? "kt on green" : "kt"}
            onClick={() => setKind("green")}
          >
            Opportunity (green)
          </button>
        </div>
      </div>
      <div className="wf-row">
        <select className="paste-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          {FLAG_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="paste-input" value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          {URGENCIES.map((u) => (
            <option key={u} value={u}>
              {urgencyLabel(u)}
            </option>
          ))}
        </select>
      </div>
      <div className="wf-row">
        <input
          className="paste-input"
          placeholder="Owner (who follows up)"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <input
          className="paste-input"
          type="date"
          title="Follow-up due date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </div>
      <textarea
        className="paste-input"
        rows={2}
        placeholder="What is the issue or opportunity, and the next step…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="wf-actions">
        <button className="btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save flag"}
        </button>
        <button className="handle" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FlagItem({
  f,
  employerId,
  resolved,
}: {
  f: FlagRow;
  employerId: number;
  resolved?: boolean;
}) {
  const [pending, start] = useTransition();
  const overdue = isFollowupOverdue(f.due_date, f.status);
  return (
    <div className={`flag-item ${f.kind}`}>
      <span className={`flag-dot ${f.kind}`} />
      <div className="flag-body">
        <div className="flag-top">
          <span className="flag-cat">{f.category || (f.kind === "red" ? "Issue" : "Opportunity")}</span>
          {f.urgency && <span className={`urg ${f.urgency}`}>{urgencyLabel(f.urgency)}</span>}
          {f.due_date && (
            <span className={`flag-due ${overdue ? "overdue" : ""}`}>
              {overdue ? "Overdue " : "Due "}
              {fmtDate(f.due_date)}
            </span>
          )}
        </div>
        {f.note && <div className="flag-note">{f.note}</div>}
        <div className="flag-meta">
          {f.owner && <span className="flag-owner">Owner: {f.owner}</span>}
          {resolved && f.outcome && <span className="flag-outcome">Outcome: {f.outcome}</span>}
        </div>
      </div>
      {!resolved ? (
        <button
          className="handle sm"
          type="button"
          disabled={pending}
          onClick={() => {
            const outcome = window.prompt("Outcome / impact (optional):") ?? "";
            start(async () => {
              await resolveFlag({ flagId: f.id, employerId, outcome });
            });
          }}
        >
          Resolve
        </button>
      ) : (
        <button
          className="handle sm"
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await reopenFlag({ flagId: f.id, employerId }); })}
        >
          Reopen
        </button>
      )}
    </div>
  );
}
