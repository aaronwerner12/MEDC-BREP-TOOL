-- BRE workflow: business visits and red/green flags with follow-ups.
-- Additive and idempotent. The app also self-heals this schema via ensureSchema.

create table if not exists visits (
  id           bigserial primary key,
  employer_id  integer references employers(id),
  visited_on   date not null default current_date,
  contact_name text,
  notes        text,
  created_at   timestamptz default now()
);
create index if not exists visits_emp_idx on visits (employer_id, visited_on desc);

create table if not exists flags (
  id           bigserial primary key,
  employer_id  integer references employers(id),
  kind         text not null check (kind in ('red','green')),
  category     text,
  note         text,
  urgency      text check (urgency in ('urgent','high','medium','low')),
  owner        text,
  status       text not null default 'open' check (status in ('open','resolved')),
  due_date     date,
  outcome      text,
  created_at   timestamptz default now(),
  resolved_at  timestamptz
);
create index if not exists flags_open_idx on flags (status, due_date);
create index if not exists flags_emp_idx on flags (employer_id, status);
