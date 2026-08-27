-- 0005_sale_integrity.sql — the three things a paid order can lose silently:
-- its confirmation email, its stock arithmetic, and a refund it is owed.
--
-- Apply after 0004_letter_eligible_default.sql.
--
-- WHY A NEW FILE. 0001–0004 are applied on the live Supabase project, and an
-- applied migration is never edited: the repo and the database would then
-- disagree with no way to tell which is right. Same rule 0004 states, same
-- shape — every statement below is guarded and the file is safe to re-run.
--
-- Three defects are closed here. Each section says which, and what it cost.

/* ------------------------------------------- 1. the confirmation email */

-- THE DEFECT THIS CLOSES.
--
-- `queueOrderConfirmation` got exactly one attempt per order and nothing
-- recorded whether it succeeded. It was called from `assignOrderNumber`, which
-- returns early once an order has a number, so every Stripe redelivery — the
-- one mechanism the shop has for retrying anything — skipped the mail. A
-- machine restart, a Resend 429, or `after()` being cut short left the customer
-- charged, the order `confirmed`, and no email ever sent. /track needs the
-- order number that email carries, so the customer is left with a charge and
-- no way to look up what they bought.
--
-- One nullable timestamp is the whole fix. Null means "no confirmation email
-- has gone out for this order" — a fact, not a status — and the webhook now
-- re-queues the mail on any delivery that finds an order numbered and this
-- column still null. It is stamped only after the provider has accepted the
-- message, so a failed send stays retryable by construction.
--
-- WHAT "SENT" MEANS ON A SHOP WITH NO EMAIL CONFIGURED. Nothing different, and
-- deliberately so. `isEmailConfigured()` in lib/email.ts is the single source
-- of truth for whether this process can send at all, and it is a property of
-- the deployment, not of an order — mirroring it into a column here would
-- create a second source that can disagree with the first the moment an
-- environment variable changes. So an unconfigured shop simply leaves every
-- order null (true: nothing was sent), and the reader — the webhook's queue
-- gate and the studio overview — asks `isEmailConfigured()` at the moment it
-- reads. On a shop that cannot send, silence is expected and nothing is
-- reported as overdue; on a shop that can, a null here is a real omission.
alter table public.orders
  add column if not exists confirmation_email_sent_at timestamptz;

comment on column public.orders.confirmation_email_sent_at is
  'When the customer''s order-confirmation email was accepted by the mail '
  'provider. NULL means no confirmation has gone out — either it has not been '
  'attempted yet, it failed, or the shop has no mail provider configured at '
  'all. The webhook re-queues the mail for any numbered order whose stamp is '
  'still null, so a lost send is recovered by the next Stripe delivery instead '
  'of being lost with the process that dropped it.';

/* ---------------------------------------------- 2. stock, made observable */

-- THE DEFECT THIS CLOSES.
--
-- `decrement_stock` was `set stock_on_hand = greatest(0, stock_on_hand - qty)`
-- returning void: selling the last one twice succeeded twice and said nothing.
-- The clamp is right — a negative count is not a fact about a shelf — but a
-- clamp that reports nothing turns an oversell into a stock count that is
-- quietly one short forever. `recordSale` was worse: it read `stock_on_hand`
-- in the app, subtracted in JavaScript and wrote the result back, so a webhook
-- decrement landing between the read and the write was silently discarded.
--
-- THE DECISION: THE SHOP KEEPS SELLING. Everything here is printed to order
-- and `stock_on_hand` is a buffer of pieces already printed, not an allocation
-- of the only ones that exist. Refusing a sale because the buffer is empty
-- would turn a two-day print into a lost order for an item the studio prints
-- on demand anyway. It would also be a check that cannot be made to work
-- honestly: stock only moves in the webhook, *after* payment, so a check at
-- checkout guards a window it does not own — two shoppers can both pass it,
-- and the loser would be refused after being charged, which is worse than
-- printing one more.
--
-- So overselling stays allowed, and the cost of allowing it is paid by making
-- it visible: `oversold_units` accumulates every unit sold that the buffer did
-- not have, and the function returns that shortfall to its caller so the
-- webhook can log the order it happened on. It is a print-this-first queue
-- signal, not an error. Nothing decrements it — it is a running total of
-- demand that ran ahead of the shelf, cleared by hand from the inventory
-- screen the same way a count is.
alter table public.products
  add column if not exists oversold_units integer not null default 0;

-- Named rather than inline: `add column if not exists` skips the whole clause
-- on a database that already has the column, so an inline check would never
-- arrive there. Same shape as products_weight_grams_check in 0002.
alter table public.products
  drop constraint if exists products_oversold_units_check;
alter table public.products
  add constraint products_oversold_units_check check (oversold_units >= 0);

comment on column public.products.oversold_units is
  'Running total of units sold that the ready-to-ship buffer did not have. '
  'The shop prints to order, so an oversell is allowed and is not an error — '
  'it is a signal to print this piece first. Never decremented automatically; '
  'the studio clears it when the backlog has been printed.';

-- `create or replace` cannot change a function's return type, so the old
-- void version is dropped first. The drop is scoped to the exact signature so
-- it cannot take anything else with it, and the grant is re-issued below —
-- a dropped function takes its grants with it, and without `execute` the
-- webhook cannot move stock at all. verify.sql asserts that grant.
drop function if exists public.decrement_stock(uuid, integer);

-- Atomic, and it answers.
--
-- `select ... for update` takes the row lock before the arithmetic, so a
-- concurrent call — another webhook delivery, or a sale typed in at a market
-- while a website order is confirming — waits rather than reading a value that
-- is about to be stale. The read-modify-write that used to live in
-- `recordSale` cannot exist here: the read and the write are inside one
-- transaction holding one lock.
--
-- Returns the SHORTFALL: how many units were sold that the buffer did not
-- have. 0 is the ordinary answer. NULL means no such product — nulls stay
-- null, and a caller that gets one has asked about something that is not
-- there, which is different from a sale that took nothing.
create or replace function public.decrement_stock(
  p_product_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  -- A null or negative quantity moves nothing rather than adding stock.
  wanted   integer := greatest(0, coalesce(p_quantity, 0));
  on_hand  integer;
  short    integer;
begin
  select greatest(0, coalesce(stock_on_hand, 0))
    into on_hand
    from public.products
   where id = p_product_id
     for update;

  if not found then
    return null;
  end if;

  short := greatest(0, wanted - on_hand);

  update public.products
     set stock_on_hand  = on_hand - (wanted - short),
         oversold_units = oversold_units + short
   where id = p_product_id;

  return short;
end;
$$;

revoke all on function public.decrement_stock(uuid, integer) from public, anon, authenticated;
-- Explicit, not inherited: without this the webhook cannot move stock at all.
grant execute on function public.decrement_stock(uuid, integer) to service_role;

/* ------------------------------------- 3. a payment that owes a refund */

-- THE DEFECT THIS CLOSES.
--
-- When a cancelled order is paid for anyway — the customer's card clears after
-- the shop has already pulled the order — the webhook correctly refuses to
-- number it, move its stock or email its customer. Its entire response was a
-- `console.error` saying "refund this one by hand" and a 200 to Stripe. The
-- customer is charged, receives nothing, and the only record is a log line on
-- a platform nobody reads. Money the shop owes back was invisible.
--
-- A row, not a column on `orders`: the incident is a fact about a *payment*,
-- it needs its own resolution state, and there is no guarantee an order row
-- will still exist to hang it on. `stripe_session_id` is unique, which is what
-- makes recording idempotent — Stripe redelivers, and an `on conflict do
-- nothing` insert must record one incident however many deliveries arrive.
--
-- The refund itself stays manual and always will: refunding is a decision with
-- a customer at the other end of it, not something a webhook should do on its
-- own. What this table changes is that the decision is now in front of her, on
-- the studio overview, instead of in a log.
create table if not exists public.payment_incidents (
  id                    uuid primary key default gen_random_uuid(),
  -- Null-able and `on delete set null`: the money was still taken even if the
  -- order row is later removed, and losing the order must not lose the debt.
  order_id              uuid references public.orders(id) on delete set null,
  -- The idempotency key. One incident per Stripe session, however many times
  -- Stripe delivers the event.
  stripe_session_id     text not null unique,
  stripe_payment_intent text,
  -- What the customer was actually charged, in cents, like every other amount
  -- in this schema. It is what has to be refunded.
  amount_cents          integer not null check (amount_cents >= 0),
  kind                  text not null default 'paid_while_cancelled'
                          check (kind in ('paid_while_cancelled')),
  -- The order's status at the moment the payment landed, so the record still
  -- makes sense after somebody edits the order.
  order_status          text,
  detail                text,
  noticed_at            timestamptz not null default now(),
  -- Set by hand from the studio overview once the refund has been issued.
  -- Null is the open state, and open incidents are what the overview shows.
  resolved_at           timestamptz,
  resolved_by           uuid references auth.users(id) on delete set null,
  resolution_note       text
);

create index if not exists payment_incidents_open_idx
  on public.payment_incidents (noticed_at desc)
  where resolved_at is null;

comment on table public.payment_incidents is
  'Payments that took money the shop cannot honour — today, a payment that '
  'cleared for an order somebody had already cancelled. Recorded by the Stripe '
  'webhook and shown on the studio overview until a person marks it refunded. '
  'The refund is issued by hand in Stripe; this table exists so the owner finds '
  'out at all.';

-- RLS on with NO policy, plus an explicit revoke — the pattern 0002 and 0003
-- document. RLS-with-no-policy denies every row to every non-bypassing role,
-- and the revoke is what closes the hole on hosted Supabase, where every new
-- table in `public` is granted to anon and authenticated as it is created.
-- This table holds a customer's payment intent and what they were charged; it
-- has no business being readable with the key that ships in the browser.
alter table public.payment_incidents enable row level security;
revoke all on table public.payment_incidents from public;
revoke all on table public.payment_incidents from anon, authenticated;
grant select, insert, update, delete on table public.payment_incidents to service_role;
