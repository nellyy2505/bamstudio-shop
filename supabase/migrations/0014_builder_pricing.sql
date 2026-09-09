-- Personalisation prices come out of the code and into the database.
--
-- Apply after 0013_returns.sql.
--
-- THE DEFECT THIS CLOSES, and it is visible on the live site right now.
--
-- The letter-cap ladder lives in `BUILDER_PRICING` in lib/config.ts. Two things
-- follow from that, and both are wrong.
--
-- 1. THE OWNER CANNOT CHANGE A PRICE. Moving the first letter from $3.50 to
--    $3.75 needs a code edit, a commit, a push and a CI deploy. Every other
--    price in this shop is a field in the Studio; this one is a deployment.
--
-- 2. IT GOT COPIED, AND THE COPY DRIFTED. `scripts/generate-seed.mjs` read the
--    ladder's cheapest rung and wrote it into `products.price` for the two
--    builder products, so the catalogue carries `400` from the $4.00 era. The
--    shop grid and the product page render that column while /collections
--    computes the same figure from the ladder, so the site currently states two
--    different prices for one product: $4.00 on the listing and $3.50 on the
--    collections page. That is the "one product, one price" rule in CLAUDE.md
--    broken by the same mechanism it was written about, which was a charm's
--    price being copied onto a collection.
--
-- SHAPE: A LADDER PER KIND, AND A FLAT PRICE IS A ONE-ROW LADDER.
--
-- `units` is letters for the caps and pieces for a box. The bakery box the
-- owner described is a flat price for a fixed four pieces, which is one row
-- here rather than a second mechanism; if a six-piece box at another price ever
-- exists it is a second row and no code changes. Seeding it now, before the box
-- itself is built, is deliberate: it is the price she named, and a table that
-- can only express the ladder would need a second migration the moment the box
-- lands.
--
-- THIS IS NOT "A MIGRATION SETTING PRICES". CLAUDE.md's rule is that
-- `products.price` belongs to the Studio and a migration must not quietly
-- reprice the catalogue. That rule is about moving a price nobody asked to
-- move. This establishes the initial contents of a new table with the figures
-- the code already holds, so the shop behaves identically on the first request
-- after deploy and the owner can then change them from a screen. Nothing is
-- repriced by applying this.
--
-- THE CODE CONSTANT DOES NOT DISAPPEAR, it becomes the fallback, exactly like
-- `lib/shipping/fallback.ts`. The shop serves a bundled catalogue when Supabase
-- is not configured or not answering, and a builder with no prices at all is a
-- worse failure than a builder quoting last-known-good ones.

create table if not exists public.builder_pricing (
  -- Which builder. Constrained rather than free text for the reason every other
  -- enum in this schema is: a value the Studio's own screen cannot produce is a
  -- value that did not come from the Studio.
  kind        text not null check (kind in ('letter_caps', 'bakery_box')),

  -- How many of the thing: letters spelled, or pieces in the box.
  units       integer not null check (units > 0 and units <= 50),

  -- Never null and never zero. A personalisation priced at nothing is a
  -- giveaway, and `> 0` is what stops "not priced yet" and "free" being the
  -- same value, the same way `scoop_tiers.price_cents` does it.
  price_cents integer not null check (price_cents > 0),

  updated_at  timestamptz not null default now(),

  primary key (kind, units)
);

comment on table public.builder_pricing is
  'What a personalised build costs, by builder and by how many units it holds. '
  'A tiered ladder (letter caps) is several rows; a flat price (a bakery box) '
  'is one. lib/config.ts holds the same figures as a fallback for when the '
  'database is unreachable.';

-- Public pricing, and the shopfront reads it with the anon key the same way it
-- reads products and collections. There is nothing here a shopper does not see
-- printed on the builder page a moment later, so a read policy is honest;
-- writes stay with the service role, which is how the Studio reaches it after
-- requireStaff() has answered.
alter table public.builder_pricing enable row level security;

drop policy if exists "builder pricing is public" on public.builder_pricing;
create policy "builder pricing is public"
  on public.builder_pricing for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.builder_pricing from anon, authenticated;
grant all on public.builder_pricing to service_role;

-- The ladder as lib/config.ts holds it on 9 September 2026: $3.50 for the first
-- letter, $1.00 for each after, and 50c for the fifth.
insert into public.builder_pricing (kind, units, price_cents) values
  ('letter_caps', 1, 350),
  ('letter_caps', 2, 450),
  ('letter_caps', 3, 550),
  ('letter_caps', 4, 650),
  ('letter_caps', 5, 700)
on conflict (kind, units) do nothing;

-- The bakery box: four pieces, one price, $15 as a placeholder the owner named.
insert into public.builder_pricing (kind, units, price_cents) values
  ('bakery_box', 4, 1500)
on conflict (kind, units) do nothing;

-- The charm bundle discount, which was the other price living in code.
--
-- A single figure rather than a ladder, so it belongs beside the other money
-- constants in shop_settings rather than in the table above. What comes off a
-- charm's own retail price when it is bought with letter caps: the charm is
-- never given a second price of its own to drift from the first, which is the
-- rule 0009 and CLAUDE.md both exist to protect.
alter table public.shop_settings
  add column if not exists builder_charm_discount_cents integer not null default 150
    check (builder_charm_discount_cents >= 0);

comment on column public.shop_settings.builder_charm_discount_cents is
  'Taken off a charm product''s own price when it is added inside the letter '
  'builder. Never a stored charm price: the charm is resolved live through '
  'collections.charm_slug.';
