"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { addBusiness, discoverEmployers, removeBusiness, fillMissingProfiles, scanAllNews } from "./actions";

export type DirStatus = "risk" | "growth" | "watch" | "none";

export interface DirEmployer {
  id: number;
  name: string;
  sector: string | null;
  band: string | null;
  segment: "medc" | "mckinney";
  status: DirStatus;
}

// MEDC size bands, largest first; anything else falls into "Size not listed".
const BAND_ORDER = ["1,000+", "500+", "250+", "100+", "50+"];
function bandRank(b: string | null): number {
  const i = BAND_ORDER.indexOf(b ?? "");
  return i === -1 ? BAND_ORDER.length : i;
}
function bandLabel(b: string | null): string {
  return b && BAND_ORDER.includes(b) ? `${b} employees` : "Size not listed";
}

function statusLabel(s: DirStatus) {
  return s === "risk" ? "At risk" : s === "growth" ? "Growing" : s === "watch" ? "Watch" : "No signals";
}

type View = "all" | "medc" | "mckinney";

export function BusinessDirectory({ employers }: { employers: DirEmployer[] }) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");
  const [name, setName] = useState("");
  const [sector, setSector] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [discovering, startDiscover] = useTransition();

  const medcCount = useMemo(() => employers.filter((e) => e.segment === "medc").length, [employers]);
  const mckCount = employers.length - medcCount;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return employers.filter((e) => {
      if (view === "medc" && e.segment !== "medc") return false;
      if (view === "mckinney" && e.segment !== "mckinney") return false;
      if (!needle) return true;
      return e.name.toLowerCase().includes(needle) || (e.sector ?? "").toLowerCase().includes(needle);
    });
  }, [q, view, employers]);

  // Group the filtered firms by size band, largest first.
  const groups = useMemo(() => {
    const byBand = new Map<string, DirEmployer[]>();
    for (const e of filtered) {
      const key = e.band && BAND_ORDER.includes(e.band) ? e.band : "__other__";
      const arr = byBand.get(key);
      if (arr) arr.push(e);
      else byBand.set(key, [e]);
    }
    const keys = [...byBand.keys()].sort(
      (a, b) => bandRank(a === "__other__" ? null : a) - bandRank(b === "__other__" ? null : b)
    );
    return keys.map((k) => ({
      band: k === "__other__" ? null : k,
      rows: byBand.get(k)!.sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [filtered]);

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
          <h1>Firms</h1>
          <div className="tag">Every substantial McKinney business the desk tracks</div>
        </div>
        <div className="spacer" />
        <Link className="navlink" href="/">
          ← Desk
        </Link>
      </header>

      <div className="dir-summary">
        Tracking <strong>{employers.length}</strong> firm{employers.length === 1 ? "" : "s"} ·{" "}
        <strong>{medcCount}</strong> notable (MEDC) · <strong>{mckCount}</strong> broader directory
      </div>

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
        <div className="discover-row">
          <FillProfilesButton />
        </div>
        <div className="discover-row">
          <ScanAllNewsButton />
        </div>
      </form>

      <div className="biz-controls">
        <input
          className="paste-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${employers.length} tracked firms…`}
        />
        <div className="seg-toggle">
          <button className={view === "all" ? "seg on" : "seg"} type="button" onClick={() => setView("all")}>
            All ({employers.length})
          </button>
          <button className={view === "medc" ? "seg on" : "seg"} type="button" onClick={() => setView("medc")}>
            Notable ({medcCount})
          </button>
          <button
            className={view === "mckinney" ? "seg on" : "seg"}
            type="button"
            onClick={() => setView("mckinney")}
          >
            Directory ({mckCount})
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No firms match.</div>
      ) : (
        groups.map((g) => (
          <BandGroup key={g.band ?? "other"} band={g.band} rows={g.rows} />
        ))
      )}
    </div>
  );
}

function BandGroup({ band, rows }: { band: string | null; rows: DirEmployer[] }) {
  return (
    <>
      <div className="col-head" style={{ marginTop: 22 }}>
        {bandLabel(band)}
        <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
          {" "}
          · {rows.length} firm{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="card biz-list">
        {rows.map((e) => (
          <div className="emp dir-row" key={e.id}>
            <Link className="dir-main" href={`/employer/${e.id}`}>
              <span className={`dot ${e.status}`} />
              <div className="info">
                <div className="name">
                  {e.name}
                  {e.segment === "medc" && <span className="chip medc">MEDC</span>}
                </div>
                {e.sector && <div className="sector">{e.sector}</div>}
              </div>
              {e.band && <span className="chip band">{e.band}</span>}
              <span className={`status ${e.status}`}>{statusLabel(e.status)}</span>
            </Link>
            <RemoveBtn id={e.id} name={e.name} />
          </div>
        ))}
      </div>
    </>
  );
}

// Fills profiles for every company missing one, using the free source chain.
// Auto-continues batch by batch until nothing new can be filled.
function FillProfilesButton() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setMsg("Filling profiles from free sources…");
    let totalFilled = 0;
    try {
      for (let round = 0; round < 20; round++) {
        const r = await fillMissingProfiles();
        if (!r.ok) {
          setMsg(r.error ?? "Could not fill profiles.");
          break;
        }
        totalFilled += r.filled;
        if (r.remaining === 0) {
          setMsg(`Done. Filled ${totalFilled}. Every company now has a profile.`);
          break;
        }
        if (r.scanned === 0 || r.filled === 0) {
          setMsg(
            `Filled ${totalFilled}. ${r.remaining} company${r.remaining === 1 ? "" : "s"} had no free public record (open one to try an AI lookup).`
          );
          break;
        }
        setMsg(`Filled ${totalFilled} so far, ${r.remaining} to go…`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not fill profiles.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <button className="handle" type="button" disabled={running} onClick={run}>
        {running ? "Filling profiles…" : "Fill missing profiles (free)"}
      </button>
      {msg && <span className="add-biz-msg" style={{ margin: 0 }}>{msg}</span>}
    </>
  );
}

// Scans the free news feed for every tracked company in one go.
function ScanAllNewsButton() {
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <>
      <button
        className="handle"
        type="button"
        disabled={running}
        onClick={async () => {
          if (running) return;
          setRunning(true);
          setMsg("Scanning news for every company…");
          try {
            const r = await scanAllNews();
            setMsg(
              r.ok
                ? `Scanned ${r.scanned}. Added ${r.added} news signal${r.added === 1 ? "" : "s"}.`
                : r.error ?? "News scan failed."
            );
          } catch (e) {
            setMsg(e instanceof Error ? e.message : "News scan failed.");
          } finally {
            setRunning(false);
          }
        }}
      >
        {running ? "Scanning news…" : "Scan news for all (free)"}
      </button>
      {msg && <span className="add-biz-msg" style={{ margin: 0 }}>{msg}</span>}
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
