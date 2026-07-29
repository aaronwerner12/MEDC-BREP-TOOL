-- Expand the watchlist to the full MEDC banded list.
-- The 1,000+ and 500+ bands were seeded in 0002; this adds the 250+, 100+, and
-- 50+ tiers reconstructed from the owner's dashboard prototype.
--
-- Idempotency: add a unique index on employer name (names are distinct), so this
-- and the 0002 seed can be re-run safely without duplicating rows.

create unique index if not exists employers_name_key on employers (name);

insert into employers (name, aliases, band, sector) values
  -- 250+ band
  ('Watson & Chalin Mfg.',     array['Watson & Chalin','Watson & Chalin Manufacturing'], '250+', 'Suspension systems mfg.'),
  ('Cotiviti',                 array['Cotiviti'],                                          '250+', 'Healthcare analytics'),
  ('Leon''s Texas Cuisine',    array['Leon''s Texas Cuisine','Leons Texas Cuisine'],       '250+', 'Food manufacturing'),
  ('Service First Mortgage',   array['Service First Mortgage'],                            '250+', 'Mortgage lending'),
  ('Waste Connections',        array['Waste Connections'],                                 '250+', 'Waste & environmental'),
  ('Traxxas',                  array['Traxxas'],                                           '250+', 'RC vehicles (HQ)'),

  -- 100+ band
  ('Pogue Construction',       array['Pogue Construction'],                                '100+', 'Construction'),
  ('Emerson',                  array['Emerson','Emerson Electric'],                        '100+', 'Automation'),
  ('Wistron Greentech',        array['Wistron Greentech','Wistron'],                       '100+', 'Electronics mfg.'),
  ('Tong Yang Group',          array['Tong Yang Group','Tong Yang'],                       '100+', 'Auto parts mfg.'),
  ('Aramark Uniform Services', array['Aramark Uniform Services','Aramark'],                '100+', 'Uniform services'),
  ('KVP',                      array['KVP','KVP International'],                            '100+', 'Animal health products'),

  -- 50+ band
  ('Merrill Lynch Wealth Mgmt.', array['Merrill Lynch Wealth Management','Merrill Lynch'], '50+',  'Wealth management'),
  ('Oncor',                    array['Oncor','Oncor Electric Delivery'],                   '50+',  'Electric utility'),
  ('StatLab Medical',          array['StatLab Medical','StatLab'],                         '50+',  'Medical products mfg.'),
  ('Hisun',                    array['Hisun','Hisun Motors'],                              '50+',  'Powersports mfg.'),
  ('Kimley-Horn',              array['Kimley-Horn','Kimley Horn'],                         '50+',  'Engineering & planning')
on conflict (name) do nothing;

-- NOTE: three firms in the prototype were cut off at band edges and are not yet
-- seeded (2 in the 250+ band, 1 in the 50+ band). Add them here once confirmed.
