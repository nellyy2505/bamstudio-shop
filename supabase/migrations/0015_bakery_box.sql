-- Design your own bakery box.
--
-- Apply after 0014_builder_pricing.sql.
--
-- WHAT IT IS. A second builder, not a bundle. The customer picks a box, a
-- design, a colour, and the pieces that go in it, and pays one price whatever
-- goes in. That last part is the decision worth naming: the letter ladder
-- charges by length because a longer name is more machine time, and this
-- deliberately does not, so THE STUDIO CARRIES THE VARIANCE between a box of
-- four quick macarons and a box of four fiddly decorated cakes.
--
-- WHY IT IS NOT A LUCKY SCOOP, given the two look alike from a distance. A
-- scoop is sold before its contents are decided, which is the single fact
-- lib/scoop-line.ts derives everything from: no product id on the line, no cost
-- until the pack is recorded, no stock movement at sale. A box is the opposite.
-- Its contents are chosen by the customer at the moment of purchase, so the
-- line knows exactly what is in it, the cost is the sum of four measured
-- pieces, and the stock comes off when the money does.
--
-- WHY THE BOX IS A PRODUCT. `personalisation_mode` already distinguishes a
-- product priced by a builder from one priced by its own column, and
-- `withBuilderPrices()` already substitutes a ladder price for such a product on
-- every shopfront read. Making a box a `products` row means it gets a page, a
-- card, photographs, a weight for postage and a place in search for free, and it
-- means an order line for a box is the same shape as every other order line.
--
-- The 4-piece box and the 1-piece birthday cake box are therefore two products,
-- not one product with a size switch. They are different objects: different
-- print, different weight, different price. `bakery_piece_count` says how many
-- each holds, and the price is the matching rung of the `bakery_box` ladder in
-- `builder_pricing` (0014).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT CREATE: any product. Not the boxes,
-- not the cakes. The catalogue comes from the workbook through
-- scripts/generate-seed.mjs, and a migration that invented product rows would
-- fight that and would be inventing prices besides. The tables below are the
-- machinery; the Studio is where the owner fills them.

/* ------------------------------------------------------- 1. the box itself */

-- 'bakery' joins 'builder' and 'text'. Dropped and recreated rather than edited
-- in place in 0001, which is applied and is a record of what ran.
alter table public.products drop constraint if exists products_personalisation_mode_check;
alter table public.products
  add constraint products_personalisation_mode_check
  check (personalisation_mode in ('builder', 'text', 'bakery'));

alter table public.products
  -- How many pieces this box holds: 4 for the pastry box, 1 for a birthday
  -- cake. Null on everything that is not a box, which is almost everything, and
  -- the reason this is nullable rather than defaulted to 0: a 0 would read as a
  -- box that holds nothing rather than as a product that is not a box.
  add column if not exists bakery_piece_count integer
    check (bakery_piece_count is null or (bakery_piece_count > 0 and bakery_piece_count <= 12));

comment on column public.products.bakery_piece_count is
  'Pieces this box holds. NULL unless personalisation_mode = ''bakery''. The '
  'price is the matching rung of the bakery_box ladder in builder_pricing.';

/* --------------------------------------------------------- 2. box designs */

-- Plain, windowed, gingham. Independent of colour, by the owner's decision: she
-- wanted the design and the colour chosen separately rather than as a fixed set
-- of named combinations the way keycap `collections` work.
--
-- The trade she accepted with that: any design can be asked for in any colour,
-- so every combination has to be one the studio will actually print. There is
-- no per-combination row to deactivate, only a design and a colour.
create table if not exists public.bakery_box_designs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null check (char_length(name) between 1 and 80),
  blurb      text not null default '' check (char_length(blurb) <= 300),

  -- Whether the lid has a window cut into it. Not a price difference (the owner
  -- confirmed one flat price), but the packing bench needs to know which lid to
  -- reach for and the shopper is being shown a picture of one.
  has_window boolean not null default false,

  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists bakery_box_designs_active_idx
  on public.bakery_box_designs (active, sort_order);

/* --------------------------------------------------------- 3. box colours */

-- A curated subset of `colours`, NOT a new colour concept.
--
-- The filament colours already carry a name and a hex and are already edited in
-- the Studio, so a box colour is a pointer at one of them rather than a second
-- table of names and swatches that can disagree with the first. The join exists
-- because not every filament she stocks is a colour she wants boxes printed in.
create table if not exists public.bakery_box_colours (
  colour_id  uuid primary key references public.colours(id) on delete cascade,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

/* ------------------------------------------------------------ 4. fillings */

-- Which products may go in a box.
--
-- `restrict` on delete, matching `scoop_tier_products`: a product somebody can
-- put in a box should not vanish from under the builder because it was deleted
-- elsewhere. Deactivate it instead.
create table if not exists public.bakery_fillings (
  product_id uuid primary key references public.products(id) on delete restrict,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists bakery_fillings_active_idx
  on public.bakery_fillings (active, sort_order);

comment on table public.bakery_fillings is
  'The pool a customer picks a box''s contents from. A filling is a real '
  'product row, so it carries print time, filament and therefore a cost, and '
  'the print queue and buy list see it. Most are products.active = false: they '
  'are sold inside a box and not on their own.';

/* ---------------------------------------------------------------- 5. RLS */

-- All three are read by the shopfront with the anon key, the way products and
-- collections are, because they are what the builder draws. Writes are the
-- Studio's, through the service role, after requireStaff() has answered.
alter table public.bakery_box_designs enable row level security;
alter table public.bakery_box_colours enable row level security;
alter table public.bakery_fillings enable row level security;

drop policy if exists "box designs are public" on public.bakery_box_designs;
create policy "box designs are public" on public.bakery_box_designs
  for select to anon, authenticated using (true);

drop policy if exists "box colours are public" on public.bakery_box_colours;
create policy "box colours are public" on public.bakery_box_colours
  for select to anon, authenticated using (true);

drop policy if exists "box fillings are public" on public.bakery_fillings;
create policy "box fillings are public" on public.bakery_fillings
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.bakery_box_designs from anon, authenticated;
revoke insert, update, delete on public.bakery_box_colours from anon, authenticated;
revoke insert, update, delete on public.bakery_fillings from anon, authenticated;
grant all on public.bakery_box_designs to service_role;
grant all on public.bakery_box_colours to service_role;
grant all on public.bakery_fillings to service_role;

/* ------------------------------------------------------- 6. the two sizes */

-- BOTH BOXES ARE $12. Owner's decision, 11 September 2026: the four-piece
-- pastry box and the one-piece birthday cake box cost the same.
--
-- That is not an oversight of the bigger box. A birthday cake is one large
-- decorated print and four pastries are four small ones, and she has priced
-- them as the same job. The ladder expresses it without any special case,
-- because a rung is keyed on how many pieces a box holds and nothing stops two
-- rungs sharing a price.
--
-- WHY THIS IS HERE AND NOT AN EDIT TO 0014. 0014 seeded the four-piece box at
-- $15, the figure named when the box was still being designed. That migration
-- may already have been applied, and an applied migration is never edited: the
-- repo and the database would then disagree with no way to tell which is right.
-- So this corrects it forward.
--
-- `do update` rather than `do nothing`, and this is the one place in these two
-- migrations where a price is deliberately CHANGED rather than established.
-- It is safe because the bakery box has never been on sale: 0015 is the
-- migration that creates the feature, so there is no customer who was shown $15
-- and no order that was charged it. Applying this to a database that ran 0014
-- and one that never did leaves both at the same place.
insert into public.builder_pricing (kind, units, price_cents) values
  ('bakery_box', 4, 1200),
  ('bakery_box', 1, 1200)
on conflict (kind, units) do update
  set price_cents = excluded.price_cents,
      updated_at  = now();

-- Three designs to start from, taken from the photographs the owner shared.
-- Seeded for the same reason the ladder was: a builder with no designs cannot
-- render, and these are hers to rename, reorder or deactivate.
insert into public.bakery_box_designs (slug, name, blurb, has_window, sort_order) values
  ('plain',   'Plain lid',   'A clean lid with nothing cut into it.',        false, 10),
  ('window',  'Window lid',  'A cut-out window so the pieces show through.', true,  20),
  ('gingham', 'Gingham',     'Checked print, the bakery-box classic.',       false, 30)
on conflict (slug) do nothing;
