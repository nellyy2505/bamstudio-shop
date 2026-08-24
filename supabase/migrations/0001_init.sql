-- Bam Studio shop — initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
-- One row per authenticated user, created automatically on sign-up.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  marketing_opt_in boolean not null default false,
  review_reminders boolean not null default true,
  restock_alerts boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, marketing_opt_in)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'first_name',
      split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1)
    ),
    coalesce(
      new.raw_user_meta_data ->> 'last_name',
      nullif(substr(
        coalesce(new.raw_user_meta_data ->> 'full_name', ''),
        strpos(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ') + 1
      ), '')
    ),
    -- Set from the sign-up form's opt-in checkbox.
    coalesce((new.raw_user_meta_data ->> 'marketing_opt_in')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- catalogue
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sku text not null unique,
  name text not null,
  short_name text not null,
  category text not null,
  theme text not null,
  description text not null default '',
  price integer not null check (price >= 0),      -- cents, AUD, GST inclusive
  art text not null,
  tint text not null,
  gallery jsonb not null default '[]'::jsonb,
  colours jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  details jsonb not null default '[]'::jsonb,
  rating numeric(2,1) not null default 5.0,
  review_count integer not null default 0,
  stock_on_hand integer not null default 0,
  is_bestseller boolean not null default false,
  is_new boolean not null default false,
  is_personalised boolean not null default false,
  -- How personalisation is collected: 'builder' (keycap letter builder,
  -- priced by bundle) or 'text' (one free-text line, priced at `price`).
  personalisation_mode text
    check (personalisation_mode in ('builder','text')),
  personalisation_label text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists products_category_idx on public.products (category);
create index if not exists products_theme_idx on public.products (theme);
create index if not exists products_active_idx on public.products (active);

-- Full-text search over name + description + theme.
alter table public.products
  drop column if exists search_vector;
alter table public.products
  add column search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(theme, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

create index if not exists products_search_idx
  on public.products using gin (search_vector);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  cap_colour text not null,
  letter_colour text not null,
  holder_colour text not null,
  charm_art text not null,
  charm_name text not null,
  tint text not null,
  is_popular boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  title text not null default '',
  body text not null default '',
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reviews_product_idx on public.reviews (product_id);

-- ---------------------------------------------------------------- customer
create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Home',
  first_name text not null,
  last_name text not null,
  line1 text not null,
  line2 text,
  suburb text not null,
  state text not null,
  postcode text not null,
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists addresses_user_idx on public.addresses (user_id);

create table if not exists public.favourites (
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------------------------------------------------------------- orders
create sequence if not exists public.order_number_seq start 1042;

-- Order numbers are allocated on payment, not when a checkout opens, so
-- abandoned sessions don't burn them. The random suffix stops anyone walking
-- the sequence to look up other people's orders on the tracking page.
create or replace function public.next_order_number()
returns text
language sql
volatile
security definer set search_path = public
as $$
  select 'BS-' || nextval('public.order_number_seq')::text || '-' ||
         upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 4));
$$;

revoke all on function public.next_order_number() from public, anon, authenticated;
-- Explicit, not inherited: the webhook cannot confirm a paid order without it.
grant execute on function public.next_order_number() to service_role;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Null while the checkout is 'pending'; assigned by the webhook on payment.
  order_number text unique,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  -- 'pending' is written when the Stripe session is created; the webhook
  -- promotes it to 'confirmed' once payment actually succeeds.
  status text not null default 'pending'
    check (status in ('pending','confirmed','printing','packed','shipped','delivered','cancelled')),
  subtotal integer not null,
  shipping integer not null default 0,
  total integer not null,
  shipping_method text not null default 'standard',
  gift_note text,
  tracking_number text,
  shipping_address jsonb not null,
  stripe_session_id text unique,
  stripe_payment_intent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id);
create index if not exists orders_email_idx on public.orders (lower(email));

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  variant_label text not null default '',
  art text not null,
  tint text not null,
  unit_price integer not null,
  quantity integer not null check (quantity > 0),
  -- Kept so "buy again" restores the exact variant rather than guessing the
  -- product's first colour and attachment.
  colour text,
  attachment_id text,
  -- Builder charms: {collection_slug, letters, with_charm}.
  -- Text personalisation: {text}.
  personalisation jsonb
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- ---------------------------------------------------------------- RLS
alter table public.profiles     enable row level security;
alter table public.products     enable row level security;
alter table public.collections  enable row level security;
alter table public.reviews      enable row level security;
alter table public.addresses    enable row level security;
alter table public.favourites   enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;

-- Catalogue is world-readable (only active rows).
drop policy if exists "products are public" on public.products;
create policy "products are public" on public.products
  for select using (active = true);

drop policy if exists "collections are public" on public.collections;
create policy "collections are public" on public.collections
  for select using (active = true);

drop policy if exists "reviews are public" on public.reviews;
create policy "reviews are public" on public.reviews
  for select using (true);

-- No client-side review writing. The previous policy only checked that the
-- row's user_id matched the caller, which let any signed-in account post a
-- review on any product with verified = true — under copy that promises
-- reviews come from real purchases.
--
-- When a review UI ships, replace this with a policy that (a) forces
-- verified to be derived, not supplied, and (b) requires a delivered order
-- containing that product, e.g.:
--   for insert with check (
--     auth.uid() = user_id and verified = false and
--     exists (select 1 from public.orders o
--             join public.order_items oi on oi.order_id = o.id
--             where o.user_id = auth.uid()
--               and oi.product_id = reviews.product_id
--               and o.status = 'delivered')
--   )
drop policy if exists "users write own reviews" on public.reviews;

-- Profiles: owner only.
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "own profile write" on public.profiles;
create policy "own profile write" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Lets settings use upsert, so an account whose trigger-created row is
-- missing can still save rather than silently updating zero rows.
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert" on public.profiles
  for insert with check (auth.uid() = id);

-- Addresses: owner only, all verbs.
drop policy if exists "own addresses" on public.addresses;
create policy "own addresses" on public.addresses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Favourites: owner only.
drop policy if exists "own favourites" on public.favourites;
create policy "own favourites" on public.favourites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Orders: readable by the signed-in owner. Writes happen through the
-- Stripe webhook using the service-role key, which bypasses RLS.
drop policy if exists "own orders read" on public.orders;
create policy "own orders read" on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists "own order items read" on public.order_items;
create policy "own order items read" on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------ guest order lookup
-- Guests track an order with its number + the email it was placed with.
-- SECURITY DEFINER so it can read past RLS, but it only ever returns the
-- single row whose number and email both match.
create or replace function public.lookup_order(
  p_order_number text,
  p_email text
)
returns table (
  order_number text,
  status text,
  total integer,
  shipping_method text,
  tracking_number text,
  created_at timestamptz,
  shipping_address jsonb,
  items jsonb
)
language sql
security definer set search_path = public
as $$
  select
    o.order_number,
    o.status,
    o.total,
    o.shipping_method,
    o.tracking_number,
    o.created_at,
    o.shipping_address,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'product_name', oi.product_name,
          'variant_label', oi.variant_label,
          'art', oi.art,
          'tint', oi.tint,
          'unit_price', oi.unit_price,
          'quantity', oi.quantity
        ))
        from public.order_items oi
        where oi.order_id = o.id
      ),
      '[]'::jsonb
    ) as items
  from public.orders o
  where upper(trim(o.order_number)) = upper(trim(p_order_number))
    and lower(trim(o.email)) = lower(trim(p_email))
    -- Abandoned checkouts were never paid for; they are not trackable orders.
    and o.status <> 'pending'
  limit 1;
$$;

revoke all on function public.lookup_order(text, text) from public;
grant execute on function public.lookup_order(text, text) to anon, authenticated;

-- ------------------------------------------------------------ search helper
create or replace function public.search_products(p_query text)
returns setof public.products
language sql
stable
as $$
  select *
  from public.products
  where active = true
    and (
      search_vector @@ websearch_to_tsquery('english', p_query)
      or name ilike '%' || p_query || '%'
      or theme ilike '%' || p_query || '%'
    )
  order by
    ts_rank(search_vector, websearch_to_tsquery('english', p_query)) desc,
    is_bestseller desc
  limit 60;
$$;

-- --------------------------------------------------------- stock decrement
-- Called by the Stripe webhook with the service-role key. Clamped at zero so
-- a race between two orders can't push stock negative.
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_quantity integer
)
returns void
language sql
security definer set search_path = public
as $$
  update public.products
  set stock_on_hand = greatest(0, stock_on_hand - greatest(0, p_quantity))
  where id = p_product_id;
$$;

revoke all on function public.decrement_stock(uuid, integer) from public, anon, authenticated;
grant execute on function public.decrement_stock(uuid, integer) to service_role;
