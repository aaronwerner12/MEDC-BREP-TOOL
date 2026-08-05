-- USASpending snapshot-and-diff: track each employer's active federal contract
-- book over time so a portfolio that shrinks (non-renewal) fires a signal.
-- Additive and idempotent; the app also self-heals this via ensureSchema.

create table if not exists contract_snapshots (
  id             bigserial primary key,
  employer_id    integer references employers(id),
  total_active   numeric not null default 0,
  contract_count integer not null default 0,
  taken_at       timestamptz default now()
);
create index if not exists contract_snapshots_emp_idx on contract_snapshots (employer_id, taken_at desc);
