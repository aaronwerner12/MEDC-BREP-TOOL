"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addBusiness, discoverEmployers, removeBusiness } from "./actions";

export type DirStatus = "risk" | "growth" | "watch" | "none";

export interface DirEmployer {
  id: number;
  name: string;
  sector: string | null;
  band: string | null;
  segment: "medc" | "mckinney";
  status: DirStatus;
}

function statusLabel(s: DirStatus) {
  return s === "risk" ? "At risk" : s === "growth" ? "Growing" : s === "watch" ? "Watch" : "No signals";
}

export function BusinessDirectory({ employers }: { employers: DirEmployer[] }) {
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [discovering, startDiscover] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return employers;
    return employers.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) || (e.sector ?? "").toLowerCase().includes(needle)
    );
  }, [q, employers]);

  const medc = filtered.filter((e) => e.segment === "medc");
  const mck = filtered.filter((e) => e.segment === "mckinney");

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setMsg(null);
    start(async () => {
      const res = await addBusiness({ name, sector });
      if (res.ok) {
        setName("");
        setSector("");
        setMsg("Added. It will start matching feeds on the next pull.");
      } else {
        setMsg(res.error ?? "Could not add.");
      }
    });
  }

  return (
    <div className="wrap">
      <header className="head">
        <div className="logo">
          <ScanIcon />
        </div>
        <div>
          <h1>Businesses</h1>
          <div className="tag">Every McKinney business the desk is tracking</div>
        </div>
        <div className="spacer" />
        <Link className="navlink" href="/">
          ← Desk
        </Link>
      </header>

      <form className="add-biz card" onSubmit={submitAdd}>
        <div className="add-biz-row">
          <input
            className="paste-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add a McKinney business (name)"
          />
          <input
            className="paste-input"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder="Sector (optional)"
          />
          <button className="btn-primary" type="submit" disabled={pending || !name.trim()}>
            {pending ? "Adding…" : "Add"}
          </button>
        </div>
        {msg && <div className="add-biz-msg">{msg}</div>}
        <div className="discover-row">
          <button
            className="handle"
            type="button"
            disabled={discovering}
            onClick={() =>
              startDiscover(async () => {
                setDiscoverMsg(null);
                const r = await discoverEmployers();
                setDiscoverMsg(
                  r.ok
                    ? `Found ${r.found ?? 0}, added ${r.added ?? 0} new. Review and prune below.`
                    : r.error ?? "Discovery failed."
                );
              })
            }
          >
            {discovering ? "Discovering…" : "Discover McKinney employers (web)"}
          </button>
          {discoverMsg && <span className="add-biz-msg" style={{ margin: 0 }}>{discoverMsg}</span>}
        </div>
      </form>

      <div className="biz-search">
        <input
          className="paste-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${employers.length} tracked businesses…`}
        />
      </div>

      <DirGroup title="MEDC watchlist" subtitle="Top notable employers" rows={medc} />
      <DirGroup title="McKinney directory" subtitle="Broader tracked businesses" rows={mck} />
    </div>
  );
}

function DirGroup({ title, subtitle, rows }: { title: string; subtitle: string; rows: DirEmployer[] }) {
  return (
    <>
      <div className="col-head" style={{ marginTop: 24 }}>
        {title} · {rows.length}
        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}> — {subtitle}</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">Nothing here yet.</div>
      ) : (
        <div className="card biz-list">
          {rows.map((e) => (
            <div className="emp dir-row" key={e.id}>
              <Link className="dir-main" href={`/employer/${e.id}`}>
                <span className={`dot ${e.status}`} />
                <div className="info">
                  <div className="name">{e.name}</div>
                  {e.sector && <div className="sector">{e.sector}</div>}
                </div>
                {e.band && <span className="chip band">{e.band}</span>}
                <span className={`status ${e.status}`}>{statusLabel(e.status)}</span>
              </Link>
              <RemoveBtn id={e.id} name={e.name} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RemoveBtn({ id, name }: { id: number; name: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="dir-remove"
      type="button"
      title={`Remove ${name}`}
      disabled={pending}
      onClick={() => {
        if (confirm(`Remove ${name} from the tracked list? It will stop being tracked.`)) {
          start(async () => {
            await removeBusiness(id);
          });
        }
      }}
    >
      {pending ? "…" : "✕"}
    </button>
  );
}

function ScanIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
