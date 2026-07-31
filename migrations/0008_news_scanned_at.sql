-- Tracks when each employer was last news-scanned, so the daily cron can
-- round-robin a bounded batch (oldest first) and cover everyone over time.
alter table employers
  add column if not exists news_scanned_at timestamptz;
