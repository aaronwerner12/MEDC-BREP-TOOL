"use client";

import Link from "next/link";
import { EdcMark, EdcWordmark } from "./edc-mark";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Desk", icon: DeskIcon, match: (p: string) => p === "/" || p.startsWith("/employer") },
  { href: "/businesses", label: "Firms", icon: FirmsIcon, match: (p: string) => p.startsWith("/businesses") },
  { href: "/followups", label: "Follow-ups", icon: FollowupsIcon, match: (p: string) => p.startsWith("/followups") },
  { href: "/report", label: "Report", icon: ReportIcon, match: (p: string) => p.startsWith("/report") },
  { href: "/sources", label: "Sources", icon: SourcesIcon, match: (p: string) => p.startsWith("/sources") },
  { href: "/handled", label: "Handled", icon: HandledIcon, match: (p: string) => p.startsWith("/handled") },
];

export function Sidebar() {
  const pathname = usePathname() || "/";
  return (
    <nav className="rail">
      <div className="rail-logo" title="McKinney Business Retention & Expansion Monitor">
        <EdcMark />
      </div>
      {ITEMS.map((it) => {
        const active = it.match(pathname);
        const Icon = it.icon;
        return (
          <Link key={it.href} href={it.href} className={`rail-item ${active ? "active" : ""}`}>
            <Icon />
            <span>{it.label}</span>
          </Link>
        );
      })}
      <div className="rail-brand">
        <EdcWordmark />
      </div>
    </nav>
  );
}

const sp = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function DeskIcon() {
  return (
    <svg {...sp}>
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  );
}
function FirmsIcon() {
  return (
    <svg {...sp}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h6" />
    </svg>
  );
}
function FollowupsIcon() {
  return (
    <svg {...sp}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}
function ReportIcon() {
  return (
    <svg {...sp}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13h6M9 17h6M9 9h1" />
    </svg>
  );
}
function SourcesIcon() {
  return (
    <svg {...sp}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
function HandledIcon() {
  return (
    <svg {...sp}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
