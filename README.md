# McKinney Signal Desk — Phase 1

Always-on BRE early-warning backend. Nightly/weekly jobs pull real feeds, score each item with Claude, write to Neon, and email a morning digest via Resend. This repo is Phase 1 of the build spec: the authoritative core plus the CoStar lease feed.

## What's here

```
migrations/          Neon schema + watchlist seed
lib/                 db client, types, employer matching, Claude scorer, ingester
adapters/            one function per feed (usaspending, costarEmail worked here)
app/api/cron/        scheduled routes (usaspending, digest)
app/api/inbound/     inbound CoStar alert-email webhook
vercel.json          cron schedule
```

The flow: **adapter → `scoreSignal` → `ingestSignal` → Neon → digest**. Every adapter returns the same `NormalizedSignal` shape, so adding a feed is just a new file in `adapters/` plus a route.

## Setup

1. `npm i @neondatabase/serverless @anthropic-ai/sdk resend` (inside a Next.js App Router project).
2. Create a Neon database, then run the migrations:
   ```
   psql "$DATABASE_URL" -f migrations/0001_init.sql
   psql "$DATABASE_URL" -f migrations/0002_seed.sql
   ```
3. Copy `.env.example` to `.env.local` and fill in the values. Set the same vars in Vercel (Project → Settings → Environment Variables), including `CRON_SECRET`.
4. Deploy to Vercel. `vercel.json` registers the crons automatically.

## The two worked feeds

**USASpending (RTX)** — `adapters/usaspending.ts`. Free public API, no key. Pulls Collin County contract awards for the defense cluster and flags near-term expirations (the leading layoff indicator for a defense site) and new/large awards. Runs weekly.

> Enhancement: swap the expiry heuristic for a weekly snapshot-and-diff so a contract that simply disappears (non-renewed) also fires a signal. Add a `contract_snapshots` table keyed by award id and compare runs.

**CoStar** — `adapters/costarEmail.ts` + `app/api/inbound/costar/route.ts`. A standard CoStar seat has no clean API, so this parses saved-search alert emails instead. In CoStar, create McKinney-submarket saved searches for new subleases, availabilities, and leases; route those alert emails to an inbox whose provider posts inbound mail to `/api/inbound/costar`. A sublease from a watchlist tenant is your best quiet-contraction signal.

## Adding the rest of Phase 1

Follow the same pattern for the other authoritative feeds:

- **Texas WARN (TWC)** — daily; scheduled scrape of the state layoff-notice listing. Highest-value risk feed. `tier: 'authoritative'`.
- **SEC EDGAR** — daily; EDGAR full-text/filings API for public employers (Globe Life, Independent Financial/SouthState). `tier: 'authoritative'`.
- **Permits** — daily; City of McKinney + Collin County permit data, geofenced to watchlist addresses. `tier: 'authoritative'`.

Each is: fetch → map to `NormalizedSignal[]` → add a `app/api/cron/<source>/route.ts` mirroring the USASpending route → add a cron line to `vercel.json`.

## Notes

- Vercel cron times are UTC. `0 12 * * *` is ~7:00 AM Central; adjust for DST if you care about the exact hour.
- The digest sorts authoritative signals above indicative ones and marks indicative items "confirm before outreach," per the two-tier rule.
- Scoring uses Haiku for cost; batch overnight items to keep spend to pennies. Use a larger model for anything headed into a public document.
- Nothing indicative should enter a council packet or partner letter without a human confirming it first.
