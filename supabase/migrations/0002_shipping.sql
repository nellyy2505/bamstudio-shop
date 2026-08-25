-- Bam Studio shop — postage priced by weight
-- Run this in the Supabase SQL editor after 0001_init.sql (or via `supabase db push`).
--
-- Postage was a flat rate. Australia Post's Postage Assessment Calculator
-- prices on *weight* and validates dimensions, so the catalogue has to carry
-- both before a real quote can be asked for — today it carries neither.
--
-- Domestic parcel price does not vary by destination postcode (checked against
-- the live API), so nothing here records a destination: weight is the whole
-- input, and dimensions only decide which tier a basket falls into. Large
-- Letter is the cheap one — ≤125 g, ≤260×360 mm, ≤20 mm thick — but it is
-- untracked and uninsured, which is a judgement call per product, not a
-- measurement (see letter_eligible below).
--
-- Like 0001_init.sql, this file is safe to re-run: every statement is guarded,
-- and every column added to an existing table is either `not null` with a
-- default or nullable. Nothing here needs a backfill.

-- ----------------------------------------------- product physical attributes
alter table public.products
  add column if not exists weight_grams integer not null default 12,
  add column if not exists length_mm integer not null default 60,
  add column if not exists width_mm integer not null default 60,
  add column if not exists thickness_mm integer not null default 8,
  -- Defaults FALSE on purpose. A row added by hand in the Supabase table
  -- editor then quotes as a tracked parcel, which overcharges slightly; a
  -- default of true would quote it as an untracked Large Letter, which
  -- undercharges and is the direction that costs real money. Turning this on
  -- is a deliberate per-product decision, never an accident of the default.
  add column if not exists letter_eligible boolean not null default false;

-- Stated as a named constraint rather than inline on the column: `add column
-- if not exists` skips the whole clause on a database that already has the
-- column, so an inline check would never arrive there. Same drop/add shape as
-- products_personalisation_mode_check in 0001_init.sql.
alter table public.products
  drop constraint if exists products_weight_grams_check;
alter table public.products
  add constraint products_weight_grams_check check (weight_grams > 0);

-- These are `comment on column` rather than the `--` notes used elsewhere in
-- this schema because Supabase's table editor renders a column comment beside
-- the column — which is exactly where the owner will be sitting when she asks
-- herself what a number means and what a sensible one would be.
comment on column public.products.weight_grams is
  'Packed weight in grams — the single input Australia Post prices a domestic '
  'parcel on. The default is a charm-sized guess so that no row is ever '
  'unpriceable and no backfill is required; the owner refines it per row in '
  'the Supabase table editor, without a deploy.';

comment on column public.products.length_mm is
  'Packed length in mm. Australia Post does not price on dimensions but does '
  'validate them, and they decide whether a basket still fits the Large Letter '
  'tier (≤260×360 mm, ≤20 mm thick). Refined per row in the table editor, '
  'without a deploy.';

comment on column public.products.width_mm is
  'Packed width in mm — see length_mm. Refined per row in the table editor, '
  'without a deploy.';

comment on column public.products.thickness_mm is
  'Packed thickness in mm. The binding Large Letter limit is 20 mm, so this is '
  'usually what pushes an item into parcel pricing. Refined per row in the '
  'table editor, without a deploy.';

comment on column public.products.letter_eligible is
  'Owner''s manual override: false forces this item to be quoted as a parcel '
  'however small the stored measurements look. It exists because bulk is not '
  'always captured by a bounding box — a bowl or a phone stand is rigid and '
  'awkward, and Large Letter is untracked and uninsured, so shipping one that '
  'way is a loss the studio wears. Set per row in the Supabase table editor, '
  'without a deploy.';

-- ------------------------------------------------------------- rate cache
-- Quotes from the Australia Post API, kept so a checkout does not pay for a
-- round trip that was already made. Keyed on the inputs that determine the
-- price, not on a basket or a customer.
create table if not exists public.shipping_rate_cache (
  key text primary key,
  service_code text not null,
  amount_cents integer not null check (amount_cents >= 0),
  source text not null,
  fetched_at timestamptz not null default now()
);

comment on column public.shipping_rate_cache.key is
  'The cache key: service code + weight band + dimensions. Deliberately not '
  'keyed on a destination — domestic parcel price does not vary by postcode.';
comment on column public.shipping_rate_cache.service_code is
  'The Australia Post service the amount was quoted for.';
comment on column public.shipping_rate_cache.amount_cents is
  'Quoted postage in cents (AUD), matching the cents convention used by '
  'products.price and orders.total.';
comment on column public.shipping_rate_cache.source is
  'Where the number came from: ''live'' (the API answered) or ''fallback'' (it '
  'did not, and a hardcoded rate was used). Kept so a wrong charge can be '
  'traced to the API or to us.';
comment on column public.shipping_rate_cache.fetched_at is
  'When the quote was taken, so staleness can be judged at read time rather '
  'than by a scheduled purge.';

alter table public.shipping_rate_cache enable row level security;

-- No policies are created, on purpose: RLS with no policy denies every row to
-- every non-bypassing role, and service_role bypasses RLS. Reads and writes
-- happen only through the server-side admin client.
--
-- The revoke below is explicit rather than relying on `revoke ... from public`,
-- for the same reason lookup_order is in 0001_init.sql: Supabase's default
-- privileges hand every newly created table in `public` to anon and
-- authenticated as it is created, and those grants are direct, so a revoke
-- aimed at PUBLIC leaves them untouched. Table privileges are also checked
-- before RLS is consulted, so this is the outer of the two locks.
--
-- Why it matters: this is internal pricing data — what postage costs the
-- studio, and when we last asked. It is never rendered to a shopper, and it
-- has no business being readable with the anon key that ships in the browser
-- bundle.
revoke all on table public.shipping_rate_cache from public;
revoke all on table public.shipping_rate_cache from anon, authenticated;
grant select, insert, update, delete on table public.shipping_rate_cache to service_role;

-- ------------------------------------------------------- quote provenance
-- Nullable, and staying that way: orders placed before postage was quoted
-- legitimately have none of this, and a null here means "flat rate era", not
-- "missing data".
alter table public.orders
  add column if not exists shipping_quote_source text,
  add column if not exists quoted_weight_grams integer,
  add column if not exists quoted_service_code text;

comment on column public.orders.shipping_quote_source is
  'How the postage charged on this order was arrived at: ''live'', ''cache'', '
  '''stale'' or ''fallback''. Stored so that a discrepancy noticed months later '
  '— the studio paid $10.20 to post something the customer was charged $3.40 '
  'for — is diagnosable, instead of being an argument about what the API '
  'probably returned that day.';

comment on column public.orders.quoted_weight_grams is
  'The basket weight the quote was priced on. Kept for the same reason, and '
  'because a future label-printing phase should create the shipment from what '
  'was actually quoted rather than re-deriving it from a basket whose products '
  'may have been re-measured, re-priced or deactivated since.';

comment on column public.orders.quoted_service_code is
  'The Australia Post service the quote was for — the other half of what a '
  'label needs, and what says whether this parcel was sold as tracked.';
