-- Returns, and how a sale outside the website was paid for.
--
-- Apply after 0012_cost_model.sql.
--
-- WHY A NEW FILE, as always: 0001 to 0012 are applied, and an applied migration
-- is never edited. Every statement below is guarded and the file is safe to
-- re-run.
--
-- THE DEFECT THIS CLOSES. There is no concept of a return anywhere in the shop.
-- A customer sends something back, the money goes out through the Stripe
-- dashboard, and the database never learns of it: the order still reads
-- delivered, the piece is not back on the shelf, the reason nobody bought it is
-- not written down anywhere it can be counted, and every report still counts the
-- sale. The refund is the one part that already works, and it works somewhere
-- else entirely.

/* ------------------------------------------ 1. how a manual sale was paid */

-- A sale at a market stall is recorded through `recordSale`, which writes a real
-- order row so that revenue and stock stay true. What it has never recorded is
-- how the money arrived. Nelly's answer, 8 September: a card sale has a Stripe
-- reference, and cash is stored as cash.
--
-- Nullable, and deliberately NOT backfilled. A website order is a card payment
-- by construction, since it has a `stripe_session_id`, and writing that fact
-- into a second column would create a copy that can disagree with the first.
-- Null on a website order therefore means "look at the Stripe columns"; null on
-- a manual order means it predates this migration and nobody recorded it.
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('card', 'cash', 'bank_transfer', 'other')),
  -- The card reference for a sale taken in person: a Stripe payment intent from
  -- Tap to Pay, or a terminal receipt number. Kept apart from
  -- `stripe_payment_intent`, which is written by the webhook and should mean a
  -- payment intent this shop's own checkout created, not a number typed in by
  -- hand that merely looks like one.
  add column if not exists payment_reference text;

comment on column public.orders.payment_method is
  'How a sale made outside the website was paid for. NULL on a website order, '
  'which is a card payment by construction (it has a stripe_session_id).';

/* -------------------------------------------------------- 2. the returns */

-- ONE RETURN, ONE ROW, AND THE LINES UNDER IT.
--
-- Not a flag on the order: a customer can send one of three pieces back, and
-- send another one back a fortnight later, and both facts have to survive. Not a
-- flag on the order line either, because a return has a reason, a date and a
-- refund of its own, and hanging those off a line makes the second return
-- overwrite the first.
create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,

  -- A short list, because the point of recording a reason is counting it. Free
  -- text cannot be counted: "broke", "Broken", "arrived broken" and "snapped"
  -- are one fact spelled four ways, and a report over them says nothing. The
  -- note below is where the words go.
  reason text not null check (reason in (
    'faulty',
    'damaged_in_post',
    'wrong_item_sent',
    'not_as_described',
    'changed_mind',
    'other'
  )),
  note text,

  -- What actually went back to the customer, in cents. Recorded rather than
  -- derived from the lines: a refund is a decision, not arithmetic. A goodwill
  -- refund can exceed the lines, a restocking deduction can fall short of them,
  -- and postage may or may not be included. Zero is a real answer, meaning a
  -- piece came back and no money went out.
  --
  -- THE MONEY STILL MOVES IN STRIPE. This column records what was refunded, it
  -- does not cause a refund. Anything else would be a second system issuing
  -- payments, and the studio has one.
  refund_amount_cents integer not null default 0 check (refund_amount_cents >= 0),

  -- Who recorded it. `set null` rather than cascade: a staff member leaving must
  -- not delete the shop's record of a return.
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_returns_order_idx on public.order_returns (order_id);
create index if not exists order_returns_reason_idx on public.order_returns (reason);
create index if not exists order_returns_created_idx on public.order_returns (created_at desc);

create table if not exists public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,

  -- `restrict`, not `set null` or `cascade`. A return line that lost its order
  -- line would be a quantity of nothing, and deleting an order line that has
  -- been returned should be refused rather than silently reshaping history.
  order_item_id uuid not null references public.order_items(id) on delete restrict,

  quantity integer not null check (quantity > 0),

  -- WHETHER THIS PIECE WENT BACK ON THE SHELF, decided per line by the person
  -- recording the return. Nelly's answer to "does a return restock", 8
  -- September: it depends, so let the studio say.
  --
  -- It has to be per line and not per return, because one parcel can come back
  -- holding a keychain that is perfectly fine and a charm that snapped, and a
  -- single answer for both would either throw away a good piece or put a broken
  -- one back on the shelf for the next customer.
  --
  -- NOT NULL and with no default on purpose: there is no sensible guess. A
  -- default of true quietly resells faulty stock, and a default of false quietly
  -- writes off good stock. The screen asks.
  restocked boolean not null,

  created_at timestamptz not null default now()
);

create index if not exists order_return_items_return_idx
  on public.order_return_items (return_id);
create index if not exists order_return_items_item_idx
  on public.order_return_items (order_item_id);

-- Locked down the same way every other table that decides money or authority is
-- (0003_admin.sql): RLS on with no policy at all, so the anon and authenticated
-- keys can read nothing, and the studio reaches it with the service-role key
-- after `requireStaff()` has answered. A return names what a customer sent back
-- and why, which is not a customer's business to read about anyone else.
alter table public.order_returns enable row level security;
alter table public.order_return_items enable row level security;
revoke all on public.order_returns from anon, authenticated;
revoke all on public.order_return_items from anon, authenticated;
grant all on public.order_returns to service_role;
grant all on public.order_return_items to service_role;

/* ------------------------------------------------- 3. putting stock back */

-- The mirror of `decrement_stock` in 0005, and it takes the same lock in the
-- same order for the same reason: read-modify-write in the application layer
-- loses a concurrent webhook decrement between the read and the write.
--
-- WHAT IT DELIBERATELY DOES NOT TOUCH: `oversold_units`. That column is a
-- running total of demand that ran ahead of the shelf at the moment of a sale,
-- and a piece coming back a fortnight later does not make the shelf less short
-- on the day it sold. 0005 says nothing decrements it and that it is cleared by
-- hand from the inventory screen; a return quietly eating into it would erase
-- the print-this-first signal the column exists to give.
create or replace function public.restock_returned_unit(
  p_product_id uuid,
  p_quantity integer
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  -- A null or negative quantity moves nothing rather than removing stock.
  wanted  integer := greatest(0, coalesce(p_quantity, 0));
  on_hand integer;
begin
  select greatest(0, coalesce(stock_on_hand, 0))
    into on_hand
    from public.products
   where id = p_product_id
     for update;

  -- Null, not zero: the product row is gone (a deleted product still named on
  -- an old order line), which is different from "put nothing back".
  if not found then
    return null;
  end if;

  update public.products
     set stock_on_hand = on_hand + wanted
   where id = p_product_id;

  return on_hand + wanted;
end;
$$;

revoke all on function public.restock_returned_unit(uuid, integer) from public;
revoke all on function public.restock_returned_unit(uuid, integer) from anon, authenticated;
grant execute on function public.restock_returned_unit(uuid, integer) to service_role;

comment on function public.restock_returned_unit(uuid, integer) is
  'Adds returned pieces back to stock_on_hand under a row lock. Returns the new '
  'count, or NULL when the product no longer exists. Never touches '
  'oversold_units: that is a record of what the shelf was short at the time of '
  'a sale, not a live balance.';
