-- The company's official/legal name (from the web profile lookup). When set, it
-- is used as the display heading; the originally entered name stays as the key
-- and an alias so feed matching is unaffected.
alter table employers
  add column if not exists official_name text;
