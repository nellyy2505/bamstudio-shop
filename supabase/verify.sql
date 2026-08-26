-- Schema smoke test.
--
-- Run this in the Supabase SQL editor after applying 0001_init.sql,
-- 0002_shipping.sql and seed.sql. It returns ONE table of 45 rows and every
-- `pass` must be `t`. These are the guarantees that only fail in production —
-- a missing grant here means paid orders are never recorded, and you would
-- first hear about it from a customer.
--
-- Count the rows as well as the ticks. 45 rows means all three migrations
-- are applied; 29 rows all `t` would be a green result that never looked at
-- the staff area, and 24 that never looked at shipping either.
--
-- It writes four throwaway orders (and one order item) inside a transaction it
-- rolls back, so it is safe to run against a live database, though quiet hours
-- are still kinder.

begin;

-- Assertions are collected here rather than printed one statement at a time.
--
-- The Supabase SQL editor shows only the result of the LAST statement it runs.
-- This file used to be eight separate assertion statements, so pasting it into
-- the editor displayed two rows and silently hid the other twenty-seven: the
-- owner could not check her own database with the tool the runbook tells her to
-- use, and two ticks out of two looks like a pass. One table and one final
-- select gives all 29 rows in the editor and in psql alike.
--
-- Rolled back with everything else below, so it leaves nothing behind.
create temp table _checks (
  ord        serial primary key,
  check_name text not null,
  pass       boolean
);

-- The catalogue loaded, and carries no invented review history.
insert into _checks (check_name, pass)
select 'products loaded'            as check, count(*) > 0                      as pass from public.products
union all
select 'no fabricated ratings',            count(*) filter (where rating > 0) = 0        from public.products
union all
select 'personalised products have a mode', count(*) filter (
         where is_personalised and personalisation_mode is null) = 0            from public.products
union all
-- 16 since 0003_admin.sql added staff, staff_invitations, colours,
-- filament_stock, shop_settings, accessories and product_filament. A new table
-- that forgets to enable RLS lands in `public` readable by the anon key, so
-- this count is deliberately exact rather than `>=`.
select 'row-level security everywhere',    count(*) = 16 from pg_tables
         where schemaname = 'public' and rowsecurity = true
union all
-- A client must never be able to write a review: the old policy let any
-- signed-in account post one on any product, flagged as a verified purchase.
select 'no client review inserts',         count(*) = 0 from pg_policies
         where schemaname = 'public' and tablename = 'reviews' and cmd = 'INSERT'
union all
-- Postage is quoted from Australia Post on weight, so a product with no
-- weight — or one whose default was edited to 0 in the table editor — is a
-- product that cannot be priced for posting at checkout.
select 'every product has a weight',       count(*) filter (
         where weight_grams is null or weight_grams <= 0) = 0                    from public.products
union all
-- Dimensions do not set the price, but they decide Large Letter eligibility
-- and Australia Post rejects a quote whose dimensions are not plausible.
select 'every product has dimensions',     count(*) filter (
         where length_mm is null or length_mm <= 0
            or width_mm is null or width_mm <= 0
            or thickness_mm is null or thickness_mm <= 0) = 0                    from public.products;

-- The webhook cannot confirm a paid order without these two grants. This is
-- the check worth caring about: without it the failure is silent until a
-- customer asks where their order went.
insert into _checks (check_name, pass)
select 'webhook can allocate order numbers' as check,
       has_function_privilege('service_role', 'public.next_order_number()', 'execute') as pass
union all
select 'webhook can move stock',
       has_function_privilege('service_role', 'public.decrement_stock(uuid, integer)', 'execute')
union all
select 'shoppers cannot allocate order numbers',
       not has_function_privilege('anon', 'public.next_order_number()', 'execute')
union all
-- lookup_order returns shipping_address — line1, line2 and phone. It was
-- granted to anon, so PostgREST would run it for anyone holding the public
-- anon key and the /api/track rate limit protected nothing. These three rows
-- are the proof that blocker is closed and stays closed.
select 'anon cannot look up orders',
       not has_function_privilege('anon', 'public.lookup_order(text, text)', 'execute')
union all
select 'signed-in cannot look up orders',
       not has_function_privilege('authenticated', 'public.lookup_order(text, text)', 'execute')
union all
select 'track route can look up orders',
       has_function_privilege('service_role', 'public.lookup_order(text, text)', 'execute')
union all
-- Same shape for the confirmation lookup: reachable only through the admin
-- client behind /order/confirmed, never with the public key.
select 'anon cannot read confirmation summary',
       not has_function_privilege('anon', 'public.order_confirmation_summary(text)', 'execute')
union all
select 'confirmed page can read its summary',
       has_function_privilege('service_role', 'public.order_confirmation_summary(text)', 'execute')
union all
-- shipping_rate_cache is internal pricing data — what postage costs the studio
-- and when we last asked. Supabase grants every new table in `public` to anon
-- and authenticated by default privilege as it is created, so the revoke in
-- 0002_shipping.sql is the only thing standing between it and anyone holding
-- the anon key that ships in the browser bundle. These two rows are the proof
-- that revoke is there and stays there.
select 'anon cannot read the rate cache',
       not has_table_privilege('anon', 'public.shipping_rate_cache', 'select')
union all
select 'signed-in cannot read the rate cache',
       not has_table_privilege('authenticated', 'public.shipping_rate_cache', 'select')
union all
-- ...and the counterpart: the server-side quoting path must still be able to
-- read and write it, or every checkout pays for a fresh API round trip.
select 'quoting can read the rate cache',
       has_table_privilege('service_role', 'public.shipping_rate_cache', 'select');

-- Stock can only be claimed once, however many times Stripe retries.
insert into public.orders
  (email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('verify@example.test', 'confirmed', 1200, 0, 1200, '{}'::jsonb, 'cs_verify_claim');

-- Two UPDATEs in one statement share a snapshot, so putting both claims in a
-- single WITH would have the second skipped by same-statement semantics
-- rather than by the `stock_applied = false` predicate — it would print `t`
-- without testing anything. Run them as separate statements so the second
-- genuinely re-reads the row the first committed.
update public.orders set stock_applied = true
 where stripe_session_id = 'cs_verify_claim' and stock_applied = false;

insert into _checks (check_name, pass)
select 'first claim takes the row' as check, count(*) = 1 as pass
  from public.orders
 where stripe_session_id = 'cs_verify_claim' and stock_applied = true;

update public.orders set stock_applied = true
 where stripe_session_id = 'cs_verify_claim' and stock_applied = false;

insert into _checks (check_name, pass)
select 'second claim moves nothing' as check, count(*) = 0 as pass
  from public.orders
 where stripe_session_id = 'cs_verify_claim' and stock_applied = false;

-- An unpaid checkout is not an order, and an order is only findable by
-- someone who knows both its number and the email it was placed with.
insert into public.orders
  (order_number, email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('BS-VERIFY-0001', 'verify@example.test', 'pending', 900, 0, 900, '{}'::jsonb, 'cs_verify_pending');

insert into _checks (check_name, pass)
select 'pending orders are not trackable' as check,
       (select count(*) from public.lookup_order('BS-VERIFY-0001', 'verify@example.test')) = 0 as pass
union all
select 'wrong email finds nothing',
       (select count(*) from public.lookup_order('BS-VERIFY-0001', 'someone@else.test')) = 0;

-- The confirmed page's own lookup, keyed on the Stripe session id the guest
-- already holds. The row above is deliberately still 'pending' — a shopper
-- who has paid arrives ahead of the webhook, and the page must be able to say
-- "paid, order number on its way" rather than "no such session", so unlike
-- lookup_order this one must find it.
insert into _checks (check_name, pass)
select 'confirmation summary finds a pending order' as check,
       (select count(*) from public.order_confirmation_summary('cs_verify_pending')) = 1 as pass
union all
select 'unknown session finds nothing',
       (select count(*) from public.order_confirmation_summary('cs_not_a_session')) = 0
union all
-- The returned column list is the security boundary — no email, address,
-- phone or total. Widening it must break this row, not slip through review.
select 'confirmation summary returns 2 columns',
       pg_get_function_result(p.oid) = 'TABLE(order_number text, status text)'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'order_confirmation_summary';

-- §0.7: the one-time stock_applied backfill must not touch a *stranded* order
-- — confirmed, but with no order number and no items, because an earlier
-- webhook delivery died mid-confirm. Its stock genuinely never moved, and it
-- is the repair branch's input; marking it applied makes claimStock return
-- false forever and the stock is never moved at all.
insert into public.orders
  (email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('verify@example.test', 'confirmed', 1500, 0, 1500, '{}'::jsonb, 'cs_verify_stranded');

-- ...while an order that demonstrably finished — numbered, with line items —
-- must still be marked, or a Stripe redelivery double-decrements its stock.
insert into public.orders
  (order_number, email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('BS-VERIFY-0002', 'verify@example.test', 'confirmed', 1500, 0, 1500, '{}'::jsonb, 'cs_verify_finished');

insert into public.order_items
  (order_id, product_name, art, tint, unit_price, quantity)
select o.id, 'Verify clicker', 'clicker', 'sky', 1500, 1
  from public.orders o
 where o.stripe_session_id = 'cs_verify_finished';

-- The predicate below is a copy of the backfill's WHERE clause in
-- 0001_init.sql, scoped to one row at a time. The backfill itself is a
-- one-time statement that has already run by the time this file executes, so
-- what is asserted is the predicate, not the UPDATE.
insert into _checks (check_name, pass)
select 'backfill skips a stranded order' as check,
       (select count(*) from public.orders o
         where o.stripe_session_id = 'cs_verify_stranded'
           and o.status <> 'pending'
           and o.stock_applied = false
           and o.order_number is not null
           and exists (select 1 from public.order_items oi where oi.order_id = o.id)) = 0 as pass
union all
select 'backfill marks a finished order',
       (select count(*) from public.orders o
         where o.stripe_session_id = 'cs_verify_finished'
           and o.status <> 'pending'
           and o.stock_applied = false
           and o.order_number is not null
           and exists (select 1 from public.order_items oi where oi.order_id = o.id)) = 1;

-- 0003_admin.sql. `role` is not a column on `profiles` because 0001 grants every
-- signed-in account UPDATE on its own profile row across all columns — a role
-- there would be self-assignable over PostgREST with the anon key that ships in
-- the browser. These four rows are the proof that authority lives somewhere the
-- public key cannot reach, and stays there.
insert into _checks (check_name, pass)
select 'anon cannot read staff',
       not has_table_privilege('anon', 'public.staff', 'select') as pass
union all
select 'signed-in cannot read staff',
       not has_table_privilege('authenticated', 'public.staff', 'select')
union all
select 'signed-in cannot write staff',
       not has_table_privilege('authenticated', 'public.staff', 'update')
union all
select 'the server can read staff',
       has_table_privilege('service_role', 'public.staff', 'select')
union all
-- An invitation token is the whole of the authority it grants, so the table is
-- as closed as `staff` itself.
select 'anon cannot read invitations',
       not has_table_privilege('anon', 'public.staff_invitations', 'select')
union all
select 'signed-in cannot read invitations',
       not has_table_privilege('authenticated', 'public.staff_invitations', 'select')
union all
-- Settings holds margins and costs. Nothing customer-facing reads it.
select 'anon cannot read settings',
       not has_table_privilege('anon', 'public.shop_settings', 'select')
union all
select 'signed-in cannot read settings',
       not has_table_privilege('authenticated', 'public.shop_settings', 'select')
union all
-- How many rolls are on the shelf is a business figure, which is why it is its
-- own table rather than a column on the public `colours` row.
select 'anon cannot read filament stock',
       not has_table_privilege('anon', 'public.filament_stock', 'select')
union all
-- ...while the palette itself must be readable, or the shop cannot draw a swatch.
select 'the shop can read colours',
       has_table_privilege('anon', 'public.colours', 'select');

insert into _checks (check_name, pass)
select 'the filament palette loaded', count(*) = 18 from public.colours
union all
select 'every colour has a real hex',
       count(*) filter (where hex !~ '^#[0-9A-Fa-f]{6}$') = 0 from public.colours
union all
select 'costing settings exist', count(*) = 1 from public.shop_settings
union all
-- The singleton really is a singleton: the primary key can only hold `true`.
select 'settings cannot be duplicated',
       (select count(*) from pg_constraint
         where conrelid = 'public.shop_settings'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%id%') > 0
union all
-- Cost is captured per line at the time of sale. Without it every historical
-- margin rewrites itself the next time a filament price changes.
select 'order lines can record their cost',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'order_items'
                  and column_name = 'unit_cost_cents')
union all
select 'orders know which channel they came from',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'orders'
                  and column_name = 'channel')
union all
-- Every option the studio can put on a product has a price, even if that price
-- is a deliberate zero. The workbook's equivalent lookup silently returned 0
-- for three of its seven attachment options; a foreign key onto a seeded table
-- is what stops that being possible.
select 'every accessory is priced',
       (select count(*) from public.accessories) = 9
union all
-- Cost data, so the browser key must not reach it.
select 'anon cannot read accessories',
       not has_table_privilege('anon', 'public.accessories', 'select')
union all
select 'anon cannot read filament recipes',
       not has_table_privilege('anon', 'public.product_filament', 'select')
union all
-- The workbook needs a whole check row for this ("grams typed with no colour
-- chosen — should be 0") because there, grams and colour are separate cells.
-- Here the primary key makes the pair inseparable, so the condition it checks
-- for cannot be represented at all. This asserts the structure that makes it
-- impossible, not the absence of bad rows.
select 'grams cannot exist without a colour',
       (select count(*) from information_schema.key_column_usage
         where table_schema = 'public' and table_name = 'product_filament'
           and constraint_name = (select constraint_name
                                    from information_schema.table_constraints
                                   where table_schema = 'public'
                                     and table_name = 'product_filament'
                                     and constraint_type = 'PRIMARY KEY')) = 2
union all
-- Deleting a colour a product prints in would quietly reduce that product's
-- cost. Restrict makes the studio deactivate it instead.
select 'a colour in use cannot be deleted',
       exists (select 1 from pg_constraint
                where conrelid = 'public.product_filament'::regclass
                  and contype = 'f' and confdeltype = 'r'
                  and confrelid = 'public.colours'::regclass);

-- Search is bounded: a lone wildcard must not match the whole catalogue.
insert into _checks (check_name, pass)
select 'search rejects a bare wildcard' as check,
       (select count(*) from public.search_products('%')) = 0 as pass
union all
select 'search ignores empty input',
       (select count(*) from public.search_products('   ')) = 0;

-- Every assertion, in one result set. `pass` must be `t` on all 45 rows.
select check_name as check, pass from _checks order by ord;

rollback;
