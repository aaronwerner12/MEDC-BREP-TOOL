-- McKinney Signal Desk - schema
-- Run against your Neon database (psql "$DATABASE_URL" -f migrations/0001_init.sql)

create table if not exists employers (
  id         serial primary key,
  name       text not null,
  aliases    text[] default '{}',   -- alternate legal / acquirer names for entity matching
  uei        text,                  -- SAM.gov unique entity id when known
  band       text,                  -- MEDC size band label
  sector     text,
  addresses  jsonb default '[]',    -- for place-of-performance / permit geofencing
  active     boolean default true
);

create table if not exists signals (
  id                 bigserial primary key,
  employer_id        integer references employers(id),
  source             text not null,   -- 'usaspending','costar','twc_warn','sec_edgar','permits'
  tier               text not null check (tier in ('authoritative','indicative')),
  signal_type        text check (signal_type in ('risk','growth','neutral')),
  category           text,
  priority           integer,
  summary            text,
  recommended_action text,
  talking_point      text,
  source_url         text,
  external_id        text not null,   -- feed's native id, for dedupe
  raw                jsonb,
  scored_at          timestamptz default now(),
  handled            boolean default false,
  unique (source, external_id)        -- makes re-runs idempotent
);

create index if not exists signals_open_idx
  on signals (handled, signal_type, priority desc);

create table if not exists runs (
  id          bigserial primary key,
  source      text,
  started_at  timestamptz default now(),
  finished_at timestamptz,
  new_signals integer default 0,
  error       text
);
