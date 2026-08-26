-- 0003_admin.sql — the staff area: roles, invitations, the colour list, the
-- costing constants, and the columns reports need.
--
-- Apply after 0002_shipping.sql.
--
-- ONE RULE GOVERNS THIS WHOLE FILE, and it is why `role` is not a column on
-- `profiles` where it obviously belongs:
--
--   0001_init.sql grants every signed-in account UPDATE on its own profile row,
--   across ALL columns ("own profile write", using auth.uid() = id). A `role`
--   column there would be writable by its owner over PostgREST with the anon key
--   that ships in the browser bundle. Any customer could make themselves staff
--   with one HTTP request. RLS cannot restrict a policy to a subset of columns.
--
-- So every table below that decides *authority* or exposes *cost* is
-- service_role only: RLS enabled with NO policy at all, plus an explicit revoke.
-- RLS-with-no-policy denies by default, and the revoke is what closes the hole
-- on a database where Supabase's default privileges already granted the table to
-- anon as it was created — the same trap `shipping_rate_cache` documented in
-- 0002. verify.sql asserts each one; do not add a policy to make something
-- "easier to query" from the client.

/* ------------------------------------------------------------------ staff */

-- Who can get behind the shopfront. Deliberately a separate table from
-- profiles, deliberately unreadable and unwritable with the public key.
create table if not exists public.staff (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  -- owner  — everything, including money and access
  -- studio — everything except access and settings
  -- packing— orders only: no costs, no prices, no catalogue
  role        text not null check (role in ('owner', 'studio', 'packing')),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.staff enable row level security;
revoke all on public.staff from anon, authenticated;
grant all on public.staff to service_role;

/* ------------------------------------------------------ staff invitations */

-- Access only ever arrives by invitation; there is no sign-up path to a role.
--
-- The token is stored HASHED. A leaked database dump then hands an attacker a
-- hash, not a working invitation link. The plaintext exists once, in the email
-- that goes out, and nowhere else.
create table if not exists public.staff_invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null check (role in ('studio', 'packing')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists staff_invitations_email_idx
  on public.staff_invitations (lower(email));

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon, authenticated;
grant all on public.staff_invitations to service_role;

/* ---------------------------------------------------------------- colours */

-- The filament palette. One list, used by the shop, by every product and by the
-- name-charm builder.
--
-- This table is PUBLIC on purpose (the browser has to render swatches), which is
-- exactly why how many rolls are on the shelf lives in `filament_stock` below
-- instead of a column here: an RLS policy cannot hide one column, so anything
-- private needs its own table.
create table if not exists public.colours (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  hex        text not null check (hex ~ '^#[0-9A-Fa-f]{6}$'),
  active     boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.colours enable row level security;

drop policy if exists "active colours are public" on public.colours;
create policy "active colours are public" on public.colours
  for select using (active);

revoke all on public.colours from anon, authenticated;
grant select on public.colours to anon, authenticated;
grant all on public.colours to service_role;

/* ------------------------------------------------------- filament on hand */

-- What is on the shelf. Private: it is a business figure, and the shop has no
-- reason to publish it.
create table if not exists public.filament_stock (
  colour_id     uuid primary key references public.colours(id) on delete cascade,
  rolls_on_hand numeric(6,2) not null default 0,
  updated_at    timestamptz not null default now()
);

alter table public.filament_stock enable row level security;
revoke all on public.filament_stock from anon, authenticated;
grant all on public.filament_stock to service_role;

/* ---------------------------------------------------------- shop settings */

-- The constants every unit cost is built from — the "Settings" sheet of the
-- planner workbook. A single row, enforced by a boolean primary key that can
-- only ever be true.
--
-- Private: these are margins and costs. Nothing customer-facing reads them.
create table if not exists public.shop_settings (
  id                        boolean primary key default true check (id),

  printer_model             text,
  printer_price_cents       integer not null default 0,
  printer_life_hours        integer not null default 1 check (printer_life_hours > 0),
  power_draw_watts          integer not null default 0,
  -- cents per kWh, to four places: 32.7000 is $0.327
  electricity_per_kwh_cents numeric(10,4) not null default 0,

  filament_per_kg_cents     integer not null default 0,

  -- 0.700 = 70%
  target_margin             numeric(4,3) not null default 0.700
                              check (target_margin >= 0 and target_margin < 1),
  card_fee_rate             numeric(5,4) not null default 0.0160
                              check (card_fee_rate >= 0 and card_fee_rate < 1),
  round_price_to_cents      integer not null default 50 check (round_price_to_cents > 0),

  default_buffer_stock      integer not null default 5 check (default_buffer_stock >= 0),

  packaging_per_unit_cents  numeric(10,4) not null default 0,
  -- charged once per posted order, never inside a unit cost
  mailer_per_order_cents    numeric(10,4) not null default 0,

  updated_at                timestamptz not null default now()
);

alter table public.shop_settings enable row level security;
revoke all on public.shop_settings from anon, authenticated;
grant all on public.shop_settings to service_role;

-- Seed the singleton with the workbook's own numbers.
insert into public.shop_settings (
  id, printer_model, printer_price_cents, printer_life_hours,
  power_draw_watts, electricity_per_kwh_cents, filament_per_kg_cents,
  target_margin, card_fee_rate, round_price_to_cents, default_buffer_stock,
  packaging_per_unit_cents, mailer_per_order_cents
) values (
  true, 'FlashForge Creator 5', 104900, 10000,
  200, 32.7000, 1600,
  0.700, 0.0160, 50, 5,
  13.0000, 0
)
on conflict (id) do nothing;

/* ------------------------------------------------------------ accessories */

-- The hardware that goes on a piece: a keyring, a clasp, a clicker mechanism.
-- One per product, counted once in that product's unit cost.
--
-- A TABLE, not a jsonb blob on settings, because the workbook shows exactly
-- what a blob costs you. There, accessory cost is
-- `INDEX(Settings!C26:C31, MATCH(Attachment, Settings!B26:B31, 0))` wrapped in
-- IFERROR — but the Attachment dropdown offers "Phone strap", "Bag charm cord"
-- and "Split ring", and none of those three appears in B26:B31. The lookup
-- fails, IFERROR turns the failure into 0, and three of the seven options a
-- product can be sold with quietly cost nothing. A foreign key cannot do that:
-- an accessory either exists and has a price, or the product cannot reference
-- it. Everything the dropdown offers is seeded below, and anything genuinely
-- free says 0 out loud.
--
-- Private: this is cost data.
create table if not exists public.accessories (
  id          text primary key,
  name        text not null,
  -- Cents each, to four places. The workbook buys these in packs, so a real
  -- unit cost is fractional: a keyring is $9.50/100 = 9.5 cents, a magnet is
  -- $17/60 = 28.3333 cents. Rounding to whole cents here would move every
  -- product's cost before it reached her.
  cost_cents  numeric(10,4) not null default 0 check (cost_cents >= 0),
  -- How the price was arrived at, so the number can be checked against a
  -- receipt in twelve months rather than taken on faith.
  cost_note   text,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.accessories enable row level security;
revoke all on public.accessories from anon, authenticated;
grant all on public.accessories to service_role;

-- Settings B26:C31 plus the three options the Products dropdown offers that
-- that block never priced. They are seeded at 0 and flagged in the note,
-- because "we have not costed this yet" is a different thing from "free" and
-- the studio should be able to tell them apart.
insert into public.accessories (id, name, cost_cents, cost_note, sort_order) values
  ('keyring',       'Keyring',        9.5000,  '$9.50 per 100',        10),
  ('lobster_clasp', 'Lobster clasp',  30.0000, '$12 per 40',           20),
  ('ball_chain',    'Ball chain',     10.0000, '$8 per 80',            30),
  ('split_ring',    'Split ring',     0.0000,  'NOT COSTED YET',       40),
  ('phone_strap',   'Phone strap',    0.0000,  'NOT COSTED YET',       50),
  ('bag_charm_cord','Bag charm cord', 0.0000,  'NOT COSTED YET',       60),
  ('magnet',        'Magnet',         28.3333, '$17 per 60',           70),
  ('clicker',       'Clicker',        24.0000, '$12 per 50',           80),
  ('glue',          'Glue',           5.0000,  'per piece',            90)
on conflict (id) do nothing;

/* -------------------------------------------------- costing on a product */

-- Print time is the input the workbook is missing for almost every row, and
-- without which a unit cost computes from zeros. Nullable on purpose: null
-- means "not measured yet" and the admin shows it as unknown, which is honest.
-- Zero would claim the print is free.
--
-- Grams are NOT here. See product_filament below.
alter table public.products
  add column if not exists print_time_hours numeric(6,3)
    check (print_time_hours is null or print_time_hours >= 0);
alter table public.products
  add column if not exists buffer_stock integer not null default 5
    check (buffer_stock >= 0);

/* --------------------------------------------- filament, colour by colour */

-- How many grams of which colour a single unit of a product uses.
--
-- The workbook keeps this as four fixed pairs of columns on every product row
-- — Colour 1 / g, Colour 2 / g, Colour 3 / g, Colour 4 / g — and the Filament
-- sheet then has to add up four SUMPRODUCTs per colour to answer "how many
-- rolls do I buy". Four is also a ceiling nobody chose: a five-colour piece has
-- nowhere to go.
--
-- Rows instead. One per colour a product uses. "Total grams" is then a sum, not
-- a fifth column that can disagree with the four it adds up — which is exactly
-- the failure the workbook's own CHECK on Filament!B42 exists to catch ("grams
-- typed with no colour chosen. Should be 0"). Here it cannot happen: grams
-- without a colour is not a row that can be written.
--
-- Private, like everything else costs are computed from.
create table if not exists public.product_filament (
  product_id uuid not null references public.products(id) on delete cascade,
  colour_id  uuid not null references public.colours(id) on delete restrict,
  grams      numeric(8,2) not null check (grams >= 0),
  primary key (product_id, colour_id)
);

-- The buy list walks colour → products. Without this it is a sequential scan
-- per colour, eighteen times over.
create index if not exists product_filament_colour_idx
  on public.product_filament (colour_id);

alter table public.product_filament enable row level security;
revoke all on public.product_filament from anon, authenticated;
grant all on public.product_filament to service_role;

-- `on delete restrict` above is deliberate: deleting a colour that products are
-- printed in would silently reduce their filament cost. The studio has to
-- deactivate it instead, which is what the `active` flag is for.

/* ---------------------------------------------- which channel sells what */

-- The shop is not the only place these are sold, and the two ranges differ:
-- everything is listed online, while a market stall only has table space for a
-- subset. That is the workbook's Products column A ("Open market / Online only
-- / Both").
--
-- Note this is about the STALL, not about whether a product is published —
-- `products.active` already decides that. A product can be inactive and still
-- be marked as one you take to markets.
alter table public.products
  add column if not exists on_market_stall boolean not null default false;

/* -------------------------------------------------------- product photos */

-- Real photographs, once she has them. Separate from `gallery`, which holds the
-- drawn placeholder art ({art, tint, alt}) the shop ships with today.
--
-- Two arrays rather than one mixed one, with a rule the shopfront can state in
-- a sentence: if `photos` has anything in it, the shop shows photos; otherwise
-- it falls back to the drawing. A single array holding two different shapes
-- would need every consumer to branch on which kind each element is, and the
-- first one that forgets renders a broken image.
--
-- Each element is {"path": "<storage object path>", "alt": "<description>"}.
-- The path, not a URL: the bucket can move, and a stored absolute URL would
-- outlive the project it points at.
alter table public.products
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- The accessory this product ships with, priced once in its unit cost.
-- `on delete restrict` for the same reason as colours: removing a keyring from
-- the list must not quietly make every keyring product cheaper.
alter table public.products
  add column if not exists accessory_id text
    references public.accessories(id) on delete restrict;

/* ------------------------------------------------------- orders: channels */

-- The shop is one channel of several. A sale at a market stall is a real sale
-- and belongs in the same table, or every report is quietly wrong.
alter table public.orders
  add column if not exists channel text not null default 'website'
    check (channel in ('website', 'market_stall', 'tiktok', 'shopee', 'other'));

-- Who typed it in. Null for a website order — nobody typed those.
alter table public.orders
  add column if not exists recorded_by uuid references auth.users(id) on delete set null;

create index if not exists orders_channel_idx on public.orders (channel);

-- Cost AT THE TIME OF SALE. Profit has to be computed against what the piece
-- cost when it went out, not against what filament costs today — otherwise
-- every historical margin silently rewrites itself the next time a price
-- changes in Settings.
alter table public.order_items
  add column if not exists unit_cost_cents integer
    check (unit_cost_cents is null or unit_cost_cents >= 0);

/* ------------------------------------------------------------ the palette */

-- The 17 filament colours from the planner's Filament sheet, plus Dark Green,
-- which products already use. Hexes are the ones already in seed.sql — the
-- shop's own values, not new ones invented here.
insert into public.colours (name, hex, sort_order) values
  ('White',        '#FFFFFF',  10),
  ('Black',        '#2B2B2B',  20),
  ('Grey',         '#9AA0A6',  30),
  ('Beige',        '#E9DCC4',  40),
  ('Light Brown',  '#B08968',  50),
  ('Brown',        '#8B5E3C',  60),
  ('Dark Brown',   '#5B4636',  70),
  ('Red',          '#D64545',  80),
  ('Hot Pink',     '#E75480',  90),
  ('Baby Pink',    '#F6CFD8', 100),
  ('Baby Orange',  '#F3B98A', 110),
  ('Yellow',       '#F2C94C', 120),
  ('Baby Yellow',  '#F2D98B', 130),
  ('Matcha Green', '#A9BC7F', 140),
  ('Green',        '#6D9557', 150),
  ('Baby Green',   '#BFD6A8', 160),
  ('Dark Green',   '#3F5D3A', 170),
  ('Baby Blue',    '#BCD3E8', 180)
on conflict (name) do nothing;

-- One roll of each, as the Filament sheet records. Dark Green is not on that
-- sheet, so it starts at zero rather than being credited with stock nobody
-- counted.
insert into public.filament_stock (colour_id, rolls_on_hand)
select c.id, case when c.name = 'Dark Green' then 0 else 1 end
  from public.colours c
on conflict (colour_id) do nothing;

/* ------------------------------------------------------- claiming the studio */

-- ONE LAST STEP, AND IT IS DELIBERATELY MANUAL.
--
-- Nobody is staff yet, so /admin will turn everybody away — including you.
-- Make yourself the owner by running the statement below, HERE, in the SQL
-- editor, with your own email in it.
--
-- There is no page in the app that does this and there is not going to be. A
-- code path that can grant the owner role is a code path somebody can reach.
-- The one table that decides authority gets its first row from someone holding
-- the service-role key, which is you, in this dashboard, once.
--
--     insert into public.staff (user_id, role)
--     select id, 'owner' from auth.users
--      where lower(email) = lower('YOU@YOUR-EMAIL.COM')
--     on conflict (user_id) do update set role = 'owner';
--
-- If it reports "INSERT 0 0", there is no account with that email yet: sign up
-- on the shop first, with the address you want to run the studio from, then run
-- it again. Everyone else you let in is invited from Studio access once you are
-- in — and an invitation can only ever grant Studio or Packing, never Owner.
