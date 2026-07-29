# CLAUDE.md — McKinney Signal Desk

Context for Claude Code. Read this fully before making changes.

## What this project is

A proactive business retention and expansion (BRE) early-warning system for the City of McKinney, Texas economic development team. It watches signals about major local employers (federal contracts, layoff notices, SEC filings, permits, commercial lease activity) and surfaces at-risk or expanding companies before they call, so the team can act early.

The owner is the executive director of the local destination/economic-development side and is technically fluent. Keep explanations direct and skip hand-holding.

## Stack

Next.js (App Router) on Vercel · Neon Postgres (`@neondatabase/serverless`) · Claude via `@anthropic-ai/sdk` for scoring · Resend for the digest email · Vercel Cron for scheduling.

## Architecture (do not break this shape)

```
adapter (per feed)  ->  scoreSignal()  ->  ingestSignal()  ->  Neon
                                                                 ├─ dashboard (Next page)
                                                                 └─ daily Resend digest
```

Every adapter returns `NormalizedSignal[]` (see `lib/types.ts`). The scorer and ingester never need to know which feed produced a signal. Adding a feed = a new file in `adapters/` + a route in `app/api/cron/<source>/` + a line in `vercel.json`. Keep to this pattern.

## The two-tier rule (load-bearing — never violate)

Every signal carries a `tier`:
- **authoritative** (WARN, SEC, federal contracts, permits) — can drive action directly.
- **indicative** (CoStar lease/sublease, job postings, reviews, news) — a human must confirm before it becomes a retention visit or enters any public document (council packet, partner letter).

The digest sorts authoritative above indicative and labels indicative items "confirm before outreach." Do not remove this.

## Current state (Phase 1, scaffolded)

Done:
- `migrations/0001_init.sql`, `0002_seed.sql` — schema + watchlist seed with entity aliases.
- `lib/db.ts`, `lib/types.ts`, `lib/employers.ts`, `lib/score.ts`, `lib/ingest.ts` — shared core.
- `adapters/usaspending.ts` — federal contracts (RTX/defense cluster), Collin County place of performance, flags near-term expirations and new/large awards. WORKED.
- `adapters/costarEmail.ts` + `app/api/inbound/costar/route.ts` — parses CoStar saved-search alert emails (a standard seat has no clean API). WORKED.
- `app/api/cron/usaspending/route.ts`, `app/api/cron/digest/route.ts`, `vercel.json`, `.env.example`.

Ingestion is idempotent via `unique (source, external_id)`, so re-runs never duplicate.

## What to build next (in order)

1. **Texas WARN adapter (TWC)** — highest-value risk feed. Daily. Scheduled pull of the state's WARN layoff-notice listing, filtered to McKinney/Collin employers, `tier: 'authoritative'`. Mirror the USASpending route.
2. **USASpending snapshot-and-diff** — add a `contract_snapshots` table; compare each weekly run so a contract that simply disappears (non-renewed) also fires a risk signal, not just ones with a near-term end date.
3. **SEC EDGAR adapter** — daily, for public employers (Globe Life, Independent Financial/SouthState). Use EDGAR's filings/full-text API; flag 8-K/10-K items touching headcount, facilities, or M&A.
4. **Permits adapter** — daily, City of McKinney + Collin County permit data, geofenced to watchlist addresses (see `employers.addresses`).
5. **Dashboard page** — a Next.js route rendering the signal queue and watchlist; the React prototype the owner already has is the design reference (denim/navy, Cotton surfaces, McK Mint for growth, Sunflower for watch, brick red for risk; Josefin Sans + Libre Franklin).

## Conventions

- TypeScript throughout. Keep adapters pure (fetch + map), side effects in routes.
- Entity matching goes through `matchEmployer` with the alias table; when a feed exposes a SAM.gov UEI, prefer matching on `employers.uei`.
- Scoring uses Haiku for cost; batch overnight items. Use a larger model only for anything headed into a public document.
- Any copy written for humans (emails, UI, letters): no em dashes, plain direct voice.
- Cron times are UTC. The 7am Central digest is `0 12 * * *`.
- Set `CRON_SECRET` in Vercel; cron routes authorize against it. Never expose it client-side.

## Watchlist (MEDC notable employers, top bands)

1,000+: Raytheon Intelligence & Space (aliases: Raytheon, RTX), Globe Life (AIL), Independent Financial (Independent Bank Group, SouthState), Encore Wire (Prysmian).
500+: Dynacraft (PACCAR), Amazon, LifePath Systems, Simpson Strong-Tie, Blount Fine Foods, SRS Distribution (Home Depot).

Known context: Independent Financial was acquired by Florida-based SouthState (closed Jan 2025) — the standing retention risk. Encore/Prysmian and SRS are expansions. RTX and Dynacraft carry sector-driven risk.

## Guardrails

- Do not fabricate signals. Adapters report only what a feed actually returns; the scorer classifies, it does not invent.
- Do not run destructive DB commands without confirming. Migrations are additive.
- When unsure about an external API's contract, check its docs before coding against it.
