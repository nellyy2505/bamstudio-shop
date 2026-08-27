-- Schema smoke test.
--
-- Run this in the Supabase SQL editor after applying every file in
-- supabase/migrations/ in order and then seed.sql. It returns ONE table of 126
-- rows and every `pass` must be `t`. These are the guarantees that only fail
-- in production — a missing grant here means paid orders are never recorded,
-- and you would first hear about it from a customer.
--
-- Count the rows as well as the ticks. This file has grown with the schema —
-- 24 assertions, then 29 with shipping, 50 with the staff area, 52 with the
-- letter_eligible default, 65 with 0005 (the confirmation-email stamp, the
-- observable stock clamp and the refund register), 86 with 0006 (the enquiry
-- and sign-up tables), 126 with 0007 (the Lucky Scoop tiers, their pools and
-- what went into a packed scoop) — so a shorter table than 126 means an older
-- copy of this file, and an older copy is a green result that never looked at
-- part of the schema. That reads like a pass and is not one.
--
-- A migration that is not applied does not shorten the table, it stops the run:
-- the first assertion that names a missing object raises instead of returning
-- `f`. `scripts/verify-sql.sh` applies every file in supabase/migrations/
-- rather than a hand-written list, because the list fell behind twice.
--
-- It writes six throwaway orders (three with order items), six throwaway
-- products, one throwaway payment incident, one throwaway enquiry, one
-- throwaway newsletter sign-up, and a handful of throwaway scoop tiers with one
-- packed scoop, inside a transaction it rolls back — so it is safe to run
-- against a live database, though quiet hours are still kinder.
--
-- One thing it does that the others do not: the scoop block briefly SETs ROLE
-- to `anon` to count what the shopfront can actually see. RLS is invisible from
-- the postgres role, which bypasses it, so a policy asserted any other way is
-- asserted by reading its source rather than by running it. The role is reset
-- immediately afterwards and the whole thing is inside the same rollback.

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
-- filament_stock, shop_settings, accessories and product_filament; 17 since
-- 0005_sale_integrity.sql added payment_incidents; 19 since 0006_enquiries.sql
-- added contact_enquiries and newsletter_signups; 23 since 0007_lucky_scoop.sql
-- added scoop_tiers, scoop_tier_products, scoop_packs and scoop_pack_items. A
-- new table that forgets to enable RLS lands in `public` readable by the anon
-- key, so this count is deliberately exact rather than `>=`.
select 'row-level security everywhere',    count(*) = 23 from pg_tables
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

-- 0004_letter_eligible_default.sql. `letter_eligible` decides whether an item
-- is quoted as a $3.40 untracked Large Letter or a ~$10.20 tracked parcel, and
-- lib/shipping/weights.ts is written on the assumption that an unstated value
-- means parcel. 0002 shipped the column defaulting to `true`, so a row typed
-- into the Supabase table editor arrived claiming cheap postage for something
-- nobody had measured. These two rows are the proof that is closed.
--
-- Two assertions rather than one because they fail for different reasons. The
-- first reads the declared default, so it catches a migration that changes it.
-- The second inserts a row the way the table editor does — every shipping
-- column left alone — so it catches a trigger, a rule or a rewritten column
-- that produces `true` while the catalogue still says `false`.
insert into public.products
  (slug, sku, name, short_name, category, theme, art, tint, price, rating)
values
  -- rating 0 on purpose: the column defaults to 5.0 and 'no fabricated
  -- ratings' above counts any product with a rating. That check has already
  -- run by this point, but a row that would break it if this block were ever
  -- moved is a trap, not a test.
  ('verify-default-probe', 'VERIFY-000', 'Verify default probe', 'Probe',
   'Clicker keychain', 'mono', 'clicker', 'sky', 100, 0);

insert into _checks (check_name, pass)
select 'new products default to parcel' as check,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'products'
           and column_name = 'letter_eligible') = 'false' as pass
union all
select 'a hand-added product is not letter-eligible',
       (select letter_eligible from public.products
         where slug = 'verify-default-probe') = false;

-- 0005_sale_integrity.sql, part 1: the confirmation email is recoverable.
--
-- The mail used to get exactly one attempt, queued from inside the branch of
-- assignOrderNumber that only the delivery which *allocated* the number can
-- reach. Every Stripe redelivery therefore skipped it, and nothing recorded
-- whether it had ever gone out — a lost send was lost with the process that
-- dropped it, leaving a paid customer with no order number and /track needing
-- one. The column below is what makes a retry able to tell.
--
-- Two rows, failing for different reasons: the first catches the column being
-- dropped or renamed, the second catches it acquiring a default (a `now()`
-- there would mark every order as confirmed by email the instant it is staged,
-- which is the same silence with a tick beside it).
insert into public.orders
  (email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('verify@example.test', 'confirmed', 1100, 0, 1100, '{}'::jsonb, 'cs_verify_mail');

insert into _checks (check_name, pass)
select 'orders record when mail was sent' as check,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'orders'
                  and column_name = 'confirmation_email_sent_at') as pass
union all
select 'a new order has no mail stamp',
       (select confirmation_email_sent_at is null from public.orders
         where stripe_session_id = 'cs_verify_mail');

-- 0005, part 2: stock is moved in SQL, and the clamp is observable.
--
-- decrement_stock was `set stock_on_hand = greatest(0, stock_on_hand - qty)`
-- returning void, so selling the last one twice succeeded twice in silence;
-- recordSale was worse, reading the count in JavaScript and writing back
-- `Math.max(0, read - qty)`, which discards any decrement that lands in
-- between. The clamp stays — a shelf cannot hold minus one — but the shortfall
-- is now returned to the caller and accumulated on the row, because this shop
-- prints to order and an oversell is a print-this-first signal, not an error.
insert into public.products
  (slug, sku, name, short_name, category, theme, art, tint, price, rating, stock_on_hand)
values
  -- rating 0 for the same reason as the probe below: 'no fabricated ratings'
  -- has already run, but a row that would break it if this block moved is a
  -- trap rather than a test.
  ('verify-stock-probe', 'VERIFY-001', 'Verify stock probe', 'Stock probe',
   'Clicker keychain', 'mono', 'clicker', 'sky', 100, 0, 3);

-- Each sale is run in its own statement and its result written down before the
-- next one, for the reason the stock-claim block above gives: everything in one
-- statement shares one snapshot, so a read UNIONed alongside the call that
-- changed the row would report the value from *before* it and print `t` without
-- testing anything.
create temp table _stock (
  step      text primary key,
  shortfall integer,
  on_hand   integer,
  oversold  integer
);

-- Two of the three on the shelf: an ordinary sale.
insert into _stock (step, shortfall)
select 'within', public.decrement_stock(
  (select id from public.products where slug = 'verify-stock-probe'), 2);

update _stock set
  on_hand  = (select stock_on_hand  from public.products where slug = 'verify-stock-probe'),
  oversold = (select oversold_units from public.products where slug = 'verify-stock-probe')
 where step = 'within';

-- Two more, when one is left: the sale the old function took twice in silence.
insert into _stock (step, shortfall)
select 'oversell', public.decrement_stock(
  (select id from public.products where slug = 'verify-stock-probe'), 2);

update _stock set
  on_hand  = (select stock_on_hand  from public.products where slug = 'verify-stock-probe'),
  oversold = (select oversold_units from public.products where slug = 'verify-stock-probe')
 where step = 'oversell';

insert into _stock (step, shortfall)
select 'unknown', public.decrement_stock(
  '00000000-0000-0000-0000-000000000000'::uuid, 1);

insert into _checks (check_name, pass)
select 'a sale within stock takes what it asked' as check,
       (select shortfall from _stock where step = 'within') = 0 as pass
union all
select 'that sale left the right count',
       (select on_hand from _stock where step = 'within') = 1
union all
select 'selling two of the last one is reported',
       (select shortfall from _stock where step = 'oversell') = 1
union all
select 'stock never goes negative',
       (select on_hand from _stock where step = 'oversell') = 0
union all
-- The whole point of the change: the shop is not protected from finding out.
select 'the oversell is recorded, not just clamped',
       (select oversold from _stock where step = 'oversell') = 1
union all
-- A product that is not there is a different answer from a sale that took
-- nothing, and nulls stay null.
select 'an unknown product answers null',
       (select shortfall from _stock where step = 'unknown') is null;

-- 0005, part 3: a payment that owes a refund is a row, not a log line.
--
-- A cancelled order that is paid anyway used to produce one `console.error`
-- saying "refund this one by hand" and a 200 to Stripe. The customer was
-- charged, received nothing, and the only record was on a platform nobody
-- reads. `stripe_session_id` is unique so the webhook can record it once
-- however many times Stripe redelivers, and the table is service-role only
-- because it holds a payment intent and an amount charged.
insert into public.payment_incidents
  (stripe_session_id, amount_cents, kind, order_status, detail)
values
  ('cs_verify_incident', 2400, 'paid_while_cancelled', 'cancelled', 'verify');

insert into public.payment_incidents
  (stripe_session_id, amount_cents, kind, order_status, detail)
values
  ('cs_verify_incident', 2400, 'paid_while_cancelled', 'cancelled', 'redelivery')
-- No conflict target on purpose. `on conflict (stripe_session_id)` would raise
-- if that unique constraint were ever dropped, aborting the run instead of
-- printing an `f`; the bare form inserts a second row in that case and the
-- assertion below goes red, which is what it is for.
on conflict do nothing;

insert into _checks (check_name, pass)
select 'a redelivered payment records one incident' as check,
       (select count(*) from public.payment_incidents
         where stripe_session_id = 'cs_verify_incident') = 1 as pass
union all
-- Open means unresolved, and unresolved is what the studio overview shows.
-- Phrased as a NOT EXISTS rather than reading the column out of a subquery:
-- if the unique constraint above were dropped there would be two rows here,
-- and a scalar subquery would raise — aborting the run instead of letting the
-- row above print the `f` it is there to print.
select 'a new incident is unresolved',
       not exists (select 1 from public.payment_incidents
                    where stripe_session_id = 'cs_verify_incident'
                      and resolved_at is not null)
union all
select 'anon cannot read payment incidents',
       not has_table_privilege('anon', 'public.payment_incidents', 'select')
union all
select 'signed-in cannot read payment incidents',
       not has_table_privilege('authenticated', 'public.payment_incidents', 'select')
union all
select 'the webhook can record an incident',
       has_table_privilege('service_role', 'public.payment_incidents', 'insert');

-- 0006_enquiries.sql: the customer's message is a row before it is an email.
--
-- /api/contact used to hand the enquiry to Resend and store it nowhere — its
-- own comment said "the email IS the delivery" — and answered
-- `{ ok: true, delivered: false }` when the send failed. An unset
-- RESEND_API_KEY, an unset NEXT_PUBLIC_SUPPORT_EMAIL, a provider 5xx or an
-- 8-second timeout each destroyed the only copy of what the customer typed.
-- This shop states in its own legal pages that it sends no order emails, so
-- the form is one of very few channels a customer has, and a message reporting
-- faulty goods is the one that must not vanish. The rows below assert that the
-- table exists, that it accepts the shape the route writes, that it refuses
-- what the route refuses, and that nobody holding the browser key can reach it.
insert into public.contact_enquiries (name, email, topic, order_number, message)
values
  ('Verify Customer', 'verify@example.test', 'returns', 'BS-VERIFY-0001',
   'The clicker arrived with a cracked hinge and will not click.');

insert into _checks (check_name, pass)
select 'an enquiry is stored as a row' as check,
       (select count(*) from public.contact_enquiries
         where email = 'verify@example.test') = 1 as pass
union all
-- Null means no notification has gone out for this enquiry, in the same shape
-- as orders.confirmation_email_sent_at. A `now()` default here would mark every
-- enquiry as notified the instant it is written, which is the old silence with
-- a tick beside it.
--
-- Phrased as NOT EXISTS rather than reading the column out of a scalar
-- subquery, for the reason the payment-incident block above gives: a schema
-- change that produced two matching rows would make a scalar subquery *raise*,
-- aborting the run instead of letting the row above print the `f` it is there
-- to print.
select 'a new enquiry has no notify stamp',
       not exists (select 1 from public.contact_enquiries
                    where email = 'verify@example.test'
                      and notified_at is not null)
union all
-- Open means unanswered, and unanswered is what a studio inbox screen shows.
select 'a new enquiry is unanswered',
       not exists (select 1 from public.contact_enquiries
                    where email = 'verify@example.test'
                      and handled_at is not null);

-- The length bound bites. Both assertions below run the offending insert inside
-- a subtransaction and catch the violation: a bare insert would abort the whole
-- run rather than print an `f`, and a run that stops is not a run that failed.
--
-- The bound matters because this is an unauthenticated endpoint that now writes
-- rows. lib/rate-limit.ts allows 5 posts per minute per IP, held in one
-- process's memory and reset by every deploy, so the row size is the other half
-- of what a flood costs: 2000 characters caps a worst-case row at a little over
-- 2 KB, which is what makes 5/min a number you can multiply.
do $$
begin
  begin
    insert into public.contact_enquiries (name, email, topic, message)
    values ('Bot', 'bot@example.test', 'other', repeat('x', 2001));
    insert into _checks (check_name, pass)
    values ('an over-long message is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('an over-long message is refused', true);
  end;
end $$;

-- The topic enum is a copy of the route's zod enum. A value the dropdown cannot
-- produce is a value that did not come from the form, and `topic` is the one
-- field the route is allowed to log precisely because it cannot be free text.
do $$
begin
  begin
    insert into public.contact_enquiries (name, email, topic, message)
    values ('Bot', 'bot@example.test', 'refund-me-now', 'ten characters');
    insert into _checks (check_name, pass)
    values ('an invented topic is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('an invented topic is refused', true);
  end;
end $$;

-- Who may reach it. A name, an email address and free text a stranger typed:
-- service_role only, in and out. The four `not has_table_privilege` rows are
-- the insert-path decision made testable — the browser writes nothing directly,
-- the route writes it server-side after validating and rate-limiting it. Adding
-- `grant insert to anon` to make a client-side submit "easier" turns this table
-- into a public PostgREST endpoint and takes two of these rows red with it.
insert into _checks (check_name, pass)
select 'anon cannot read enquiries' as check,
       not has_table_privilege('anon', 'public.contact_enquiries', 'select') as pass
union all
select 'signed-in cannot read enquiries',
       not has_table_privilege('authenticated', 'public.contact_enquiries', 'select')
union all
select 'anon cannot write enquiries',
       not has_table_privilege('anon', 'public.contact_enquiries', 'insert')
union all
select 'signed-in cannot write enquiries',
       not has_table_privilege('authenticated', 'public.contact_enquiries', 'insert')
union all
-- ...and the counterpart. Without these two the route cannot store an enquiry
-- at all, and every message is back to living or dying by one Resend call.
select 'the route can record an enquiry',
       has_table_privilege('service_role', 'public.contact_enquiries', 'insert')
union all
select 'the studio can read enquiries',
       has_table_privilege('service_role', 'public.contact_enquiries', 'select');

-- 0006, the other half: a sign-up is a membership, not a message.
--
-- Its own table because the rules differ. An address is unique — asking twice
-- is one fact stated twice — while an enquiry repeats freely, and folding them
-- together would leave half the columns null for half the rows and make
-- clearing out answered enquiries delete the mailing list. Note what is NOT
-- asserted anywhere, because it does not exist: a newsletter, a welcome email
-- or an unsubscribe link. This table records who asked. Nothing sends to it.
insert into public.newsletter_signups (email) values ('verify@example.test');

-- The second submission, exactly as the route makes it. No conflict target on
-- purpose, for the reason the payment-incident block gives: `on conflict
-- (email)` would raise if the primary key were ever dropped, aborting the run
-- instead of printing an `f`.
insert into public.newsletter_signups (email) values ('verify@example.test')
on conflict do nothing;

insert into _checks (check_name, pass)
select 'asking twice records one address' as check,
       (select count(*) from public.newsletter_signups
         where email = 'verify@example.test') = 1 as pass
union all
select 'a new sign-up has no notify stamp',
       not exists (select 1 from public.newsletter_signups
                    where email = 'verify@example.test'
                      and notified_at is not null);

-- An address that has been taken off must stay off. `on conflict do nothing`
-- is what guarantees it: an upsert that overwrote the row would silently
-- resurrect an unsubscribed address the next time anybody typed it into the
-- footer box — including anybody who is not its owner.
update public.newsletter_signups
   set unsubscribed_at = now()
 where email = 'verify@example.test';

insert into public.newsletter_signups (email) values ('verify@example.test')
on conflict do nothing;

-- NOT EXISTS again, and it does double duty: with the primary key intact there
-- is one row and this reads "it is still stamped", while a schema that lost the
-- key leaves a second, unstamped row behind and this goes red instead of
-- raising.
insert into _checks (check_name, pass)
select 'an unsubscribe survives a repeat sign-up' as check,
       not exists (select 1 from public.newsletter_signups
                    where email = 'verify@example.test'
                      and unsubscribed_at is null) as pass;

-- The address IS the primary key, so it has to be stored in one canonical form
-- or the key deduplicates nothing: Mia@example.com and mia@example.com would be
-- two rows, and the unsubscribe above would only cover one of them. The route
-- lower-cases in its zod transform; this CHECK is what stops that being
-- forgotten silently.
do $$
begin
  begin
    insert into public.newsletter_signups (email) values ('Verify@Example.test');
    insert into _checks (check_name, pass)
    values ('a mixed-case address is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a mixed-case address is refused', true);
  end;
end $$;

insert into _checks (check_name, pass)
select 'anon cannot read sign-ups' as check,
       not has_table_privilege('anon', 'public.newsletter_signups', 'select') as pass
union all
select 'signed-in cannot read sign-ups',
       not has_table_privilege('authenticated', 'public.newsletter_signups', 'select')
union all
-- A write-only grant would not be harmless here: a duplicate-key error is an
-- oracle for "is this address on the list", answerable by anyone holding the
-- key that ships in the browser bundle.
select 'anon cannot write sign-ups',
       not has_table_privilege('anon', 'public.newsletter_signups', 'insert')
union all
select 'signed-in cannot write sign-ups',
       not has_table_privilege('authenticated', 'public.newsletter_signups', 'insert')
union all
select 'the route can record a sign-up',
       has_table_privilege('service_role', 'public.newsletter_signups', 'insert')
union all
select 'the studio can read sign-ups',
       has_table_privilege('service_role', 'public.newsletter_signups', 'select');

-- 0007_lucky_scoop.sql: the product that is sold before anyone knows what is
-- in it.
--
-- Every other thing this shop sells is printed to order with a cost known
-- before the sale. A scoop is sold first and decided afterwards, so its stock
-- comes off and its cost is written when it is PACKED, and a tier is only
-- sellable if the pool it draws from can actually fill it. The rows below
-- assert what that makes structural: a tier cannot be activated without the
-- facts that make it honest, the pool is explicit rows rather than a filter,
-- and nothing recording what a customer received is reachable with the key that
-- ships in the browser.
--
-- Four throwaway products, four throwaway tiers and one packed scoop, all
-- inside the same rollback as everything above.

-- Probe pieces. `-a` and `-b` fill the live tier's pool; `-c` is in the draft
-- tier's pool and nowhere else, which is what lets the anon block below ask
-- about a draft pool without being able to see the draft tier at all; `-d` is
-- the spare the constraint tests are run against, so that a test which is
-- SUPPOSED to fail cannot, when it stops failing, quietly change one of the
-- counts further down.
--
-- rating 0 for the reason the earlier probes give: 'no fabricated ratings' has
-- already run, but a row that would break it if this block were ever moved is a
-- trap rather than a test.
insert into public.products
  (slug, sku, name, short_name, category, theme, art, tint, price, rating, stock_on_hand)
values
  ('verify-scoop-a', 'VERIFY-100', 'Verify scoop piece A', 'Piece A',
   'Clicker keychain', 'mono', 'clicker', 'sky', 500, 0, 4),
  ('verify-scoop-b', 'VERIFY-101', 'Verify scoop piece B', 'Piece B',
   'Clicker keychain', 'mono', 'clicker', 'sky', 500, 0, 1),
  ('verify-scoop-c', 'VERIFY-102', 'Verify scoop piece C', 'Piece C',
   'Clicker keychain', 'mono', 'clicker', 'sky', 500, 0, 0),
  ('verify-scoop-d', 'VERIFY-103', 'Verify scoop piece D', 'Piece D',
   'Clicker keychain', 'mono', 'clicker', 'sky', 500, 0, 2);

-- THE TIERS ARE BUILT WHILE THE POOL GUARD IS STILL DEFERRED, which is the
-- order the studio builds one in: the tier row exists before there is anything
-- in its pool, and it is the state at COMMIT that has to be legal. Each of the
-- three below therefore ends this section with a pool that can fill it.
--
-- The probe the "default" assertions read. Priced, weighed and fillable, so the
-- only thing keeping it inactive is the column default — which is the point: if
-- that default is ever flipped, this row goes live and the two assertions below
-- go red, rather than the file falling over somewhere unrelated.
insert into public.scoop_tiers
  (slug, name, theme, piece_count, price_cents, packed_weight_grams, packed_thickness_mm)
values
  ('verify-scoop-default', 'Verify default probe scoop', 'mixed', 1, 2500, 120, 25);

insert into public.scoop_tier_products (tier_id, product_id)
select t.id, p.id
  from public.scoop_tiers t, public.products p
 where t.slug = 'verify-scoop-default' and p.slug = 'verify-scoop-d';

-- The tier the shopfront is meant to see, once it is switched on below.
insert into public.scoop_tiers
  (slug, name, theme, piece_count, price_cents, packed_weight_grams, packed_thickness_mm)
values
  ('verify-scoop-live', 'Verify live scoop', 'clickers_keyrings', 2, 2500, 120, 25);

insert into public.scoop_tier_products (tier_id, product_id)
select t.id, p.id
  from public.scoop_tiers t, public.products p
 where t.slug = 'verify-scoop-live'
   and p.slug in ('verify-scoop-a', 'verify-scoop-b');

-- The draft: entered, pooled, and deliberately never priced. `active` is passed
-- explicitly rather than left to the default, so that the pair of assertions
-- about that default can fail on their own without taking this row with them.
insert into public.scoop_tiers
  (slug, name, theme, piece_count, active)
values
  ('verify-scoop-draft', 'Verify draft scoop', 'pet', 1, false);

insert into public.scoop_tier_products (tier_id, product_id)
select t.id, p.id
  from public.scoop_tiers t, public.products p
 where t.slug = 'verify-scoop-draft' and p.slug = 'verify-scoop-c';

-- THE POOL GUARD IS A DEFERRED CONSTRAINT TRIGGER, so this line is not
-- optional. Deferred constraints fire at COMMIT, and this file ends in a
-- rollback — without forcing the mode, every assertion about that trigger would
-- print `t` having never run it, which is exactly the shape of green result
-- this file exists to refuse. It also settles the three tiers above: from here
-- on the guard runs on the statement that breaks the rule, which is how a
-- mistake in the studio surfaces too.
set constraints all immediate;

insert into _checks (check_name, pass)
select 'new scoop tiers default to inactive' as check,
       (select column_default from information_schema.columns
         where table_schema = 'public' and table_name = 'scoop_tiers'
           and column_name = 'active') = 'false' as pass
union all
-- ...and a row added the way the table editor adds one really does arrive
-- hidden, whatever the declared default says. Two assertions for the reason
-- 0004's pair exists: the first catches a changed default, the second catches a
-- trigger or a rewrite that produces `true` anyway. A tier that goes live the
-- moment it is typed in is a half-written blurb and an unfinished pool on the
-- shopfront.
select 'a hand-added tier is not active',
       (select active from public.scoop_tiers where slug = 'verify-scoop-default') = false
union all
-- Nothing is priced in code and nothing is priced by a default. Null is "she
-- has not priced it yet" — a fact — and it is what the studio shows as "not
-- priced yet", in the language it already uses for anything unmeasured. The
-- column is omitted from the insert above on purpose, so a default appearing
-- here is what this row catches.
select 'a hand-added tier has no price',
       (select price_cents is null from public.scoop_tiers where slug = 'verify-scoop-draft');

-- Zero of forty-four products have a measured cost, so a tier price is a
-- decision she has not made yet rather than a number to reach for. NULL says
-- that; 0 says "free" and renders as $0.00 on a product page.
do $$
begin
  begin
    insert into public.scoop_tiers (slug, name, theme, piece_count, price_cents)
    values ('verify-scoop-free', 'Verify free scoop', 'mixed', 5, 0);
    insert into _checks (check_name, pass)
    values ('a tier priced at zero is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a tier priced at zero is refused', true);
  end;
end $$;

-- The theme enum is the studio's dropdown, copied. A value the dropdown cannot
-- produce did not come from the studio — the argument contact_enquiries.topic
-- makes in 0006.
do $$
begin
  begin
    insert into public.scoop_tiers (slug, name, theme, piece_count)
    values ('verify-scoop-theme', 'Verify themed scoop', 'anything-goes', 5);
    insert into _checks (check_name, pass)
    values ('an invented scoop theme is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('an invented scoop theme is refused', true);
  end;
end $$;

-- A TIER MUST NOT BE ACTIVATABLE WITHOUT THE THINGS THAT MAKE IT HONEST.
--
-- A price, because a live tier without one is a product page with no number on
-- it. A packed weight, because a scoop has no product row to take one from and
-- postage is quoted on weight alone — an active tier with no weight is a basket
-- that cannot be posted. And a pool that can fill it, which is the pair after
-- these two.
--
-- Both are built the honest way round — entered inactive, pooled, then switched
-- on — so that the only thing that can refuse the switch is the rule being
-- asserted. Inserting them active with an empty pool would be refused by the
-- POOL guard instead, and the row would print `t` while testing the wrong
-- constraint.
do $$
begin
  begin
    insert into public.scoop_tiers
      (slug, name, theme, piece_count, packed_weight_grams)
    values ('verify-scoop-unpriced', 'Verify unpriced live scoop', 'mixed', 1, 120);
    insert into public.scoop_tier_products (tier_id, product_id)
    select t.id, p.id
      from public.scoop_tiers t, public.products p
     where t.slug = 'verify-scoop-unpriced' and p.slug = 'verify-scoop-d';
    update public.scoop_tiers set active = true where slug = 'verify-scoop-unpriced';
    insert into _checks (check_name, pass)
    values ('an active tier without a price is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('an active tier without a price is refused', true);
  end;
end $$;

do $$
begin
  begin
    insert into public.scoop_tiers
      (slug, name, theme, piece_count, price_cents)
    values ('verify-scoop-unweighed', 'Verify unweighed live scoop', 'mixed', 1, 2500);
    insert into public.scoop_tier_products (tier_id, product_id)
    select t.id, p.id
      from public.scoop_tiers t, public.products p
     where t.slug = 'verify-scoop-unweighed' and p.slug = 'verify-scoop-d';
    update public.scoop_tiers set active = true where slug = 'verify-scoop-unweighed';
    insert into _checks (check_name, pass)
    values ('an active tier without a packed weight is refused', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('an active tier without a packed weight is refused', true);
  end;
end $$;

-- A tier promising five pieces out of a pool of one is ALLOWED while it is a
-- draft. Half-built is what a draft is, and a schema that refused it would stop
-- her entering a real tier before she had decided its contents.
do $$
begin
  begin
    insert into public.scoop_tiers
      (slug, name, theme, piece_count)
    values ('verify-scoop-short', 'Verify short-pool scoop', 'household', 5);
    insert into public.scoop_tier_products (tier_id, product_id)
    select t.id, p.id
      from public.scoop_tiers t, public.products p
     where t.slug = 'verify-scoop-short' and p.slug = 'verify-scoop-d';
    insert into _checks (check_name, pass)
    values ('a draft tier may hold a pool too small to fill it', true);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a draft tier may hold a pool too small to fill it', false);
  end;
end $$;

-- ...and refused the moment that tier is switched on. This is the half of "a
-- pool that can fill it" the database can enforce: pool membership is a fact
-- about rows and never changes on its own. The stock half — whether those
-- products have anything on the shelf today — changes with every sale, so it is
-- asked at read time by lib/scoop.ts and is deliberately not a constraint.
do $$
begin
  begin
    update public.scoop_tiers
       set price_cents = 2500, packed_weight_grams = 120, active = true
     where slug = 'verify-scoop-short';
    insert into _checks (check_name, pass)
    values ('a tier cannot promise more pieces than its pool holds', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a tier cannot promise more pieces than its pool holds', true);
  end;
end $$;

-- The other side of the same trigger, and the one that would make the studio
-- unusable if it were wrong: a tier that IS priced, weighed and fillable must
-- go live without argument.
do $$
begin
  begin
    update public.scoop_tiers set active = true where slug = 'verify-scoop-live';
    insert into _checks (check_name, pass)
    values ('a priced, weighed, fillable tier can be activated', true);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a priced, weighed, fillable tier can be activated', false);
  end;
end $$;

-- THE POOL IS EXPLICIT ROWS, NOT A CATEGORY FILTER. A filter is a rule about a
-- column edited somewhere else, and the day a pet bowl is filed under the
-- category a clicker scoop draws from, the bowl joins the pool in silence and
-- the tier's price and postage band are both wrong. These two rows assert the
-- structure that makes a pool a list somebody wrote: a product is in it once or
-- not at all, and it cannot leave by being deleted.
do $$
begin
  begin
    insert into public.scoop_tier_products (tier_id, product_id)
    select t.id, p.id
      from public.scoop_tiers t, public.products p
     where t.slug = 'verify-scoop-default' and p.slug = 'verify-scoop-d';
    insert into _checks (check_name, pass)
    values ('a pool cannot hold the same product twice', false);
  exception when unique_violation then
    insert into _checks (check_name, pass)
    values ('a pool cannot hold the same product twice', true);
  end;
end $$;

-- `on delete restrict`, exactly as product_filament restricts deletes of
-- colours in 0003: deleting a product a tier draws from would silently shrink
-- what that tier promises. She deactivates it instead, and the availability
-- rule already understands an inactive product.
do $$
begin
  begin
    delete from public.products where slug = 'verify-scoop-d';
    insert into _checks (check_name, pass)
    values ('a product in a pool cannot be deleted', false);
  exception when foreign_key_violation then
    insert into _checks (check_name, pass)
    values ('a product in a pool cannot be deleted', true);
  end;
end $$;

-- THE SALE. A scoop line points at a tier, not at a product — there is no
-- product row for it to point at — and that column is what marks the line as a
-- scoop for the pack panel and for the reports.
insert into public.order_items
  (order_id, product_name, art, tint, unit_price, quantity, scoop_tier_id)
select o.id, 'Verify live scoop', 'clicker', 'sky', 2500, 1, t.id
  from public.orders o, public.scoop_tiers t
 where o.stripe_session_id = 'cs_verify_mail'
   and t.slug = 'verify-scoop-live';

insert into _checks (check_name, pass)
select 'an order line can be sold as a scoop tier' as check,
       (select count(*) from public.order_items oi
          join public.scoop_tiers t on t.id = oi.scoop_tier_id
         where t.slug = 'verify-scoop-live') = 1 as pass;

-- One thing or the other, never both. A line carrying a product id AND a tier
-- id has two prices, two weights and two costs, and every reader would have to
-- guess which one it meant. Written against the default probe tier rather than
-- the live one so that a line which should not exist cannot, if it starts
-- existing, also break the count above.
do $$
begin
  begin
    insert into public.order_items
      (order_id, product_id, product_name, art, tint, unit_price, quantity, scoop_tier_id)
    select o.id, p.id, 'Verify confused line', 'clicker', 'sky', 2500, 1, t.id
      from public.orders o, public.products p, public.scoop_tiers t
     where o.stripe_session_id = 'cs_verify_mail'
       and p.slug = 'verify-scoop-a'
       and t.slug = 'verify-scoop-default';
    insert into _checks (check_name, pass)
    values ('a scoop line cannot also be a product line', false);
  exception when check_violation then
    insert into _checks (check_name, pass)
    values ('a scoop line cannot also be a product line', true);
  end;
end $$;

-- THE PACK: what actually went in, recorded after the sale, which is the only
-- moment it is knowable. One row per physical scoop — a line of quantity 2 has
-- two, numbered by pack_index — so recording is idempotent and "is this order
-- fully packed" is a count rather than a guess.
insert into public.scoop_packs (order_item_id, pack_index, piece_count)
select oi.id, 1, 2
  from public.order_items oi
  join public.scoop_tiers t on t.id = oi.scoop_tier_id
 where t.slug = 'verify-scoop-live';

-- Two pieces: one the studio has measured, one nobody has. The unmeasured one
-- is the point, and its column is OMITTED rather than set to null, so that a
-- default quietly appearing on it is caught here rather than turning every
-- uncosted scoop into a suspiciously profitable one.
insert into public.scoop_pack_items (pack_id, product_id, quantity, unit_cost_cents)
select sp.id, p.id, 1, 240
  from public.scoop_packs sp
  join public.order_items oi on oi.id = sp.order_item_id
  join public.scoop_tiers t on t.id = oi.scoop_tier_id
  cross join public.products p
 where t.slug = 'verify-scoop-live' and p.slug = 'verify-scoop-a';

insert into public.scoop_pack_items (pack_id, product_id, quantity)
select sp.id, p.id, 1
  from public.scoop_packs sp
  join public.order_items oi on oi.id = sp.order_item_id
  join public.scoop_tiers t on t.id = oi.scoop_tier_id
  cross join public.products p
 where t.slug = 'verify-scoop-live' and p.slug = 'verify-scoop-b';

insert into _checks (check_name, pass)
select 'a packed scoop is recorded against its line' as check,
       (select count(*) from public.scoop_packs sp
          join public.order_items oi on oi.id = sp.order_item_id
          join public.scoop_tiers t on t.id = oi.scoop_tier_id
         where t.slug = 'verify-scoop-live') = 1 as pass
union all
-- Stock for a scoop moves when the pack is recorded, not in the webhook, so a
-- re-saved pack panel is the thing that would decrement twice. `stock_applied`
-- is the compare-and-set claim that stops it, in the shape orders.stock_applied
-- uses — and a `true` default here would mean every pack is born already
-- claimed and no stock ever moves at all.
select 'a new pack has not moved stock',
       not exists (select 1 from public.scoop_packs where stock_applied)
union all
select 'a pack records every piece that went in',
       (select count(*) from public.scoop_pack_items) = 2
union all
-- The cost of a pack is the SUM of those rows and is deliberately stored
-- nowhere, so there is no second number to disagree with them — the trap
-- product_filament avoids in 0003 by having no "total grams" column.
select 'a pack cost is a sum, not a stored column',
       not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'scoop_packs'
                      and column_name in ('cost_cents', 'total_cost_cents'))
union all
-- A 13c "cost" that is packaging alone is a 97% margin on a piece nobody has
-- timed. Null is the honest answer, and packCost() in lib/scoop.ts turns one
-- null piece into an unknown pack rather than a cheap one.
select 'an unmeasured piece records a null cost',
       (select count(*) from public.scoop_pack_items where unit_cost_cents is null) = 1;

-- The same scoop cannot be recorded twice. Without this a double-clicked pack
-- panel is two packs, two sets of decrements and a doubled cost on the line.
-- Run against a second line so that a duplicate which does get through cannot
-- also break the count above.
insert into public.order_items
  (order_id, product_name, art, tint, unit_price, quantity, scoop_tier_id)
select o.id, 'Verify second scoop', 'clicker', 'sky', 2500, 1, t.id
  from public.orders o, public.scoop_tiers t
 where o.stripe_session_id = 'cs_verify_mail'
   and t.slug = 'verify-scoop-default';

insert into public.scoop_packs (order_item_id, pack_index, piece_count)
select oi.id, 1, 1 from public.order_items oi
 where oi.product_name = 'Verify second scoop';

do $$
begin
  begin
    insert into public.scoop_packs (order_item_id, pack_index, piece_count)
    select oi.id, 1, 1 from public.order_items oi
     where oi.product_name = 'Verify second scoop';
    insert into _checks (check_name, pass)
    values ('the same scoop cannot be packed twice', false);
  exception when unique_violation then
    insert into _checks (check_name, pass)
    values ('the same scoop cannot be packed twice', true);
  end;
end $$;

-- WHAT THE SHOPFRONT ACTUALLY SEES, asked the way the shopfront asks it.
--
-- The grant assertions further down prove anon HAS select on these two tables.
-- They say nothing about WHICH rows come back, and that is the whole question:
-- an inactive tier is next month's range and an unpriced one has no number to
-- render. So this block switches to the `anon` role and counts, which is the
-- only way to make the RLS policies themselves testable — the postgres role
-- bypasses RLS and would report every draft as public without noticing.
--
-- Written into its own temp table rather than straight into _checks, because
-- anon has no rights on the assertion table's sequence. The role is reset on
-- the next line and everything is inside the same rollback.
create temp table _anon_scoops (label text primary key, n integer);
grant insert on _anon_scoops to anon;

set local role anon;

-- Wrapped so that a MISSING grant reddens rows instead of stopping the run.
-- Without the handler, revoking anon's select on either table raises
-- insufficient_privilege here and the file aborts before printing anything —
-- and a run that stops is not a run that failed. Caught, the counts stay null
-- and the four assertions below go red alongside the grant rows.
do $$
begin
  insert into _anon_scoops (label, n)
  select 'live tier',
         (select count(*) from public.scoop_tiers where slug = 'verify-scoop-live')
  union all
  select 'draft tier',
         (select count(*) from public.scoop_tiers where slug = 'verify-scoop-draft')
  union all
-- Joined through `products` rather than through `scoop_tiers`, on purpose: anon
-- cannot see the draft tier at all, so asking for its pool by the tier's slug
-- would be answered by the TIER policy and would prove nothing about the pool
-- policy. `verify-scoop-c` is in the draft tier's pool and no other.
  select 'live pool',
         (select count(*) from public.scoop_tier_products sp
            join public.products p on p.id = sp.product_id
           where p.slug in ('verify-scoop-a', 'verify-scoop-b'))
  union all
  select 'draft pool',
         (select count(*) from public.scoop_tier_products sp
            join public.products p on p.id = sp.product_id
           where p.slug = 'verify-scoop-c');
exception when insufficient_privilege then
  null;
end $$;

reset role;

-- coalesce, and it is not decoration. scripts/verify-sql.sh matches assertion
-- rows on `label|t` or `label|f`, so a NULL `pass` is not a red row — it is a
-- row that DISAPPEARS from the table, which reads as a pass to anyone who does
-- not also count. Every one of these four reads a count that is genuinely
-- absent when the anon grant is missing, so each is floored to a value that
-- cannot match and goes red instead of going quiet.
insert into _checks (check_name, pass)
select 'the shop sees a sellable tier' as check,
       coalesce((select n from _anon_scoops where label = 'live tier'), -1) = 1 as pass
union all
select 'the shop cannot see a draft tier',
       coalesce((select n from _anon_scoops where label = 'draft tier'), -1) = 0
union all
-- The pool is public because a visible pool is what makes "five pieces drawn
-- from these twelve" a true description rather than an unknown.
select 'the shop sees a sellable tier''s pool',
       coalesce((select n from _anon_scoops where label = 'live pool'), -1) = 2
union all
select 'the shop cannot see a draft tier''s pool',
       coalesce((select n from _anon_scoops where label = 'draft pool'), -1) = 0;

-- Who may reach it, at the grant level. The shopfront reads tiers and pools
-- with the anon key that ships in the browser bundle, so those two are readable
-- — and nothing more. There is no anon INSERT anywhere in 0007_lucky_scoop.sql
-- and there must never be: such a grant is a public PostgREST endpoint
-- accepting arbitrary rows, which here would mean anyone inventing a $1 tier or
-- adding a lamp to a clicker scoop's pool.
insert into _checks (check_name, pass)
select 'the shop can read scoop tiers' as check,
       has_table_privilege('anon', 'public.scoop_tiers', 'select') as pass
union all
select 'the shop can read scoop pools',
       has_table_privilege('anon', 'public.scoop_tier_products', 'select')
union all
select 'anon cannot write scoop tiers',
       not has_table_privilege('anon', 'public.scoop_tiers', 'insert')
union all
select 'signed-in cannot write scoop tiers',
       not has_table_privilege('authenticated', 'public.scoop_tiers', 'update')
union all
select 'anon cannot write scoop pools',
       not has_table_privilege('anon', 'public.scoop_tier_products', 'insert')
union all
select 'signed-in cannot write scoop pools',
       not has_table_privilege('authenticated', 'public.scoop_tier_products', 'insert')
union all
-- ...and the studio's own side, without which nothing can be created at all.
select 'the studio can edit scoop tiers',
       has_table_privilege('service_role', 'public.scoop_tiers', 'update')
union all
select 'the studio can build a pool',
       has_table_privilege('service_role', 'public.scoop_tier_products', 'insert');

-- A pack records what a named customer's order contained and what the studio
-- paid for it. Neither is anybody's business but hers, so both tables get the
-- treatment 0003, 0005 and 0006 document: RLS on with no policy at all, plus an
-- explicit revoke, because Supabase grants every new table in `public` to anon
-- and authenticated as it is created and the revoke is what closes it.
insert into _checks (check_name, pass)
select 'anon cannot read scoop packs' as check,
       not has_table_privilege('anon', 'public.scoop_packs', 'select') as pass
union all
select 'signed-in cannot read scoop packs',
       not has_table_privilege('authenticated', 'public.scoop_packs', 'select')
union all
select 'anon cannot read what a scoop contained',
       not has_table_privilege('anon', 'public.scoop_pack_items', 'select')
union all
select 'signed-in cannot read what a scoop contained',
       not has_table_privilege('authenticated', 'public.scoop_pack_items', 'select')
union all
select 'anon cannot write scoop packs',
       not has_table_privilege('anon', 'public.scoop_packs', 'insert')
union all
select 'the studio can record a pack',
       has_table_privilege('service_role', 'public.scoop_packs', 'insert')
union all
select 'the studio can record what went in a pack',
       has_table_privilege('service_role', 'public.scoop_pack_items', 'insert')
union all
-- The pool guard is SECURITY DEFINER, so it runs with the owner's rights. A
-- trigger function the browser key may EXECUTE is a function the browser key
-- can be made to run, which is why 0001 revokes execute on every definer
-- function it writes and why this one is revoked too.
select 'nobody can call the pool guard directly',
       not has_function_privilege('anon', 'public.scoop_tier_pool_is_big_enough()', 'execute');

-- Search is bounded: a lone wildcard must not match the whole catalogue.
insert into _checks (check_name, pass)
select 'search rejects a bare wildcard' as check,
       (select count(*) from public.search_products('%')) = 0 as pass
union all
select 'search ignores empty input',
       (select count(*) from public.search_products('   ')) = 0;

-- Every assertion, in one result set. `pass` must be `t` on all 126 rows.
select check_name as check, pass from _checks order by ord;

rollback;
