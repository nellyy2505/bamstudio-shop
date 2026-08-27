-- 0006_enquiries.sql — the customer's message is a row before it is an email.
--
-- Apply after 0005_sale_integrity.sql.
--
-- WHY A NEW FILE. 0001–0005 are applied on the live Supabase project, and an
-- applied migration is never edited: the repo and the database would then
-- disagree with no way to tell which is right. Same rule 0004 and 0005 state,
-- same shape — every statement below is guarded and the file is safe to re-run.
--
-- THE DEFECT THIS CLOSES.
--
-- `/api/contact` handed the enquiry to Resend and stored it nowhere. The route
-- said so in its own comment — "Nothing is persisted — there is no enquiries
-- table — so the email IS the delivery" — and on a failed send it answered
-- `{ ok: true, delivered: false }`. That is an honest answer to a customer and
-- a total loss to the shop: the words the customer typed existed only in the
-- HTTP request, and once the send failed there was nothing left anywhere. Three
-- ordinary configurations lose the message outright:
--
--   * `RESEND_API_KEY` or `EMAIL_FROM` unset — nothing is even attempted, and
--     these are secrets a shop can deploy without;
--   * `NEXT_PUBLIC_SUPPORT_EMAIL` unset — there is no address to send to, so
--     the same;
--   * Resend answers 4xx/5xx, or does not answer inside the 8-second timeout.
--
-- It matters more here than it would on most shops. This one states in several
-- places, the legal pages included, that it sends no order emails at all, so
-- the contact form is one of a very small number of channels a customer has. A
-- pointer, not legal advice: under the Australian Consumer Law a message
-- reporting faulty goods starts a consumer guarantee claim, and that is
-- precisely the message that must not vanish. Whether any given enquiry does so
-- is a question for a lawyer; the engineering conclusion stands on its own —
-- a channel the shop advertises must not depend on a third-party API call
-- succeeding on the first attempt.
--
-- So: the row is written FIRST and the email becomes a notification about a row
-- that already exists, rather than the delivery itself. A failed send then costs
-- the owner a prompt, not the customer their message.
--
-- TWO TABLES, NOT ONE. An enquiry and a newsletter sign-up arrive through the
-- same shaped route, and that is the only thing they have in common:
--
--   * An enquiry is a piece of WORK. It has a name, a topic, free text and an
--     order number, it is answered once, and then it is done — so it carries
--     handled_at/handled_by and every message is its own row. Writing twice is
--     two enquiries, and must be: a customer who follows up has said a second
--     thing.
--   * A sign-up is a MEMBERSHIP. It is one address, held for as long as the
--     shop might mail it, and asking twice is the same fact stated twice — so
--     the address is the primary key and a repeat submission is idempotent.
--     Its lifecycle end is an unsubscribe, not a reply.
--
-- Folded into one table, half the columns are null for half the rows, the
-- unique-address rule cannot be expressed (it is wrong for enquiries and
-- required for sign-ups), and clearing out answered enquiries would delete the
-- mailing list. They are different things and get different tables.

/* -------------------------------------------------- contact form enquiries */

create table if not exists public.contact_enquiries (
  id            uuid primary key default gen_random_uuid(),

  -- Bounds are duplicated from the zod schema in app/api/contact/route.ts on
  -- purpose, and the two must move together. This is the backstop: the route
  -- validates, but the table is what makes an unbounded message impossible no
  -- matter which code path writes it. `message` is the only free-text field a
  -- stranger controls, and 2000 characters is what the textarea's maxLength
  -- and the schema already allow — see the abuse note under the grants below.
  name          text not null check (char_length(name) between 1 and 100),
  email         text not null check (char_length(email) between 3 and 200),
  -- Matches the route's enum exactly. A dropdown, not free text — which is
  -- also why it is the only field the route is allowed to log.
  topic         text not null
                  check (topic in ('order', 'returns', 'custom', 'wholesale', 'other')),
  -- Optional: the form says so, and an enquiry about a custom design has no
  -- order to quote.
  order_number  text check (order_number is null or char_length(order_number) <= 40),
  message       text not null check (char_length(message) between 10 and 2000),

  received_at   timestamptz not null default now(),

  -- When the studio-notification email was accepted by the mail provider, in
  -- the same shape and for the same reason as orders.confirmation_email_sent_at
  -- in 0005. NULL is a fact, not a status: no notification has gone out for
  -- this enquiry. It does NOT mean the enquiry was lost — the row is the
  -- delivery now — it means the only way the owner finds this one is by
  -- looking. A shop with no mail provider configured leaves every row null,
  -- which is true, and the reader asks isEmailConfigured() at read time rather
  -- than this schema mirroring a deployment setting it cannot see.
  notified_at   timestamptz,

  -- Set by hand from the studio once the enquiry has been answered. Null is
  -- the open state, and open enquiries are what an inbox screen shows.
  handled_at    timestamptz,
  handled_by    uuid references auth.users(id) on delete set null,
  handling_note text check (handling_note is null or char_length(handling_note) <= 2000)
);

-- The only query an inbox screen runs: the unanswered ones, newest first.
-- Partial, like payment_incidents_open_idx in 0005 — the answered rows are
-- history and are not what anyone opens the screen to see.
create index if not exists contact_enquiries_open_idx
  on public.contact_enquiries (received_at desc)
  where handled_at is null;

comment on table public.contact_enquiries is
  'Messages sent through /contact. Written before the studio-notification '
  'email is attempted, so a mail provider that is unconfigured, rate-limited '
  'or down costs the owner a prompt rather than costing the customer their '
  'message. Holds a name, an email address and free text a stranger typed: '
  'service_role only, never readable with the anon key that ships in the '
  'browser bundle.';

/* ------------------------------------------------------ newsletter sign-ups */

create table if not exists public.newsletter_signups (
  -- The address IS the identity, so it is the primary key: asking twice is one
  -- fact stated twice, and the route can insert unconditionally with
  -- `on conflict do nothing` instead of reading first and racing itself.
  --
  -- Stored lower-cased, and the check enforces it rather than trusting the
  -- caller. Without that, `Mia@example.com` and `mia@example.com` are two rows,
  -- the primary key stops deduplicating anything, and a person who
  -- unsubscribes stays on the list under the other spelling. Domains are
  -- case-insensitive by specification and no mail provider in practice treats
  -- the local part otherwise.
  email          text primary key
                   check (char_length(email) between 3 and 200
                          and email = lower(email)),

  -- When they asked, and from where. This row is the whole of the shop's
  -- evidence that the address was volunteered — worth having before a first
  -- mailout is ever sent, not after.
  requested_at   timestamptz not null default now(),
  source         text not null default 'footer'
                   check (char_length(source) between 1 and 40),

  -- As above: the studio-notification email, not a message to the subscriber.
  notified_at    timestamptz,

  -- Recorded rather than deleted, so an address that has been taken off cannot
  -- be silently re-added by a later sign-up: the `on conflict do nothing`
  -- insert leaves this row, and this stamp, exactly as they are.
  unsubscribed_at timestamptz
);

comment on table public.newsletter_signups is
  'Addresses that asked to hear about new drops. This is a record that someone '
  'asked, not a mailing list that is sent to — there is still no newsletter, no '
  'welcome email and no unsubscribe link, and no copy on the site may promise '
  'one. Separate from contact_enquiries because an address is a membership '
  '(unique, idempotent, ends in an unsubscribe) while an enquiry is a piece of '
  'work (repeatable, ends in a reply).';

/* ------------------------------------------------------------- who may read */

-- RLS on with NO policy, plus an explicit revoke — the pattern 0002, 0003 and
-- 0005 document, and the reason it needs both halves: RLS-with-no-policy denies
-- every row to every non-bypassing role, and the revoke is what closes the hole
-- on hosted Supabase, where every new table in `public` is granted to anon and
-- authenticated as it is created.
--
-- WHY THERE IS NO ANON INSERT GRANT, on a table anonymous strangers write to.
--
-- The obvious alternative is `grant insert to anon` with an insert-only RLS
-- policy, letting the browser write its own row. It was rejected. The anon key
-- ships in the browser bundle, so that grant is a public PostgREST endpoint
-- accepting arbitrary rows into this table: it walks straight past the route's
-- zod validation, its rate limiter and its topic enum, and the CHECK
-- constraints above become the entire defence. `/api/contact` already runs
-- server-side (`export const runtime = "nodejs"`), so the service-role client
-- is right there — the row can be written by the same code that validated it,
-- and the public key gets nothing at all. A write-only grant is also not the
-- harmless thing it sounds like: `insert ... returning` and constraint-violation
-- messages both leak, and a duplicate-key error on newsletter_signups would
-- turn a write-only grant into an oracle for "is this address on the list".
--
-- So both tables are service_role only, in and out.
alter table public.contact_enquiries enable row level security;
revoke all on table public.contact_enquiries from public;
revoke all on table public.contact_enquiries from anon, authenticated;
grant select, insert, update, delete on table public.contact_enquiries to service_role;

alter table public.newsletter_signups enable row level security;
revoke all on table public.newsletter_signups from public;
revoke all on table public.newsletter_signups from anon, authenticated;
grant select, insert, update, delete on table public.newsletter_signups to service_role;

/* ------------------------------------------------------------------- abuse */

-- WHAT A BOT COSTS, written down so the next person does not have to work it
-- out from scratch.
--
-- These are unauthenticated endpoints that now write rows. What stands in front
-- of them is `rateLimit(clientKey(request, "contact"), 5, 60_000)` — five posts
-- per minute per client, held in a Map in one process. Read lib/rate-limit.ts
-- before trusting it: it is per-process and resets on every deploy, and its
-- notion of "client" is an IP address, so a caller with a pool of them has a
-- proportional allowance.
--
-- The ceiling from a single sustained IP is 5/min = 7,200 rows/day. A worst-case
-- row here is a little over 2 KB (2000 characters of message plus the rest), so
-- roughly 15 MB/day — days, not hours, against Supabase's 500 MB free tier, and
-- visible long before it bites. That is the reason the CHECK bounds above are
-- worth having and the reason nothing more elaborate is built here: the bound
-- turns "unbounded free text from a stranger" into a number you can multiply.
--
-- What is NOT solved: a distributed flood, and junk enquiries that are within
-- every bound and simply are not real. Neither has a schema answer. The
-- follow-ups, in the order they would be worth doing, are a shared rate-limit
-- store (lib/rate-limit.ts already names Upstash), and a check on how many rows
-- one address has filed. Deliberately not built here — an unmeasured shop
-- guessing at abuse thresholds gets them wrong in the direction that turns away
-- a real customer with a faulty product.
