import { sql } from "./db";

export interface SetupStep {
  step: string;
  ok: boolean;
  error?: string;
}

// Create the schema and seed the watchlist. Every statement is idempotent
// (create-if-not-exists / on-conflict-do-nothing), so this is safe to run any
// number of times. Used both by the dashboard's self-healing path (when it
// finds the tables missing) and by the /api/admin/migrate endpoint.
export async function ensureSchema(): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  async function run(step: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      steps.push({ step, ok: true });
    } catch (e) {
      steps.push({ step, ok: false, error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  await run("create table employers", () => sql`
    create table if not exists employers (
      id         serial primary key,
      name       text not null,
      aliases    text[] default '{}',
      uei        text,
      band       text,
      sector     text,
      addresses  jsonb default '[]',
      active     boolean default true
    )`);

  await run("create table signals", () => sql`
    create table if not exists signals (
      id                 bigserial primary key,
      employer_id        integer references employers(id),
      source             text not null,
      tier               text not null check (tier in ('authoritative','indicative')),
      signal_type        text check (signal_type in ('risk','growth','neutral')),
      category           text,
      priority           integer,
      summary            text,
      recommended_action text,
      talking_point      text,
      source_url         text,
      external_id        text not null,
      raw                jsonb,
      scored_at          timestamptz default now(),
      handled            boolean default false,
      unique (source, external_id)
    )`);

  await run("create index signals_open_idx", () => sql`
    create index if not exists signals_open_idx
      on signals (handled, signal_type, priority desc)`);

  await run("create table runs", () => sql`
    create table if not exists runs (
      id          bigserial primary key,
      source      text,
      started_at  timestamptz default now(),
      finished_at timestamptz,
      new_signals integer default 0,
      error       text
    )`);

  await run("create unique index employers_name_key", () => sql`
    create unique index if not exists employers_name_key on employers (name)`);

  await run("seed top bands (1,000+ / 500+)", () => sql`
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
    on conflict (name) do nothing`);

  await run("seed 250+ / 100+ / 50+ bands", () => sql`
    insert into employers (name, aliases, band, sector) values
      ('Watson & Chalin Mfg.',     array['Watson & Chalin','Watson & Chalin Manufacturing'], '250+', 'Suspension systems mfg.'),
      ('Cotiviti',                 array['Cotiviti'],                                          '250+', 'Healthcare analytics'),
      ('Leon''s Texas Cuisine',    array['Leon''s Texas Cuisine','Leons Texas Cuisine'],       '250+', 'Food manufacturing'),
      ('Service First Mortgage',   array['Service First Mortgage'],                            '250+', 'Mortgage lending'),
      ('Waste Connections',        array['Waste Connections'],                                 '250+', 'Waste & environmental'),
      ('Traxxas',                  array['Traxxas'],                                           '250+', 'RC vehicles (HQ)'),
      ('Pogue Construction',       array['Pogue Construction'],                                '100+', 'Construction'),
      ('Emerson',                  array['Emerson','Emerson Electric'],                        '100+', 'Automation'),
      ('Wistron Greentech',        array['Wistron Greentech','Wistron'],                       '100+', 'Electronics mfg.'),
      ('Tong Yang Group',          array['Tong Yang Group','Tong Yang'],                       '100+', 'Auto parts mfg.'),
      ('Aramark Uniform Services', array['Aramark Uniform Services','Aramark'],                '100+', 'Uniform services'),
      ('KVP',                      array['KVP','KVP International'],                            '100+', 'Animal health products'),
      ('Merrill Lynch Wealth Mgmt.', array['Merrill Lynch Wealth Management','Merrill Lynch'], '50+',  'Wealth management'),
      ('Oncor',                    array['Oncor','Oncor Electric Delivery'],                   '50+',  'Electric utility'),
      ('StatLab Medical',          array['StatLab Medical','StatLab'],                         '50+',  'Medical products mfg.'),
      ('Hisun',                    array['Hisun','Hisun Motors'],                              '50+',  'Powersports mfg.'),
      ('Kimley-Horn',              array['Kimley-Horn','Kimley Horn'],                         '50+',  'Engineering & planning'),
      ('RMinds',                   array['RMinds'],                                            '50+',  'IT services')
    on conflict (name) do nothing`);

  return steps;
}
