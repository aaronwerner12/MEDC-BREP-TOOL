-- Cache a short AI-written health briefing per employer.
alter table employers
  add column if not exists brief    text,
  add column if not exists brief_at timestamptz;
