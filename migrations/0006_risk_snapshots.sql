-- History of each employer's computed retention-risk index, one row per pull,
-- so the desk can show a trend (rising / falling) over time.
create table if not exists risk_snapshots (
  id          bigserial primary key,
  employer_id integer references employers(id),
  score       integer not null,
  level       text,
  taken_at    timestamptz default now()
);

create index if not exists risk_snapshots_emp_idx on risk_snapshots (employer_id, taken_at desc);
