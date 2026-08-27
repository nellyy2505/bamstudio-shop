-- Schema smoke test.
--
-- Run this in the Supabase SQL editor after applying every file in
-- supabase/migrations/ in order and then seed.sql. It returns ONE table of 86
-- rows and every `pass` must be `t`. These are the guarantees that only fail
-- in production — a missing grant here means paid orders are never recorded,
-- and you would first hear about it from a customer.
--
-- Count the rows as well as the ticks. This file has grown with the schema —
-- 24 assertions, then 29 with shipping, 50 with the staff area, 52 with the
-- letter_eligible default, 65 with 0005 (the confirmation-email stamp, the
-- observable stock clamp and the refund register), 86 with 0006 (the enquiry
-- and sign-up tables) — so a shorter table than 86 means an older copy of this
-- file, and an older copy is a green result that never looked at part of the
-- schema. That reads like a pass and is not one.
--
-- A migration that is not applied does not shorten the table, it stops the run:
-- the first assertion that names a missing object raises instead of returning
-- `f`. `scripts/verify-sql.sh` applies every file in supabase/migrations/
-- rather than a hand-written list, because the list fell behind twice.
--
-- It writes six throwaway orders (one with an order item), two throwaway
-- products, one throwaway payment incident, one throwaway enquiry and one
-- throwaway newsletter sign-up inside a transaction it rolls back, so it is
-- safe to run against a live database, though quiet hours are still kinder.

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
-- added contact_enquiries and newsletter_signups. A new table that forgets to
-- enable RLS lands in `public` readable by the anon key, so this count is
-- deliberately exact rather than `>=`.
select 'row-level security everywhere',    count(*) = 19 from pg_tables
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

-- Search is bounded: a lone wildcard must not match the whole catalogue.
insert into _checks (check_name, pass)
select 'search rejects a bare wildcard' as check,
       (select count(*) from public.search_products('%')) = 0 as pass
union all
select 'search ignores empty input',
       (select count(*) from public.search_products('   ')) = 0;

-- Every assertion, in one result set. `pass` must be `t` on all 86 rows.
select check_name as check, pass from _checks order by ord;

rollback;
