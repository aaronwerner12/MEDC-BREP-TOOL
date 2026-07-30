-- Two additions:
--  1. `segment` distinguishes the MEDC top-employer watchlist ('medc') from the
--     broader tracked McKinney business directory ('mckinney'). Existing rows
--     default to 'medc'.
--  2. `profile` / `profile_at` cache a web-sourced company profile per employer.
alter table employers
  add column if not exists segment    text default 'medc',
  add column if not exists profile    text,
  add column if not exists profile_at timestamptz;

-- Seed a starter set of major McKinney employers into the broader directory.
insert into employers (name, aliases, sector, segment) values
  ('McKinney ISD', array['McKinney Independent School District','MISD'], 'Public education', 'mckinney'),
  ('City of McKinney', array['City of McKinney'], 'Government', 'mckinney'),
  ('Collin College', array['Collin College','Collin County Community College'], 'Higher education', 'mckinney'),
  ('Medical City McKinney', array['Medical City McKinney','HCA Healthcare'], 'Healthcare', 'mckinney')
on conflict (name) do nothing;
