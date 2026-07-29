# tasks.md — McKinney Signal Desk build queue

Work these in order, one task at a time. Finish a task's "Done when" checks before starting the next. Read `CLAUDE.md` first. Follow the existing adapter pattern in `adapters/usaspending.ts`.

---

## Task 0 — Bootstrap and verify the scaffold

- [ ] Install deps: `npm i @neondatabase/serverless @anthropic-ai/sdk resend`
- [ ] Copy `.env.example` to `.env.local` and fill `DATABASE_URL`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `BRE_LEAD_EMAIL`, `CRON_SECRET`
- [ ] Run migrations: `psql "$DATABASE_URL" -f migrations/0001_init.sql` then `-f migrations/0002_seed.sql`
- [ ] Confirm seed: `psql "$DATABASE_URL" -c "select name, aliases from employers;"` returns 10 rows
- [ ] Start dev server and hit the USASpending route with the cron secret:
      `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/usaspending`
- [ ] Confirm at least one signal row was inserted, or a clean `{found:0, inserted:0}` with no error
- [ ] Hit the digest route and confirm an email arrives (or `{sent:false, reason:"no new signals"}`)

**Done when:** migrations applied, both routes return 200, and the pipeline writes to Neon without errors.

---

## Task 1 — Texas WARN adapter (highest priority)

Daily feed of state layoff notices. This is the single best risk signal.

- [ ] Create `adapters/twcWarn.ts` exporting `twcWarnSignals(employers): Promise<NormalizedSignal[]>`
- [ ] Source the current Texas Workforce Commission WARN listing (confirm the current URL/format from TWC before coding; it is a published listing, not a clean API, so expect to parse a table or downloadable file)
- [ ] Filter to notices in McKinney or Collin County, or matching a watchlist employer via `matchEmployer`
- [ ] Map each notice: `source:'twc_warn'`, `tier:'authoritative'`, `externalId` = notice id or `company+date`, `observedText` = employer, location, affected count, effective date
- [ ] Create `app/api/cron/twc-warn/route.ts` mirroring `app/api/cron/usaspending/route.ts`
- [ ] Add `{ "path": "/api/cron/twc-warn", "schedule": "0 11 * * *" }` to `vercel.json`
- [ ] Test locally with the cron secret and confirm parsing against a real recent notice

**Done when:** the route ingests real WARN notices, scored as risk, deduped by `externalId`, and a known McKinney notice (if any exists) matches to the right employer.

---

## Task 2 — USASpending snapshot-and-diff

Catch non-renewed contracts that simply disappear, not just ones with a near-term end date.

- [ ] Add `migrations/0003_snapshots.sql`: `contract_snapshots(award_id text, recipient text, amount numeric, end_date date, seen_at timestamptz default now())`
- [ ] In `adapters/usaspending.ts`, after fetching, upsert the current active awards into `contract_snapshots`
- [ ] Compare against the previous run: any award present last run but absent now (and not simply ended on schedule) becomes a `risk` signal with `externalId` = `${awardId}:gone`
- [ ] Keep the existing near-term-expiry and new/large logic
- [ ] Test by seeding a fake prior snapshot, removing it from the fetch mock, and confirming a "gone" signal fires

**Done when:** a disappeared award produces exactly one risk signal and does not re-fire on the following run.

---

## Task 3 — SEC EDGAR adapter

Daily filings for public employers (Globe Life, Independent Financial/SouthState).

- [ ] Create `adapters/secEdgar.ts` exporting `secEdgarSignals(employers): Promise<NormalizedSignal[]>`
- [ ] Use EDGAR's public filings API (confirm current endpoints from the SEC developer docs; set a proper `User-Agent`, which EDGAR requires)
- [ ] Pull recent 8-K / 10-K / 10-Q filings for the public watchlist employers (map by CIK; store CIK alongside the employer if helpful)
- [ ] Flag filings whose content touches headcount, facilities, relocation, or M&A; pass the item summary as `observedText`
- [ ] `source:'sec_edgar'`, `tier:'authoritative'`, `externalId` = accession number
- [ ] Route + daily cron line, same pattern

**Done when:** recent filings for at least one public employer are ingested and correctly classified, deduped by accession number.

---

## Task 4 — Permits adapter

Daily City of McKinney + Collin County permit activity, the leading facility-growth/exit indicator.

- [ ] Populate `employers.addresses` for watchlist firms (needed for geofencing)
- [ ] Create `adapters/permits.ts` exporting `permitSignals(employers): Promise<NormalizedSignal[]>`
- [ ] Source McKinney and Collin County permit data (confirm the current open-data endpoints or portals)
- [ ] Match permits to watchlist employers by address/geofence; new construction or large additions = growth, demolition/decommission = risk
- [ ] `source:'permits'`, `tier:'authoritative'`, `externalId` = permit number
- [ ] Route + daily cron line

**Done when:** a real recent permit near a watchlist address ingests and matches to the right employer.

---

## Task 5 — Dashboard page

A Next.js page rendering the queue and watchlist, matching the existing React prototype.

- [ ] Create `app/page.tsx` (or `/app/desk/page.tsx`) that reads open signals and the banded watchlist from Neon
- [ ] Reuse the prototype's design: denim/navy anchor, Cotton surfaces, McK Mint = growth, Sunflower = watch, brick red = risk; Josefin Sans + Libre Franklin
- [ ] Action queue sorted by priority, authoritative above indicative; watchlist grouped by MEDC size band
- [ ] "Mark handled" writes `signals.handled = true`
- [ ] Server components for reads; a small route handler or server action for the handled toggle

**Done when:** the page renders live Neon data, the bands and colors match the prototype, and marking handled persists.

---

## Task 6 — Deploy

- [ ] Push to a Git repo and import into Vercel
- [ ] Set all env vars in Vercel (Production + Preview), including `CRON_SECRET`
- [ ] Confirm `vercel.json` crons register after deploy (Project → Settings → Cron Jobs)
- [ ] Manually trigger each cron once from the dashboard and confirm inserts + a digest email
- [ ] Verify times: `0 12 * * *` UTC is ~7am Central; adjust if you want an exact local hour

**Done when:** all Phase 1 crons run on schedule in production and the morning digest lands in the BRE lead's inbox.

---

## Guardrails (apply to every task)

- Confirm an external API's current contract from its docs before coding against it.
- Never run destructive DB commands without confirming; migrations stay additive.
- Adapters report only what a feed returns. The scorer classifies, it never invents signals.
- Indicative signals never enter a public document without a human confirming first.
