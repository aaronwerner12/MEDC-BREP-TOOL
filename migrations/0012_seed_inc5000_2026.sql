-- McKinney honorees on the 2026 Inc. 5000 (fastest-growing private companies).
-- Tracked as notable employers (segment defaults to 'medc') so the desk and the
-- intelligence report watch them as expansion stories. Band is left null
-- (headcount not published); sector is set only where the name is unambiguous.
-- The free profile chain fills the rest. Idempotent via the name unique index.
--
-- The source post named eleven honorees but one was not legible in the
-- screenshot. Add the eleventh here when confirmed.

insert into employers (name, aliases, sector) values
  ('ILS Gummies',            array['ILS Gummies'],                                           'Confectionery / supplement mfg.'),
  ('Albers Aerospace',       array['Albers Aerospace'],                                      'Aerospace'),
  ('Maverick Power',         array['Maverick Power'],                                        null),
  ('Outdoorsiness',          array['Outdoorsiness'],                                         null),
  ('Aiden Technologies',     array['Aiden Technologies','Aiden Tech'],                       'Technology'),
  ('The Ramage Law Group',   array['The Ramage Law Group','Ramage Law Group','Ramage Law'], 'Legal services'),
  ('StarPoint Technologies', array['StarPoint Technologies','StarPoint'],                    'Technology'),
  ('Insuserve1',             array['Insuserve1','Insuserve'],                                'Insurance services'),
  ('Aloha',                  array['Aloha'],                                                 null),
  ('Invene',                 array['Invene'],                                                null)
on conflict (name) do nothing;
