-- Seed the watchlist. Aliases matter: federal and SEC data use legal names
-- that differ from the labels you use, and acquirers should be tracked too.

insert into employers (name, aliases, band, sector) values
  ('Raytheon Intelligence & Space', array['Raytheon','RTX','RTX Corporation','Raytheon Company'], '1,000+', 'Defense electronics'),
  ('Globe Life', array['Globe Life','Globe Life Inc','American Income Life','AIL'], '1,000+', 'Insurance (HQ)'),
  ('Independent Financial', array['Independent Bank Group','SouthState','SouthState Corporation'], '1,000+', 'Banking (HQ)'),
  ('Encore Wire', array['Encore Wire','Prysmian'], '1,000+', 'Wire & cable mfg.'),
  ('Dynacraft', array['Dynacraft','PACCAR'], '500+', 'Truck components mfg.'),
  ('Amazon', array['Amazon','Amazon.com Services'], '500+', 'Fulfillment & logistics'),
  ('LifePath Systems', array['LifePath Systems'], '500+', 'Health & human services'),
  ('Simpson Strong-Tie', array['Simpson Strong-Tie','Simpson Manufacturing'], '500+', 'Building products mfg.'),
  ('Blount Fine Foods', array['Blount Fine Foods','Blount'], '500+', 'Food manufacturing'),
  ('SRS Distribution', array['SRS Distribution','SRS','Home Depot'], '500+', 'Building products dist. (HQ)')
on conflict do nothing;
