-- 0007_lucky_scoop.sql — the one product this shop sells before it knows what
-- is in it.
--
-- Apply after 0006_enquiries.sql.
--
-- WHY A NEW FILE. 0001–0006 are applied on the live Supabase project, and an
-- applied migration is never edited: the repo and the database would then
-- disagree with no way to tell which is right. Same rule 0004, 0005 and 0006
-- state, same shape — every statement below is guarded and the file is safe to
-- re-run.
--
-- ===========================================================================
-- WHAT A LUCKY SCOOP IS, AND WHY IT DOES NOT FIT THE TABLES THAT EXIST
-- ===========================================================================
--
-- A bowl of small charms at the stall. The customer buys a TIER — "Pet scoop,
-- five pieces" — and gets a random selection drawn from a defined pool of
-- products. Every order gets a video of the scoop being drawn and packed.
--
-- Everything else in this shop is printed to order with a cost that is known
-- before the sale: `order_items.unit_cost_cents` is stamped at checkout from
-- the product's own recipe (0003_admin.sql, `unitCostsAtSale()`).
--
-- A scoop inverts that. It is SOLD FIRST AND DECIDED AFTERWARDS. At the moment
-- money changes hands nobody knows what is in it, so there is no recipe to cost
-- it from and nothing for the existing costing chain to read. Three
-- consequences drive every table below:
--
--   1. COST IS RECORDED AT PACK TIME, summed from the pieces that actually went
--      in. That is what makes the margin real rather than assumed — and it is
--      why `scoop_pack_items` carries its own `unit_cost_cents` per piece,
--      stamped when the piece was packed, for exactly the reason
--      `order_items.unit_cost_cents` exists: a cost derived at read time
--      rewrites every historical margin the next time filament changes price.
--
--   2. STOCK CANNOT COME OFF AT SALE TIME, because at sale time nobody knows
--      which products. It comes off when the pack is recorded, one
--      `decrement_stock` call per piece, guarded by `scoop_packs.stock_applied`
--      so a re-saved pack panel cannot take the same pieces twice — the same
--      compare-and-set shape `orders.stock_applied` uses.
--
--   3. A TIER IS SELLABLE ONLY IF ITS POOL CAN ACTUALLY FILL IT. This is the
--      one product where the shop's deliberate overselling rule must NOT apply.
--      The long note under `scoop_tier_products` is where that is argued out.
--
-- SMALL ITEMS ONLY. Clickers, keyrings, magnets — never a pet bowl or a lamp.
-- That is the owner's decision and it is not decoration: a tier carries ONE
-- packed weight for postage, and a pool that can produce either a charm or a
-- bowl has no honest weight to carry. See `packed_weight_grams` below.
--
-- NOTHING IS PRICED IN CODE. Every tier is a row; the price is a nullable
-- column; an unpriced tier is NULL and never 0. Money is integer cents (AUD),
-- like every other amount in this schema.

/* ------------------------------------------------------------------ tiers */

-- THE TIER IS THE PRODUCT. Not "a scoop" — "Pet scoop, 5 pieces, $X". The
-- customer chooses a tier, the tier is what they buy, and the randomness lives
-- strictly inside it.
--
-- Deliberately NOT a row in `products`. A product row carries a price that is
-- always set, a stock count that is decremented at sale, a filament recipe that
-- produces its cost, and a weight of its own. A tier has none of those: its
-- price starts null, its stock is a property of a pool of other rows, its cost
-- is not knowable until it is packed, and its weight is a worst case somebody
-- chose rather than something that was weighed. Folding it into `products`
-- would mean every one of those columns lying for scoop rows, and every query
-- in the shop learning to ask which kind of row it is holding.
create table if not exists public.scoop_tiers (
  id          uuid primary key default gen_random_uuid(),

  -- The shopfront URL. Constrained to the slug shape the rest of the catalogue
  -- uses, because a tier slug reaches a route segment.
  slug        text not null unique
                check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 1 and 120),
  blurb       text not null default '' check (char_length(blurb) <= 600),

  -- The topic the owner described: pet, household, clickers & keyrings, or a
  -- mixed bowl. An enum-by-check rather than free text for the reason
  -- `contact_enquiries.topic` is one in 0006 — a value the studio's dropdown
  -- cannot produce is a value that did not come from the studio.
  --
  -- THE THEME IS THE CUSTOMER'S CHOICE, NOT THE DRAW'S. At the stall a
  -- charm-colour board maps colour to category and the scoop decides which
  -- category you get. Online that mechanic sells somebody pet things when they
  -- wanted clickers, and "goods must match their description" is not waived by
  -- calling it lucky. So the customer picks the theme and the draw decides only
  -- which pieces come out of it. The board stays in the video, where it is
  -- theatre rather than a term of sale.
  theme       text not null
                check (theme in ('pet', 'household', 'clickers_keyrings', 'mixed')),

  -- The promise. "Five pieces", not "a scoop" — the owner's starting number is
  -- five. Postage needs it, the pool rule below needs it, and the customer is
  -- owed it. The upper bound is a sanity rail, not a policy: a bowl nobody
  -- could fill by hand is a typo.
  piece_count integer not null default 5
                check (piece_count > 0 and piece_count <= 50),

  -- NULL until she prices it, and never 0.
  --
  -- Zero of forty-four products currently have a measured cost, so a price
  -- typed into code today would be a guess, and a guess in a price field is the
  -- plausible-looking number this project treats as a defect. Null says "not
  -- priced yet" in the same language the rest of the studio already uses for
  -- anything unmeasured; a zero would say "free", and the shopfront would
  -- render it as $0.00. `> 0` rather than `>= 0` is what stops the two being
  -- confused.
  price_cents integer check (price_cents is null or price_cents > 0),

  -- Postage, and the reason "small items only" is a schema decision.
  --
  -- Australia Post prices a domestic parcel on weight alone, and a basket's
  -- postage is the sum of its lines' weights (lib/shipping/). A scoop has no
  -- product row to take a weight from, so the tier carries its own — and it
  -- must be the WORST CASE, not the average: the studio wears the difference on
  -- every order where the real pack is heavier than the band. That is only
  -- possible to set honestly when every piece in the pool is the same order of
  -- size, which is what "small items only" means in practice.
  --
  -- Thickness is stored for the same reason `products.thickness_mm` is: it is
  -- the binding Large Letter limit (20 mm) and Australia Post validates
  -- dimensions on a quote. Note there is deliberately NO `letter_eligible` here
  -- — a scoop is quoted as a parcel, full stop. Large Letter is untracked and
  -- uninsured, and a parcel whose contents were chosen at random is the last
  -- one the studio should be sending that way.
  --
  -- Both nullable, both required before the tier can be activated. Null is
  -- "nobody has packed a test one and put it on the scales", which is a fact
  -- worth being able to state.
  packed_weight_grams  integer check (packed_weight_grams is null or packed_weight_grams > 0),
  packed_thickness_mm  integer check (packed_thickness_mm is null or packed_thickness_mm > 0),

  sort_order  integer not null default 0,

  -- Defaults FALSE, unlike `products.active`, and the direction matters for the
  -- same reason `letter_eligible` defaults false in 0004: a tier typed into the
  -- Supabase table editor arrives hidden rather than arriving on the shopfront
  -- half-finished. Turning it on is a deliberate act, never an accident of a
  -- default.
  active      boolean not null default false,

  created_at  timestamptz not null default now()
);

create index if not exists scoop_tiers_active_idx
  on public.scoop_tiers (sort_order)
  where active;

-- A TIER MUST NOT BE ACTIVATABLE WITHOUT THE THINGS THAT MAKE IT HONEST.
--
-- Three of them: a price, a packed weight, and a pool that can fill it. Two are
-- columns on this row and are enforced here. The third is a fact about other
-- rows and is enforced by the constraint trigger further down.
--
-- Named and stated as a separate drop/add rather than inline, the same shape
-- 0002 and 0005 use: an inline check is skipped entirely on a database that
-- already has the table, so a re-run of this file could never repair it.
alter table public.scoop_tiers
  drop constraint if exists scoop_tiers_activation_check;
alter table public.scoop_tiers
  add constraint scoop_tiers_activation_check
  check (
    not active
    or (price_cents is not null and packed_weight_grams is not null)
  );

comment on table public.scoop_tiers is
  'A Lucky Scoop tier — the thing a customer actually buys. "Pet scoop, five '
  'pieces, $X". Price, piece count and packed weight are all editable in the '
  'studio and none of them is priced in code; a tier with no price is NULL, '
  'never 0, and cannot be activated. Readable with the anon key only once it '
  'is active AND priced, because an inactive or unpriced tier is a draft.';

comment on column public.scoop_tiers.price_cents is
  'What the tier sells for, in integer cents. NULL means nobody has priced it '
  'yet — a fact, not a status — and a tier cannot be activated while it is '
  'null. Never 0: a zero here would render as a free scoop.';

comment on column public.scoop_tiers.packed_weight_grams is
  'Worst-case packed weight in grams. A scoop has no product row to take a '
  'weight from, so the tier carries its own, and it must be the heaviest '
  'plausible pack rather than the average — the studio wears the difference on '
  'every order where the real pack is heavier. NULL blocks activation.';

/* ------------------------------------------------------- the eligible pool */

-- WHICH PRODUCTS MAY BE DRAWN INTO WHICH TIER — AS EXPLICIT ROWS.
--
-- The obvious alternative is a category or theme filter on the tier: "this
-- scoop draws from category = 'Clicker keychain'". It was rejected, and this is
-- the table where that decision is worth writing down.
--
-- A category filter is a rule about a column somebody edits somewhere else. The
-- day a pet bowl is filed under the category a clicker scoop draws from — a
-- rename, a new product typed in at midnight, a tidy-up of the category
-- list — the bowl silently joins the pool. Nothing raises, nothing is logged,
-- and the first anyone knows is a $2 scoop that cost $9 to make and does not
-- fit the postage band the tier is quoted on. Explicit rows cannot do that:
-- a product is in a pool because somebody put it there.
--
-- It is also what makes the promise describable. With rows, the product page
-- can say "five pieces drawn from these twelve" and show them. That is the
-- difference between a surprise and an unknown, and under the Australian
-- Consumer Law a description binds — the pool being visible is what makes the
-- description true.
--
-- `on delete restrict` on `products`, for exactly the reason `product_filament`
-- restricts deletes of `colours` in 0003: deleting a product that a live tier
-- draws from would silently shrink that tier's pool below what it promises. The
-- studio deactivates the product instead, which the availability rule below
-- already understands.
create table if not exists public.scoop_tier_products (
  tier_id    uuid not null references public.scoop_tiers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  added_at   timestamptz not null default now(),
  -- One row per product per tier. A product cannot be in the same pool twice,
  -- so "how big is this pool" is a count and not a count of distinct anything.
  primary key (tier_id, product_id)
);

-- The studio asks "which tiers would this product affect" when it deactivates
-- one. Without this that is a sequential scan per product.
create index if not exists scoop_tier_products_product_idx
  on public.scoop_tier_products (product_id);

comment on table public.scoop_tier_products is
  'Which products may be drawn into which tier. Explicit rows, never a category '
  'filter: a filter is a rule about a column edited somewhere else, and the day '
  'a pet bowl is filed under a clicker scoop''s category it silently joins the '
  'pool. Public with the anon key, but only for tiers that are active and '
  'priced — the shopfront shows the pool, because a visible pool is what makes '
  '"five pieces drawn from these twelve" a true description.';

/* ===========================================================================
   THE AVAILABILITY RULE, AND WHY IT IS NOT decrement_stock's RULE
   ===========================================================================

   0005_sale_integrity.sql decided, at length, that this shop KEEPS SELLING when
   the shelf is empty. `decrement_stock` returns a shortfall instead of refusing
   one, `products.oversold_units` accumulates it, and the studio prints the
   backlog. That decision is right and nothing here changes it.

   But read its premise. Everything else in this shop is printed to order, so
   `stock_on_hand` is a buffer of pieces already printed, not an allocation of
   the only ones that exist. Refusing a sale because the buffer is empty would
   turn a two-day print into a lost order for something the studio prints on
   demand anyway — and the check could not be made to work honestly in any case,
   because stock only moves in the webhook, AFTER payment, so a check at
   checkout guards a window it does not own.

   A SCOOP BREAKS THE PREMISE. Its whole promise is "these exist now, and five
   of them are going in a bag". The owner holds stock for scoops on purpose —
   printing before selling is expected here. You cannot print a surprise on
   Tuesday to satisfy Monday's order without deciding for the customer what they
   got, and the pool is precisely what stops the shop deciding that. So:

     A TIER IS SELLABLE WHEN AT LEAST `piece_count` DISTINCT PRODUCTS IN ITS
     POOL EACH HAVE AT LEAST ONE UNIT ON THE SHELF.

   Distinct products, not total units, and that is the conservative reading on
   purpose. Whether a scoop may contain two of the same charm is one of the four
   decisions only the owner can make, and it is not settled. The distinct rule
   is true under either answer — a pool that can produce five different pieces
   can obviously also produce five pieces — and where it errs, it errs by
   listing one fewer tier rather than by promising a bag it cannot fill.
   `lib/scoop.ts` is where that rule lives, with the arithmetic for "how many
   whole scoops could this pool fill".

   WHAT THIS SCHEMA CAN ENFORCE, AND WHAT IT CANNOT.

   It CAN enforce the static half: an active tier's pool must hold at least
   `piece_count` products. That is a fact about rows, it never changes on its
   own, and the trigger below refuses it. A tier promising five pieces from a
   pool of three is not a stock problem, it is a tier that was never fillable.

   It CANNOT enforce the stock half, and should not pretend to. `stock_on_hand`
   changes with every sale and every print, so "this tier is sellable" is a
   question asked at read time, not a constraint — a CHECK that consulted it
   would have to be re-evaluated on every product row change and would fire on
   the studio's own inventory edits. So availability is a LISTING decision: the
   shopfront does not offer a tier whose pool cannot fill it, and the studio
   sees the same number beside the tier. Nothing here refuses a decrement.

   THE RACE IS SMALLER, NOT GONE, and that is the honest claim. Two shoppers can
   still both see the last fillable scoop, exactly as 0005 describes. The
   difference is what a miss costs: an ordinary oversell means printing one
   more, while a scoop that cannot be filled needs a person — a substitution the
   customer can see was not drawn, or a refund. Checking the pool shrinks that
   window to the last scoop in the bowl instead of pretending it does not exist,
   and the pack panel is where a human finds out.
   =========================================================================== */

-- The static half, enforced.
--
-- A CONSTRAINT TRIGGER, deferred to commit, because the studio creates a tier
-- and fills its pool in one transaction and the two orders of those statements
-- must both work. `after` on both tables: activating a tier can break the rule
-- from one side, and emptying its pool can break it from the other.
create or replace function public.scoop_tier_pool_is_big_enough()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  -- Both sides of an UPDATE that moved a pool row between tiers. A DELETE has
  -- no NEW and an INSERT has no OLD, so neither is referenced unconditionally:
  -- touching an unassigned record raises rather than returning null.
  targets uuid[];
  target  uuid;
  tier    record;
  pool    integer;
begin
  if tg_table_name = 'scoop_tiers' then
    targets := array[new.id];
  elsif tg_op = 'DELETE' then
    targets := array[old.tier_id];
  elsif tg_op = 'INSERT' then
    targets := array[new.tier_id];
  else
    targets := array[new.tier_id, old.tier_id];
  end if;

  foreach target in array targets loop
    select t.id, t.name, t.piece_count, t.active
      into tier
      from public.scoop_tiers t
     where t.id = target;

    -- The tier itself was deleted in this transaction; its pool went with it.
    if not found then
      continue;
    end if;

    -- An inactive tier is a draft. It is allowed to be half-built — that is
    -- what "she can enter real tiers before they are sellable" means.
    if not tier.active then
      continue;
    end if;

    select count(*) into pool
      from public.scoop_tier_products p
     where p.tier_id = target;

    if pool < tier.piece_count then
      raise exception
        'scoop tier "%" is active and promises % pieces, but its pool holds only % product(s)',
        tier.name, tier.piece_count, pool
        using errcode = 'check_violation',
              hint = 'Add products to the pool, lower the piece count, or deactivate the tier.';
    end if;
  end loop;

  return null;
end;
$$;

-- `create constraint trigger` has no `or replace`, so both are dropped first.
-- The drops are scoped to the exact table so they cannot take anything else.
drop trigger if exists scoop_tiers_pool_guard on public.scoop_tiers;
create constraint trigger scoop_tiers_pool_guard
  after insert or update on public.scoop_tiers
  deferrable initially deferred
  for each row execute function public.scoop_tier_pool_is_big_enough();

drop trigger if exists scoop_tier_products_pool_guard on public.scoop_tier_products;
create constraint trigger scoop_tier_products_pool_guard
  after update or delete on public.scoop_tier_products
  deferrable initially deferred
  for each row execute function public.scoop_tier_pool_is_big_enough();

/* ------------------------------------------------------ the sale of a scoop */

-- A scoop line on an order points at a TIER, not at a product.
--
-- `order_items.product_id` is nullable and references `products`, so there is
-- nowhere for a tier to go without this column — and without it the pack panel
-- cannot know which tier's pool to draw from, and reports cannot tell a scoop
-- from a charm. This is the "the order lands like any other, marked as a
-- scoop" step.
--
-- `on delete restrict`: a tier that has ever sold cannot be deleted, because
-- deleting it would erase what an order was for. Deactivating is how a tier is
-- retired, which is what `active` is for.
alter table public.order_items
  add column if not exists scoop_tier_id uuid
    references public.scoop_tiers(id) on delete restrict;

-- A line is one thing or the other, never both. Note the deliberately loose
-- form: `product_id` is `on delete set null`, so an ordinary line whose product
-- was removed becomes (null, null) and must stay legal.
alter table public.order_items
  drop constraint if exists order_items_scoop_or_product_check;
alter table public.order_items
  add constraint order_items_scoop_or_product_check
  check (scoop_tier_id is null or product_id is null);

create index if not exists order_items_scoop_tier_idx
  on public.order_items (scoop_tier_id)
  where scoop_tier_id is not null;

comment on column public.order_items.scoop_tier_id is
  'Set on a Lucky Scoop line, and null on every other line. A scoop is sold as '
  'a tier rather than a product, so this is what marks the line as one and what '
  'the pack panel reads to know which pool to draw from. Mutually exclusive '
  'with product_id.';

/* ---------------------------------------------------------- what went in it */

-- ONE ROW PER PHYSICAL SCOOP, not one per order line.
--
-- A line can carry a quantity — the basket allows up to 20 of anything — and
-- two scoops on one line are two separate draws, two separate videos and two
-- separate bags. `pack_index` numbers them within the line and the unique
-- constraint is what makes recording idempotent: saving the pack panel twice
-- cannot produce two records of the same scoop, and "is this order fully
-- packed" is `count(*) = sum(quantity)` rather than a guess.
--
-- `piece_count` is COPIED from the tier rather than joined to it, for the same
-- reason `order_items.unit_price` and `unit_cost_cents` are copied: the tier's
-- piece count is editable in the studio, and what this customer was promised is
-- a fact about this pack that must not change when she edits the tier next
-- month.
create table if not exists public.scoop_packs (
  id            uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  pack_index    integer not null default 1 check (pack_index >= 1),
  piece_count   integer not null check (piece_count > 0),

  -- The compare-and-set guard, in the shape `orders.stock_applied` uses.
  -- Stock for a scoop moves HERE, not in the webhook, because at payment time
  -- nobody knows which products. A pack panel that is saved twice — a double
  -- click, a retried request — must not take the same pieces off the shelf
  -- twice, and the only thing that can stop it is a claim on this row taken
  -- before the decrements run.
  stock_applied boolean not null default false,

  -- Where the scoop's video ended up. NULLABLE ON PURPOSE, and not required
  -- before the order can be posted: whether "we film every scoop" is a term of
  -- sale is a decision only the owner can make, and a `not null` here would
  -- make it for her — every order that arrives at midnight would then be
  -- unpostable until she has filmed it. Null means no video has been recorded
  -- against this scoop, which is a fact and not a status.
  video_url     text check (video_url is null or char_length(video_url) between 1 and 500),

  packed_at     timestamptz not null default now(),
  packed_by     uuid references auth.users(id) on delete set null,
  note          text check (note is null or char_length(note) <= 2000),

  unique (order_item_id, pack_index)
);

comment on table public.scoop_packs is
  'One row per physical scoop packed — a line of quantity 2 has two, numbered '
  'by pack_index. This is where a scoop stops being random: stock comes off '
  'when a pack is recorded (guarded by stock_applied, because a re-saved panel '
  'must not decrement twice) and the line''s unit_cost_cents is written from '
  'what actually went in. Records what a customer received, so it is '
  'service_role only, in and out.';

-- WHAT WENT IN, AND WHAT IT COST WHEN IT DID.
--
-- `unit_cost_cents` is stamped here rather than derived from the product's
-- recipe at read time, for the reason 0003 gives on `order_items`: a cost
-- derived later rewrites every historical margin the next time filament,
-- electricity or a keyring changes price. It is the cost of ONE of this
-- product, and NULL for a piece nobody has measured — a 13c "cost" that is
-- packaging alone is a 97% margin on something nobody has timed, and null is
-- the honest answer the reports already know how to say.
--
-- The pack's total cost is deliberately NOT a column on `scoop_packs`. It is
-- the sum of these rows, and a stored total is a fifth column that can disagree
-- with the four it adds up — the same trap `product_filament` avoids in 0003 by
-- having no "total grams". `packCost()` in lib/scoop.ts is the one place that
-- sum is computed, and it answers null if any piece in the pack is unmeasured.
create table if not exists public.scoop_pack_items (
  pack_id         uuid not null references public.scoop_packs(id) on delete cascade,
  -- `on delete restrict`, as in the pool: deleting a product that has been
  -- posted inside somebody's scoop would erase what they were sent.
  product_id      uuid not null references public.products(id) on delete restrict,
  -- Two of the same charm is one row with quantity 2, not two rows. Whether a
  -- scoop may contain duplicates at all is the owner's decision; the schema
  -- does not decide it, and the availability rule above is written so that
  -- either answer is safe.
  quantity        integer not null default 1 check (quantity > 0),
  unit_cost_cents integer check (unit_cost_cents is null or unit_cost_cents >= 0),
  primary key (pack_id, product_id)
);

comment on table public.scoop_pack_items is
  'The pieces that actually went into one packed scoop, with what each cost at '
  'the moment it was packed. NULL unit_cost_cents means the product has never '
  'been measured, which makes the whole pack''s cost unknown rather than cheap. '
  'The pack total is a SUM of these rows and is deliberately not stored '
  'anywhere, so there is no second number to disagree with them.';

/* -------------------------------------------------------------- who may read */

-- TIERS AND POOLS ARE PUBLIC. PACKS ARE NOT.
--
-- The shopfront renders the tiers and the products in each pool with the anon
-- key, the same way it renders the catalogue, so both of those tables get a
-- `select` policy and a `select` grant. Everything that records what a
-- particular CUSTOMER received gets the treatment 0003, 0005 and 0006 document:
-- RLS on with NO policy, plus an explicit revoke, because Supabase grants every
-- new table in `public` to anon and authenticated as it is created and the
-- revoke is the only thing that closes it.
--
-- THERE IS NO ANON INSERT ANYWHERE IN THIS FILE, and there must never be. The
-- anon key ships in every browser bundle, so an insert grant is a public
-- PostgREST endpoint that walks past every route's validation. A tier is edited
-- by the studio with the service-role key; a pack is recorded the same way.
alter table public.scoop_tiers enable row level security;
revoke all on table public.scoop_tiers from public;
revoke all on table public.scoop_tiers from anon, authenticated;

-- WHETHER AN INACTIVE OR UNPRICED TIER SHOULD BE READABLE WITH THE BROWSER KEY.
-- It should not, and the policy says so twice over.
--
-- `active` alone would be enough today, because scoop_tiers_activation_check
-- already refuses to activate an unpriced tier. The policy restates the price
-- condition anyway, and that redundancy is the point: RLS is what stands
-- between the anon key and the row, and it must not depend for its correctness
-- on a CHECK constraint somewhere else in the file staying exactly as it is. If
-- that constraint is ever loosened, this policy still refuses to publish a tier
-- with no price rather than letting the shopfront render "$0.00" or "$NaN".
--
-- The inactive half is not about price at all. An inactive tier is a draft —
-- next month's range, a half-written blurb, a pool with two products in it —
-- and publishing drafts with the key that ships in the browser tells anyone who
-- opens devtools what the shop is about to launch.
drop policy if exists "sellable scoop tiers are public" on public.scoop_tiers;
create policy "sellable scoop tiers are public" on public.scoop_tiers
  for select using (active and price_cents is not null);

grant select on table public.scoop_tiers to anon, authenticated;
grant all on table public.scoop_tiers to service_role;

alter table public.scoop_tier_products enable row level security;
revoke all on table public.scoop_tier_products from public;
revoke all on table public.scoop_tier_products from anon, authenticated;

-- A pool row is public exactly when its tier is. Without the EXISTS this table
-- would publish the pool of every draft tier — which is the draft range again,
-- reachable one join sideways.
drop policy if exists "pools of sellable tiers are public" on public.scoop_tier_products;
create policy "pools of sellable tiers are public" on public.scoop_tier_products
  for select using (
    exists (
      select 1 from public.scoop_tiers t
       where t.id = scoop_tier_products.tier_id
         and t.active
         and t.price_cents is not null
    )
  );

grant select on table public.scoop_tier_products to anon, authenticated;
grant all on table public.scoop_tier_products to service_role;

-- Packs record what a named customer's order contained and what the studio paid
-- for it. Neither is anybody's business but hers: no policy at all, so RLS
-- denies every row to every non-bypassing role.
alter table public.scoop_packs enable row level security;
revoke all on table public.scoop_packs from public;
revoke all on table public.scoop_packs from anon, authenticated;
grant select, insert, update, delete on table public.scoop_packs to service_role;

alter table public.scoop_pack_items enable row level security;
revoke all on table public.scoop_pack_items from public;
revoke all on table public.scoop_pack_items from anon, authenticated;
grant select, insert, update, delete on table public.scoop_pack_items to service_role;

-- The guard function reads `scoop_tiers` and `scoop_tier_products` to decide
-- whether a tier is fillable, and it must give the same answer whoever is
-- writing — so it is SECURITY DEFINER with a pinned search_path, like every
-- other definer function in this schema. Nothing may call it directly: it is a
-- trigger, and a trigger function that is executable by the browser key is a
-- function the browser key can be made to run with the owner's rights.
revoke all on function public.scoop_tier_pool_is_big_enough() from public, anon, authenticated;

/* ------------------------------------------------------ what is NOT in here */

-- Written down so the next person does not have to work out what was left
-- deliberately undone.
--
-- ONLY THE APPLICATION CAN ENFORCE THESE:
--
--   * "This tier is sellable right now." It depends on `stock_on_hand` across
--     the pool, which changes with every sale and every print. `lib/scoop.ts`
--     answers it at read time; a constraint would have to re-evaluate on every
--     product write and would fire on the studio's own inventory edits.
--
--   * "The order cannot be marked posted until its contents are recorded."
--     That is a rule about a status transition — it needs to know both the old
--     status and the new one, and it belongs beside the action that makes the
--     transition. A CHECK cannot see the previous row, and a trigger that
--     enforced it would also block every hand repair the studio has to be able
--     to make from the Supabase table editor when something has gone wrong.
--
--   * "Stock has actually come off for this pack." `stock_applied` is the claim
--     flag; taking the claim before decrementing, and only decrementing what the
--     claim won, is the caller's job, exactly as it is for `orders.stock_applied`.
--
--   * "The pieces recorded came from the tier's pool." Enforceable in principle
--     and deliberately not enforced: a pool is edited over time, and a foreign
--     key against today's pool would refuse to record what actually went into a
--     scoop packed last week. What was posted is a fact; the pool is a policy.
--     The pack panel offers the pool and the studio can see what it recorded.
--
-- NOT BUILT, AND NOT NEEDED YET: any notion of a "draw". The shop does not pick
-- the pieces — a person does, on camera, out of a bowl. There is no randomiser
-- in this schema and there should not be one until she asks for it.
