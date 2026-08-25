-- Schema smoke test.
--
-- Run this in the Supabase SQL editor after applying 0001_init.sql and
-- seed.sql. Every line should print `t`. These are the guarantees that only
-- fail in production — a missing grant here means paid orders are never
-- recorded, and you would first hear about it from a customer.
--
-- It writes four throwaway orders (and one order item) inside a transaction it
-- rolls back, so it is safe to run against a live database, though quiet hours
-- are still kinder.

begin;

-- The catalogue loaded, and carries no invented review history.
select 'products loaded'            as check, count(*) > 0                      as pass from public.products
union all
select 'no fabricated ratings',            count(*) filter (where rating > 0) = 0        from public.products
union all
select 'personalised products have a mode', count(*) filter (
         where is_personalised and personalisation_mode is null) = 0            from public.products
union all
select 'row-level security everywhere',    count(*) = 8 from pg_tables
         where schemaname = 'public' and rowsecurity = true
union all
-- A client must never be able to write a review: the old policy let any
-- signed-in account post one on any product, flagged as a verified purchase.
select 'no client review inserts',         count(*) = 0 from pg_policies
         where schemaname = 'public' and tablename = 'reviews' and cmd = 'INSERT';

-- The webhook cannot confirm a paid order without these two grants. This is
-- the check worth caring about: without it the failure is silent until a
-- customer asks where their order went.
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
       has_function_privilege('service_role', 'public.order_confirmation_summary(text)', 'execute');

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

select 'first claim takes the row' as check, count(*) = 1 as pass
  from public.orders
 where stripe_session_id = 'cs_verify_claim' and stock_applied = true;

update public.orders set stock_applied = true
 where stripe_session_id = 'cs_verify_claim' and stock_applied = false;

select 'second claim moves nothing' as check, count(*) = 0 as pass
  from public.orders
 where stripe_session_id = 'cs_verify_claim' and stock_applied = false;

-- An unpaid checkout is not an order, and an order is only findable by
-- someone who knows both its number and the email it was placed with.
insert into public.orders
  (order_number, email, status, subtotal, shipping, total, shipping_address, stripe_session_id)
values
  ('BS-VERIFY-0001', 'verify@example.test', 'pending', 900, 0, 900, '{}'::jsonb, 'cs_verify_pending');

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

-- Search is bounded: a lone wildcard must not match the whole catalogue.
select 'search rejects a bare wildcard' as check,
       (select count(*) from public.search_products('%')) = 0 as pass
union all
select 'search ignores empty input',
       (select count(*) from public.search_products('   ')) = 0;

rollback;
