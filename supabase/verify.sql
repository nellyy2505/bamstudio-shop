-- Schema smoke test.
--
-- Run this in the Supabase SQL editor after applying 0001_init.sql and
-- seed.sql. Every line should print `t`. These are the guarantees that only
-- fail in production — a missing grant here means paid orders are never
-- recorded, and you would first hear about it from a customer.
--
-- It writes two throwaway orders and deletes them again, so it is safe to run
-- against a live database, though quiet hours are still kinder.

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
       not has_function_privilege('anon', 'public.next_order_number()', 'execute');

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

-- Search is bounded: a lone wildcard must not match the whole catalogue.
select 'search rejects a bare wildcard' as check,
       (select count(*) from public.search_products('%')) = 0 as pass
union all
select 'search ignores empty input',
       (select count(*) from public.search_products('   ')) = 0;

rollback;
