-- When the underlying event actually happened (WARN notice date, SEC filing
-- date, etc.), so the queue can sink older news even when it was ingested
-- recently. Defaults to scored_at when a feed does not provide one.
alter table signals
  add column if not exists event_date timestamptz;

update signals set event_date = scored_at where event_date is null;
