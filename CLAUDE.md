# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

The import above is not optional. This is Next.js 16: `middleware` is renamed
`proxy` (see `proxy.ts`), and `params`/`searchParams` are Promises that must be
awaited. Read the matching guide under `node_modules/next/dist/docs/` before
writing code — `01-app/02-guides/upgrading/version-16.md` covers both changes.

## What this is

The storefront for Bam Studio, a **pre-revenue Australian sole trader** selling
3D-printed fidget clickers, charms and a build-your-own name charm. Next.js 16
(App Router, React 19, TypeScript) · Tailwind v4 · Supabase (Postgres + Auth) ·
Stripe Checkout · **Fly.io** (Docker, one always-on 512 MB machine in `syd`).
All money is **integer cents (AUD)**.

The hosting moved off Vercel to Fly.io — Vercel's Hobby plan forbids commercial
use and Pro is US$20/dev/month, while Fly is ~A$6/month, has a Sydney region and
keeps a long-lived Node process this app depends on. **Anything you were about
to assume from a Vercel-shaped mental model is probably wrong here**; the
deployment section below is the short version and `README.md` has the reasoning.

Postage is quoted from **Australia Post** by `lib/shipping/`, and as of round 10
it **is** wired: `quoteBasket()` prices every basket in checkout and in the cart.
See *Postage* below before touching anything that mentions shipping, and
`WORKLOG.md` §5 rounds 9 and 10 for how it was arrived at.

There is a **staff area at `/admin`** (round 11), the shop is **deployed** at
`bamstudio-shop.fly.dev`, and the schema is applied on the live Supabase
project. See *The staff area* below before touching anything under `app/admin/`.

`WORKLOG.md` is the source of truth for project state: what was built, sixteen
rounds of findings, what is deliberately still open, and — in **§0** — the ten
launch blockers with their current status plus **the open list as it stands
today**. Round 14 cut `/admin/inventory/measure`'s markup and gave the admin
pages their own titles; round 15 was a security and truthfulness sweep — the
response headers in `next.config.ts`, a throttle on `/order/confirmed`, six
untrue customer-facing statements removed, and `0005_sale_integrity.sql` for the
money-integrity defects; and round 16 made a customer's contact message a **row**
before it is an email (`0006_enquiries.sql`). All ten blockers have been addressed;
two are closed **for the claims they made only**, and §0 also separates what was
verified by *running* it from what was verified by reading. Start there, not
here. `SETUP.md` is the owner's deployment runbook.

## Commands

```bash
npm run dev        # dev server (Turbopack by default in 16)
npm run build      # production build — run before every deploy
npm run lint       # eslint (flat config; `next lint` was removed in 16)
npx tsc --noEmit   # typecheck
node scripts/generate-seed.mjs [workbook.xlsx]   # regenerate the catalogue
node scripts/check-costing.mjs                   # lib/costing.ts vs the workbook's
                                                 # own cached values
./scripts/verify-sql.sh                          # every migration + seed + verify.sql
```

**`npm run build` is on the check list, not a formality.** `npx tsc --noEmit`
and `npx eslint .` both passed on a round-11 tree that could not compile: one
`export const` in a `"use server"` file — every export there must be an async
function — made Turbopack report the module as having no exports and took eleven
pages down. Only `next build` sees the server-action boundary, and only it
proves a route group resolves to the URL you expect, which is what `/admin/join`
depends on. `tsc` also accepts a server action defined inside a `"use client"`
file, which compiles and then does nothing.

`generate-seed.mjs` needs `../Documents/3D_Planner.xlsx`. **That workbook is not
in this sandbox**, so the seed cannot be regenerated here: `lib/fallback-data.ts`
and `supabase/seed.sql` had their shipping columns **patched in place** in round
9, and a real regenerate from the workbook is owed the next time someone has it.
Note also that the script **text-parses `BUILDER_PRICING` out of `lib/config.ts`
with a brace-naive regex**, and now carries a hand-transcribed copy of
`CATEGORY_DEFAULTS` from `lib/shipping/dimensions.ts` — a `.mjs` script cannot
import a `.ts` module. Nothing enforces that the two agree. Change one, change
the other.

There is **no test framework**. Verification is done by replaying real payloads
against a running dev server and by running SQL assertions — see below.

## Verifying a change (this is the part that matters)

Static checks are not evidence here. `tsc`, `eslint`, `build` and every SQL
check passed while all ten launch blockers in `WORKLOG.md` §0 were live, and
three times in this project a *fix* introduced a regression that only a
replayed payload caught. Hand-written API tests passed while checkout was
completely broken for the highest-margin products.

**And open the page.** Round 12's worst defect — a product page printing
*Suggested $0.50 · Profit $8.73 · Actual margin 97%* on a piece with no print
time and no filament, directly under a panel correctly saying there was no cost
— was invisible to the typecheck, the lint, the build and all 50 SQL
assertions.

Both checks are scripts. Run them; don't reconstruct them.

### Checkout

**After any change touching checkout**, run the app with a dummy Stripe key and
replay the payloads the client actually builds:

```bash
printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev
node scripts/replay-checkout.mjs      # in a second terminal
```

`scripts/replay-checkout.mjs` posts the exact JSON `CartView.checkout()` sends
— key order and omitted-vs-null included — for seven cases: all four
personalised products (`custom-name-charm` and `alphabet-bag-charm-on-cord` in
builder mode, `custom-number-date-chain` and `personalised-bowl-with-pet-s-name`
in text mode), an ordinary product, a five-line mixed basket, and a negative
control.

- **502** = validation passed and it reached Stripe. **This is the pass.**
- **400/409** = validation rejected the basket. **503** = misconfigured app.

**Case 7 is the negative control and it is the only reason a green run means
anything**: free-text personalisation on an ordinary product, which checkout
must refuse with **400**. If it returns 502 the harness is not observing
validation and every PASS above it is worthless — the script prints exactly
that. A run where the negative control passed is not a run.

The route allows 10 requests per 60s per IP and the script sends 7, so it
spaces them by `DELAY_MS` (default 1000) and **aborts on a 429** rather than
reporting throttling as failures. `BASE_URL` points it elsewhere. Back-to-back
runs will trip the limit.

**One bad line rejects the whole basket**, which is how two previous blockers
escaped notice — so never drop the mixed basket.

### SQL

`supabase/verify.sql` asserts the guarantees that otherwise only fail in
production: that the webhook may allocate order numbers and move stock (without
those grants customers pay and no order is ever recorded), and that
`lookup_order` is **not** reachable by `anon`. Every row must print `t`.

```bash
./scripts/verify-sql.sh
```

> **The script keeps no list of migrations.** It globs every `.sql` in
> `supabase/migrations/`, sorts under `LC_ALL=C` and applies the lot before the
> seed, printing `applied N migration(s)`. The hand-written list it replaced fell
> behind twice — `0002_shipping.sql` sat unapplied for two rounds while
> `verify.sql` asserted against it, and the run stopped rather than failing, so
> 29 assertions silently stopped existing. Observed: **29/29** (round 10),
> **50/50** (round 11, each assertion proved to fail when broken), and 50 rows
> all `t` against the live project. **Neither 52/52 nor 86/86 has been observed
> from any session that wrote these docs** — every count after 50 is read off
> `verify.sql`, not off a run.
>
> ⚠️ **`supabase/storage.sql` is deliberately not applied by the harness**, and
> is not a migration: `storage` is a platform schema that vanilla PostgreSQL does
> not have. Guarding it with an `if exists` would make the harness skip it
> silently and print ticks about a bucket it never created. It is run by hand,
> once, in the Supabase SQL editor.
>
> ⚠️ **The stand-in must keep granting Supabase's default privileges.** Hosted
> Supabase grants every new `public` table to `anon` as it is created — which is
> *why* `0002` and `0003` revoke explicitly — and vanilla PostgreSQL does not.
> Without that `alter default privileges` block, every "anon cannot read X"
> assertion passes whether or not the revoke exists: it measures the absence of
> a grant, not the presence of a revoke. Round 11 deleted each revoke one at a
> time to watch its assertion go red. Do that again if you change it.
>
> ⚠️ **Its Supabase stand-in must keep installing pgcrypto into an `extensions`
> schema, not into `public`.** It used to do the latter, which put
> `gen_random_bytes` on the default search path and made the harness print 29/29
> while `0001_init.sql` **could not be applied to a real Supabase project at
> all** (`next_order_number()` pins `search_path` and could not resolve it). A
> stand-in has to reproduce the hosted platform's *shape*, not just its API.
> `WORKLOG.md` §5 round 10.
>
> ⚠️ **`verify.sql` returns ONE table, and it is now 86 rows.** It was eight
> separate statements, and the Supabase SQL editor shows only the last — so the
> owner saw two rows, both `true`, and could not check her own database with the
> tool the runbook names. Count rows as well as ticks: the file has grown 24 →
> 29 (shipping) → 50 (the staff area) → 52 (the `letter_eligible` default) →
> 65 (`0005_sale_integrity.sql`: the confirmation-email stamp, the observable
> stock clamp and the refund register) → **86** (`0006_enquiries.sql`: the
> contact-enquiry and newsletter-sign-up tables), so a shorter table is an older
> copy of the file, which is a green result that never looked at part of the
> schema. Counted from the file rather than taken from its header: 22
> `insert into _checks` statements, 64 `union all` branches between them, 86
> rows in the final select — which agrees with what the file says of itself.
>
> ⚠️ **A missing migration does not shorten the table, it stops the run.** The
> first assertion naming an object that does not exist raises instead of
> returning `f`. So "the table came back short" means an old copy of the file;
> "the run aborted" means an unapplied migration. They are different failures.

One command, self-bootstrapping, exits non-zero if any assertion is not `t`. It
drives a **locally installed PostgreSQL 16** (`apt install postgresql-16`):
`initdb`s a disposable cluster outside the repo, recreates the database from
empty, applies the Supabase stand-ins the migration needs (`anon` /
`authenticated` / `service_role`, `auth.users`, `auth.uid()`, `pgcrypto`), then
the migration, the seed and `verify.sql`, and prints the assertion table. It
refuses to run against anything that is not Postgres 16.

> **The schema is the six files in `supabase/migrations/`** — `0001_init.sql`,
> `0002_shipping.sql`, `0003_admin.sql`, `0004_letter_eligible_default.sql`,
> `0005_sale_integrity.sql`, `0006_enquiries.sql`, in that order, plus
> `supabase/storage.sql` by hand.
> That list is what is in the directory as this was written; the harness globs
> rather than reading it, so trust `ls supabase/migrations/` over this sentence.
> **There is no
> `supabase/schema.sql`.** This file and `WORKLOG.md` both used to say to pipe
> `schema.sql`; it does not exist and never did, and that cost someone real
> time.

Docker is the alternative where a local Postgres is unwanted — it is the older
recipe, kept because the script assumes an `apt`-installed server and Docker
was *unavailable* in the environment this was last verified in:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), the service_role/anon/
# authenticated roles, Supabase's default privileges and pgcrypto in an
# `extensions` schema first, then pipe every file in supabase/migrations/ in
# order, then supabase/seed.sql and supabase/verify.sql through
# docker exec -i pg psql -U postgres
```

### The webhook — and the harness that is not in this repo

The Stripe webhook is the highest-consequence file in the project and neither
script above touches it. It was exercised by a **behavioural harness of 43
scenarios** that loads the real route module against a fake Supabase client and
a fake Stripe, asserts on the calls it makes, and reports the HTTP status. It
was last run at **43/43**.

**It lived in `/tmp/webhook-harness/` and does not survive the session it was
written in.** If it is gone, that is expected — rebuild it rather than assuming
the path is covered. Four files: a loader that transpiles the route, a Supabase
stub with a seeded fake database, the scenarios, and a typecheck. What it
covers, so a rebuild has a target:

- the `23505` duplicate-insert paths — existing row genuinely finished, still
  pending/unnumbered/itemless, and the re-read itself erroring;
- transient errors at every swallowed-error site: the staged-row SELECT, the
  order-items probe, the products lookup, the confirming compare-and-set, the
  number pre-read, the stock claim, both `decrement_stock` RPCs, the rebuild
  insert, the staged-row delete;
- duplicate delivery of the same event, and a genuine concurrent winner
  mid-flight (first retry 500, next 200);
- two rows sharing a `stripe_session_id` (PGRST116 → 500);
- **zero line items from Stripe** — must not close the event;
- **unexpanded** line items (`price.product` is an id string) — nothing may be
  invented, the line still has to be written;
- **a segment matching both a colour name and an attachment label** — placed as
  neither;
- slug-versus-name matching, including a legacy line with no `metadata.slug`;
- the sentinel-email path: order still numbered and stocked, mail task queued,
  **no send attempted**;
- **a cancelled order** — not numbered, no stock claim, no decrement, no mail,
  no writes at all, and still 200; likewise cancelled-and-itemless;
- a `confirmed`-but-unfinished and a `confirmed`-but-itemless order — both
  still repaired, which is what proves the terminal check is scoped to
  `cancelled` and not to "anything past pending".

### The one guard you must not tighten

`app/api/checkout/route.ts` refuses checkout when Stripe is live and Supabase
is missing — scoped to `NODE_ENV === "production"` on purpose. **Leave the
scoping alone.** The checkout replay above runs the app with *no database at
all*; an unconditional guard turns all seven cases into a 503 that never
reaches the validation being tested, and the run goes quiet rather than red.
That has already been done and re-fixed twice (`WORKLOG.md` §5 rounds 3 and 4).
Round 4's rule is the constraint: **a guard may reject a query error, never the
absence of a database.** `WORKLOG.md` §4 has the full reasoning, and so does a
comment at the guard itself.

## Hard business rules — not preferences

Breaking one of these is a real-world problem, not a bug. `WORKLOG.md` §2 has
the full table.

- **No licensed characters, ever.** Listing one gets shops pulled from
  marketplaces. `LICENSED_SKUS` in `scripts/generate-seed.mjs` filters them.
- **The business is NOT GST-registered** (under the $75k threshold). No page
  may show or claim GST. `SHOP.gstRegistered` gates every GST surface.
- **No invented reviews, ratings or stock.** The ACCC treats fabricated reviews
  as misleading conduct. The seed emits `rating 0`, `review_count 0`,
  `stock_on_hand 0`, and the review insert policy was withdrawn entirely.
- **"2–4 business days" is printing time, never delivery** (`PRINT_LEAD_TIME`).
  Delivery quotes are print lead time *plus* carrier transit.
- **Personalised items are non-returnable** except when faulty.
- **Prices are always recomputed server-side.** The client says which product
  and how many, never what it costs — and never how heavy it is.
- **No sample data, ever, and no plausible-looking zero.** A shop that has taken
  no orders reports that it has taken no orders; a piece nobody has measured says
  "not measured" rather than printing a price derived from a floor. This was an
  explicit instruction from the owner, and three round-12 defects were breaches
  of it. **A plausible zero is a false statement someone eventually decides on**
  — round 15 removed six of them, including a search suggestion that printed
  "0 reviews" under every product and a "Highest rated" sort over a column where
  every row is `0`, which is really an arbitrary order dressed as a ranking.
- **Overselling is allowed, and must stay visible.** The shop prints to order.
  Stock only moves in the webhook, *after* payment, so a stock check at checkout
  guards a window it does not own — two shoppers can both pass it, and the loser
  would be refused after being charged. `decrement_stock` therefore sells anyway
  and returns the shortfall, which accumulates on `products.oversold_units` and
  surfaces on `/admin` as a print-this-first signal. It is not an error state.
- **Never promise a tracking number in general copy.** Whether a basket goes as
  a tracked parcel or an untracked Large Letter is not known until
  `quoteBasket()` answers, so the FAQ, `/track` and any page describing postage
  in the abstract must use `transitRangeLabel()` — the carrier's transit range
  with no tracking claim. `transitLabel(methodId, tracked)` takes `tracked` as a
  **required** argument for this reason; pass the quote's own boolean, never a
  literal.

Because the shop makes claims to customers, **a change that makes an on-site
statement untrue is as serious as a crash.** §0.1 of the log is exactly that:
roughly forty places promised an email that no code ever sent, and it took a
whole remediation round to unwind. Then the *fix* shipped its own false
statements, because it had two switches for one fact. It now has one.

**`isEmailConfigured()` in `lib/email.ts` is the single source of truth** for
"the shop can send email":

```ts
Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
```

It is the same expression `sendEmail` itself checks, so a claim and the
capability behind it cannot disagree.

- **There is no `SHOP.canSendEmail` and no `NEXT_PUBLIC_EMAIL_ENABLED`.** Both
  are gone; nothing reads the variable. A comment in `lib/config.ts` marks the
  spot and says why. **Do not reintroduce a public mirror of a server fact** —
  the mirror is what let the terms, the privacy policy and the account settings
  page each state that the shop sends no order emails while the webhook was
  sending itemised ones, and what let Resend go undisclosed as a data processor
  in every configuration where the support mailbox was unset.
- **It throws in the browser** rather than answering `false`. Neither variable
  is `NEXT_PUBLIC_`, so both read `undefined` in a client bundle: the secret
  cannot leak, but a silent `false` there would render different words than the
  server did and trip a hydration mismatch. The guard is a hand-rolled
  stand-in for `import "server-only"` — that package is **not** a dependency
  here and cannot be added from a docs pass.
- So: a **server component** calls it; a **client component** takes a
  `canSendEmail` boolean **prop** from its server parent.
  `app/account/settings/page.tsx` is the one threading site — down to
  `ProfileCard`, `EmailPreferences` and `DeleteAccountCard`. If you add a
  client component that needs the answer, thread it; do not import the module.
- API routes check it per request and report what the send really did:
  `/api/contact` and `/api/newsletter` return `{ ok, delivered }` and the forms
  render different copy for `delivered: false`, because nothing persists an
  enquiry — the email *is* the delivery.

**Everything built on top of it lives in `lib/contact.ts`. Import, never
re-derive.** `hasStudioMailbox`, `hasSocialAccount`, `canReachStudio`,
`formsReachStudio(canSendEmail)`, `sendsOrderConfirmation(canSendEmail)` and
`socialLinks`. The module reads only `NEXT_PUBLIC_` values, so it is safe to
import from a client component; the two predicates that need the secret take it
as an argument rather than reading it.

The distinction that caused the privacy defect, and the one to hold on to:

- **`sendsOrderConfirmation` is `canSendEmail` ALONE.** The webhook's itemised
  confirmation has no dependency on the studio mailbox — that only decides
  whether the mail also carries a reply-to.
- **`formsReachStudio` is `canSendEmail && hasStudioMailbox`.** The contact form
  and the newsletter box deliver *by emailing* the mailbox, so both are needed.

Anding them — one test for both jobs — is the specific mistake. It produces
configurations where the mail goes out and the privacy policy denies it.

`hasStudioMailbox` also guards §0.6: `SHOP.supportEmail` renders the literal
string `[HELLO@YOURDOMAIN]` when unset, so it may never be printed, and no
`mailto:` may be built from it, without that check.

## Architecture worth knowing

**The catalogue is generated, not hand-written.** `scripts/generate-seed.mjs`
reads `../Documents/3D_Planner.xlsx` and writes *both* `supabase/seed.sql` and
`lib/fallback-data.ts`. A `.mjs` script cannot import the TypeScript module,
so it parses `BUILDER_PRICING` out of `lib/config.ts` — a builder product can
never advertise a price the builder cannot charge, and the script throws if it
cannot find the literal. After
editing the workbook, re-run the script *and* re-run `seed.sql`.

**Business rules live in `lib/config.ts`** — the free-postage threshold (but
**not** postage prices, which come from Australia Post via `lib/shipping/`), print lead time, builder bundle pricing, personalisation limits,
payment badges, the GST and support-email flags. Change a number there and it
propagates to every page, the basket and the Stripe session together. Never
inline one of these values in a component.

**The basket limits follow that rule too, and there is one copy of them.**
`BASKET_LIMITS.maxLineQuantity` (20) and `.maxLines` (40) are in `lib/config.ts`
(line 222). This used to be a known defect and is not any more: the numbers were
four hand-written literals in the Zod schemas of `app/api/checkout/route.ts` and
`app/api/shipping/quote/route.ts`, transcribed a third time into a stopgap
`components/cart/limits.ts`, with nothing making the three agree. That file is
deleted, and both route schemas and `components/cart/CartProvider.tsx` import
the constant instead. Change the number in `lib/config.ts` and nowhere else. The
cart enforces them at all because a breaching basket used to be refused by
checkout with a blanket `{ error: "Invalid basket." }` and by the quote route
with a 400 the cart could only render as "Calculated at checkout" — a customer
with no total and no reason. Stopping the basket being built that way, and
naming the limit at the point it is reached, is the honest version.

**Money integrity lives in `0005_sale_integrity.sql` and the code around it.**
Four things it is worth knowing before touching the webhook or Reports:

- **`orders.confirmation_email_sent_at`.** The confirmation used to be sent with
  no record that it had been, so a send lost to a stopped machine was lost for
  good. The webhook now stamps it with a `.is("confirmation_email_sent_at",
  null)` filter, which makes a Stripe redelivery either recover a lost email or
  do nothing — never send twice. `getStudioAttention()` counts website orders
  that are numbered, past `pending`, and still unstamped.
- **`order_items.unit_cost_cents` is written for web sales too**, from
  `unitCostsAtSale()` in `app/admin/data.ts`, called by both
  `app/api/checkout/route.ts` and the webhook. It used to be written only by the
  market-stall form in `recordSale`, so the shop's main channel contributed
  revenue and no cost, and Reports could not measure online profit at all. It is
  **stamped, not derived**: the column records what the piece cost *when it
  sold*, and computing it at read time would rewrite every historical margin the
  next time filament or an accessory changed price. It is **null** for a product
  with no print time or no filament recipe, because a 13c "cost" is a 97% margin
  on a piece nobody has timed, and Reports already knows how to say so.
- **`public.payment_incidents`.** A payment that clears for an order somebody
  already cancelled used to be a `console.error` saying "refund this one by
  hand" and a 200 to Stripe: the customer charged, nothing sent, and the only
  record a log line on a platform nobody reads. It is now a row — RLS on with no
  policy plus an explicit revoke, `service_role` only, `stripe_session_id`
  unique so an `on conflict do nothing` insert records one incident however many
  times Stripe delivers. `resolveRefundIncident` in `app/admin/actions.ts`
  (guarded on `orders`) marks it issued. **The refund itself stays manual and
  should**: refunding is a decision with a customer at the other end of it.
- **`recordSale` no longer leaves an order with no lines counted as revenue**,
  and `removePhoto` can no longer be steered by a form field into deleting any
  object in the `product-photos` bucket — the product's own stored photo list is
  the authority, deliberately not a path-prefix check, because a rule derived
  from a naming convention stops holding the day the convention changes.

**A customer's message is a row before it is an email** (`0006_enquiries.sql`).
`/api/contact` handed the enquiry to Resend and stored it nowhere — its own
comment said "the email IS the delivery" — and answered `{ ok: true, delivered:
false }` on a failed send. Honest to the customer, and a total loss to the shop:
the words existed only in the HTTP request. Three ordinary configurations lost
them outright (no `RESEND_API_KEY`/`EMAIL_FROM`; no `NEXT_PUBLIC_SUPPORT_EMAIL`;
Resend answering 4xx/5xx or not inside the 8s timeout), and this shop states in
several places, the legal pages included, that it sends no order emails — so the
contact form is one of very few channels a customer has, and a message reporting
faulty goods is exactly the one that must not vanish. **Write the row first; the
email is a notification about a row that already exists.** Do not reorder them.

`contact_enquiries` and `newsletter_signups` are deliberately two tables. An
enquiry is a piece of *work*: repeatable — a follow-up is a second thing said —
ends in a reply, and carries `handled_at`/`handled_by`. A sign-up is a
*membership*: the lower-cased address is the primary key so asking twice is
idempotent, and it ends in an unsubscribe that a later `on conflict do nothing`
insert must not silently undo. Folded into one table, half the columns are null
for half the rows, the unique-address rule is wrong for enquiries and required
for sign-ups, and clearing out answered enquiries would delete the mailing list.

**Neither table has an anon insert grant**, and that is the decision worth
keeping. The obvious alternative — `grant insert to anon` plus an insert-only
RLS policy, letting the browser write its own row — was rejected because the
anon key ships in the browser bundle, which makes that grant a public PostgREST
endpoint accepting arbitrary rows: it walks straight past the route's zod
validation, its rate limiter and its topic enum, leaving the CHECK constraints
as the entire defence. A write-only grant is not harmless either: `insert …
returning` and constraint-violation messages both leak, and a duplicate-key
error on `newsletter_signups` would turn one into an oracle for "is this address
on the list". `/api/contact` already runs server-side, so the service-role
client writes the row the same code just validated. `notified_at` null means no
notification was sent, **not** that the enquiry was lost — the reader asks
`isEmailConfigured()` at read time rather than the schema mirroring a deployment
setting it cannot see. The length bounds on those columns are duplicated from
the zod schema in `app/api/contact/route.ts` on purpose — the route validates,
the table is the backstop — and **the two must move together**. And there is
still **no newsletter, no welcome email and no unsubscribe link**, so no copy on
the site may promise one.

**Security response headers are set in `next.config.ts`, on `/:path*` with no
exclusions** — HSTS, the CSP, `X-Frame-Options: DENY`, `nosniff` and
`Referrer-Policy`. The hole they close is specific rather than hygiene:
`@supabase/ssr`'s cookie defaults carry no `secure` flag, and `force_https` in
`fly.toml` is a *redirect*, so the session cookie has already gone out in clear
before the redirect comes back. Three things not to undo:

- **`script-src 'unsafe-inline'` is a documented compromise, not an oversight.**
  Next streams the RSC payload through inline `<script>self.__next_f.push(...)`
  tags on every response; the only supported alternative is a per-request nonce
  in `proxy.ts`, which forces dynamic rendering on every page — a real bill on
  one always-on 512 MB machine. Removing the token without doing the nonce work
  breaks every page, checkout included.
- **HSTS omits `preload` on purpose.** Preloading is a one-way door for a
  pre-revenue sole trader, and `bamstudioshop.com` is bought but still parked.
  Add it once the custom domain is live and settled.
- **`/api/webhooks/stripe` is deliberately not excluded here**, even though
  `proxy.ts` excludes it. The proxy's exclusion is about the *request* bytes
  Stripe signs over; this config only adds *response* headers, which Stripe's
  HTTP client discards. Copying the exclusion would take its shape without its
  reason. Likewise `app/order/confirmed/page.tsx` keeps its own stricter
  `referrer: "no-referrer"` metadata — that URL carries the Stripe session id.

**Pages that make email claims are rendered per request — but not because they
say so.** No page carries `export const dynamic`; the only one in the app is
`force-dynamic` on the Stripe webhook route, and that is for the raw body, not
for freshness. The legal, FAQ, contact, track, about and order-confirmed pages
are dynamic because the **root layout awaits `getUser()`**, which awaits
`cookies()`, opting the whole tree out of static prerendering — the build's
prerender manifest lists only `/_global-error` and `/favicon.ico`. Each of
those pages reads its capability at module scope
(`const CAN_SEND_EMAIL = isEmailConfigured()`), so the protection is
**incidental**. If you change the layout's auth read, add
`export const dynamic = "force-dynamic"` to the claim-making pages in the same
change, or a build-time answer gets baked into a legal document.

**The app runs with no database at all.** Missing Supabase env vars →
`isDatabaseConfigured()` is false → the bundled sample catalogue from
`lib/fallback-data.ts` is served. This is an **intended mode, not a failure
mode**, and it is what the checkout verification flow above depends on. A
"strict" guard that broke it has already had to be re-fixed once. Any new guard
must distinguish "the database returned an error" from "there is no database".

**Order lifecycle** — the part that needs several files to understand:

1. `app/api/checkout/route.ts` recomputes every price from the database, then
   creates the Stripe Checkout Session **and** stages the basket as a `pending`
   order keyed by `stripe_session_id`. Stripe caps metadata at 500 chars per
   value, far too small for a basket, so only a compact `slug:qty` stock map
   and a few scalars ride on the session.
2. If staging fails, checkout **expires the Stripe session and fails** rather
   than taking money for an order it cannot print.
3. `app/api/webhooks/stripe/route.ts` promotes the row to `confirmed`, fills in
   the address and total, allocates the order number and moves stock. Every
   step is a compare-and-set (update scoped to `status = 'pending'`, order
   number scoped to `is null`, stock claimed via `stock_applied`) so Stripe's
   retries and the duplicate `async_payment_succeeded` event are harmless.
   **Returning 200 tells Stripe to stop retrying** — only do that when the work
   is genuinely done or genuinely already done by someone else.
4. If the database was unreachable at checkout there is no staged row, so the
   webhook rebuilds the order from Stripe's own line items. **Zero line items
   from Stripe is a failed read, not an empty basket** — a paid Checkout
   Session always has them — so that path throws rather than confirming an
   order with nothing to print.
5. Order numbers are allocated **on payment**, not at checkout, so abandoned
   baskets don't burn them.
6. **`cancelled` is the only terminal status.** The two `status !== "pending"`
   repair branches would otherwise number, stock-move and email a cancelled
   order on a late `async_payment_succeeded`. They are scoped by
   `isTerminal()`, which holds `cancelled` alone — the later fulfilment states
   (`printing`/`packed`/`shipped`/`delivered`) are still repairable. A
   cancelled order returns **200 rather than throwing**: no retry can make it
   eligible, so a 500 buys only an unbounded redelivery loop. It logs at error
   level because the money arrived and **the refund is a manual job**.
7. **`orders.email` is `NOT NULL`, so the rebuild path writes the sentinel
   `"unknown"`.** It is truthy — `if (!order.email)` accepts it as a real
   mailbox, which is exactly how a guard that did not guard got shipped. Read
   it through `hasCustomerEmail()`. The sentinel still escapes the webhook:
   `/track`, the account order pages and `lib/queries.ts` read the column
   without knowing about it (`WORKLOG.md` §6).

`pending` rows are excluded from the account order list and from guest
tracking — an unpaid checkout is not an order. `/order/confirmed` reads the
session's real `payment_status` from Stripe and only claims confirmation when
Stripe says it was paid.

**Two personalisation modes**, in `products.personalisation_mode`:

- `builder` — the keycap letter builder at `/builder?product=<slug>`, priced by
  letter count from `BUILDER_PRICING`. A builder line's `colour` is a
  *colourway* validated against the collections table, not a product colour.
- `text` — one free-text line collected on the product page, priced at the
  product's own price.

Checkout **refuses a builder payload on anything that isn't builder mode** —
without that check any product could be bought at name-charm prices. This is a
closed exploit; don't loosen it.

**Email** (`lib/email.ts`): one `fetch` POST to the Resend API, deliberately
with no npm client. **`sendEmail` never throws** — it returns an `EmailResult`
and the caller decides what to tell the customer, because email is a side
effect of a checkout, a webhook or a form post and none of those may fail
because a mail provider is slow. It logs no message content and no recipient
address; `maskEmail()` is the most that may reach the log stream (§0.9). The
order-confirmation email is scheduled with `after()` from the *one* place that
can prove this delivery did the work — the successful order-number
compare-and-set in `assignOrderNumber` — which is the whole at-most-once story.
Don't send it from anywhere else.

**Postage** (`lib/shipping/`) quotes real Australia Post rates, and is wired
into checkout, into `POST /api/shipping/quote`, and into the cart. There is no
flat rate anywhere any more: `shippingCost()` is **deleted** and `SHIPPING` has
no `price` field. The rules that govern it:

- **`quoteBasket(lines, methodId)` in `lib/shipping/quote.ts` is the single
  entry point, and both the cart and checkout must use it.** Two code paths
  computing postage is how the price a customer agreed to and the price Stripe
  charges come to differ — silently, and only for some baskets.
- **It never throws and never returns zero for a non-empty basket.** Resolution
  is cache → live PAC → a fallback table that needs no network. A postage lookup
  happens inside rendering a cart and inside creating a checkout session, and
  neither may fail because a carrier's API is slow.
- **Weights come from server-loaded product rows, never from the client.** The
  browser says which product and how many. A basket that could name its own
  weight could name its own postage.
- **No customer address is needed.** Domestic parcel price was verified constant
  across eight destination postcodes; postcodes affect service *availability*
  only. This is why a basket can show a real price before anyone types an
  address, and why nothing here takes one.
- **Every value rounds toward the shop paying.** Weights up, dimensions up,
  carrier limits pulled in, the fallback table returns the band *above* the one
  a basket falls in. Overcharging a dollar is recoverable; undercharging is paid
  silently by the studio on every order until someone reconciles a postage bill.
- **Prices are GST-inclusive retail and the shop is not GST-registered**, so the
  total passes through as a total. Never run `gstComponent()` over a quote.
- **`transitLabel(methodId, tracked)` takes tracking as a required argument.**
  It used to hardcode "· tracked", which was true only while everything shipped
  as a parcel — and `letter_eligible` is a checkbox in the Supabase table
  editor, so one tick with no deploy would have armed the lie. Pass
  `quoteBasket()`'s `tracked`; **never pass a literal**, which is the hardcode
  again, just moved. A page with no basket to ask uses `transitRangeLabel()` and
  makes no tracking claim at all.
- **`isFreeShipping(subtotal, methodId)` decides who pays; `quoteBasket()`
  decides how much.** Never merge them. `shippingCost()` was deleted rather than
  deprecated — a second function still shaped like a price is one a future call
  site reaches for by mistake.
- **Both surfaces build their lines with `toShippingLines()`
  (`lib/shipping/lines.ts`) over rows from `loadProductsBySlug()`
  (`lib/queries.ts`).** One builder, one loader. If you add a third postage
  surface, use both — do not re-derive either.
- **A dropped line is not an empty basket.** `toShippingLines()` skips a slug it
  has no row for, and a basket that loses every line quotes at zero, which is
  correct for nothing and wrong for a basket. `/api/shipping/quote` returns 409
  when any line was dropped. This shipped as a live $0.00-postage bug in round
  10 before it was caught.
- **`letter_eligible` defaults to `false`, and must stay that way.**
  `0002_shipping.sql` originally declared it `default true` while
  `lib/shipping/weights.ts` documents the opposite — "absent means false", an
  unmeasured product is quoted as a parcel — and `select.ts` only counts a line
  as letter-eligible when the value is exactly `true`. A row typed into the
  Supabase table editor therefore arrived claiming Large Letter: $3.40,
  untracked and uninsured, against about $10.20 tracked, with the undercharge
  paid by the studio. `0004_letter_eligible_default.sql` sets the default to
  `false` and clears accidental `true`s once, gated so it can never touch a tick
  the owner made deliberately; `verify.sql` asserts both the declared default and
  the behaviour a hand-added row gets. **The flag is a judgement, not a
  measurement**, and a default is a judgement nobody made.
- **`AUSPOST_API_KEY` is a runtime secret** — a Fly secret, never a build arg,
  and never `NEXT_PUBLIC_`. `isPacConfigured()` throws in the browser rather
  than answering `false`, the same pattern as `isEmailConfigured()`.
- **The L2 cache tier is a seam, not an implementation.** If you add it, read
  the three numbered warnings at the top of `lib/shipping/cache.ts`; the one
  that matters is that a **fallback price must never be persisted**, or a
  two-second outage becomes six hours of inflated quotes.
- **Every physical constant in `lib/shipping/dimensions.ts` is an estimate**,
  and `select.ts`'s rule 4 (`max` thickness rather than sum) is only legitimate
  because rule 3 forces a single flat layer. Do not weaken rule 3.

## The staff area

`/admin` — nine screens for the person running the shop: Overview, Orders (with
a form for typing in a market or TikTok sale), Products, Inventory (print queue,
filament buy list, and *Measure the catalogue*), Reports, Colours, Settings and
Studio access. Built in round 11, deployed, and driven against the live database
in round 12. `WORKLOG.md` §5 rounds 11 and 12 have the reasoning.

**A role is not a column on `profiles`, and must never become one.**
`0001_init.sql` grants every signed-in account UPDATE on its own profile row
across *all* columns, and RLS cannot restrict a policy to a subset of columns —
a `role` there would be self-assignable over PostgREST with the anon key that
ships in the browser bundle. One HTTP request and a customer is an admin. It
lives in `public.staff`: RLS on, **no policy at all**, explicit revokes from
`anon` and `authenticated`, readable only with the service-role key.
`verify.sql` asserts all four facts on every run, and the same shape covers
every other table in `0003_admin.sql` that decides authority or exposes cost.
Do not add a policy to make something "easier to query" from the client.

**`requireStaff(capability)` is called by every page, route handler and server
action under `/admin`** — it cannot be hoisted anywhere. `proxy.ts` only holds
the anon client, so it can establish "signed in at all" and nothing more; a
layout is not a security boundary for a route handler; and a server action is a
public HTTP endpoint with a generated id that anyone who has ever loaded the shop
can find in the client bundle. "Only the admin page calls this" is a hope, not a
check. In `app/admin/actions.ts` the capability comes first, before the form data
is even read.

**There is exactly ONE documented exception: `acceptInvitation`.** It is the
action that *makes* somebody staff, so requiring staff would be circular —
everyone who legitimately reaches it is a signed-in account with no row in
`public.staff`. It is not unguarded: `resolveJoin()` requires a signed-in user, a
token that hashes to a live invitation row, and **the signed-in email to equal
the invited email**, which is a narrower gate than any capability in the file. An
agent that "fixes" this by adding `requireStaff()` breaks every invitation.
**Do not add a second exception without the same treatment**, and do not move the
page: `app/(admin-join)/admin/join/` is a route group so the URL is still exactly
`/admin/join` while the page escapes `app/admin/layout.tsx`, which calls
`requireStaff()` and would bounce the invited person before they could accept.

**No sample data, and no plausible-looking zero.** A shop that has taken no
orders says so; Reports renders an empty state rather than a chart of zeros; a
piece nobody has measured says "not measured" rather than `$0.00`. All three
round-12 defects were breaches of this, so it is not theoretical. The costing
chain carries it: **nulls stay null**, `unitCost()` returns `unknown: true` when
an input is missing, and `costProduct()` returns `suggested: null` rather than
pricing from a floor.

**`lib/costing.ts` is a transcription of the workbook and stays one.** Products
sheet, columns T–AA, the workbook's own formulas quoted in the comments,
fractional cents throughout with exactly one rounding at the end into the price;
`scripts/check-costing.mjs` checks it against the values Excel itself cached. The
round-12 guard for the false suggested price went into `costProduct()` in
`app/admin/data.ts` — the studio's own composition layer — precisely so that
`lib/costing.ts` still matches the sheet line for line. The workbook has no
notion of an unmeasured input; knowing that an input is missing is the
application's job. (Do not copy prices out of the workbook's Suggested price
column either: Settings C19 holds the *text* `1.6%`, so it is `#VALUE!` on every
row.)

**Guard by what a screen writes, not by where it lives.**
`/admin/inventory/measure` hangs off Inventory and asks for **`catalogue`**,
because counting a shelf is an observation and typing a print time is authoring
the cost basis every price in the shop derives from. `saveMeasurement` also
refuses partial nonsense rather than dropping it — grams with no colour, a colour
with no grams, zero grams, a repeated colour — and rejects a payload carrying
fewer than `MEASURE_COLOUR_SLOTS` slots, because the recipe is replaced wholesale
and a POST that simply omitted the fields would wipe one.

**A query that runs is not a query that is right.** The embedded-resource selects
in `app/admin/data.ts` — `product_filament(grams, colours(...))`,
`orders!inner(status)` in `getOpenDemand`, and the `order_items` embeds in
`getOrder` — have only ever returned `[]` against the real project, because every
table behind them is empty. That proves the syntax parses and nothing else. Until
one real sale exists, do not trust a number on Inventory or Reports.

**Supabase clients** (`lib/supabase/`): `createClient()` uses the anon key and
respects RLS; `createAdminClient()` uses the service-role key and bypasses RLS
entirely. The admin client belongs only in trusted server paths that a request
body cannot steer. `proxy.ts` refreshes the auth cookie on every request and
guards `/account` — it deliberately skips **`api/webhooks`**, which must receive
an untouched raw body for Stripe's signature check, and **`api/health`**,
because every matched request runs `supabase.auth.getUser()` and Fly polls that
endpoint every 15 seconds forever. The matcher is a single negative lookahead of
prefixes with no leading slash; get one wrong and nothing errors — the exclusion
silently widens and the `/account` guard quietly stops guarding. After any edit,
re-check `/account`, `/account/orders`, `/api/health` and `/api/webhooks/stripe`
against the pattern.

**Rate limiting** (`lib/rate-limit.ts`) is in-memory and per-process — a speed
bump, not a guarantee. It used to be decorative in front of `/api/track` because
`lookup_order` was granted to `anon` and could be called straight over PostgREST
with the public key, bypassing every route-level throttle. That grant is now
`service_role` only, so **the throttle is the only thing left in front of a
customer's postal address** — order numbers are a sequence plus four hex
characters. It should move to Upstash/Redis before launch; the call sites don't
change. The general rule survives the fix: never let this be the only thing
protecting data, and never grant a data-returning Postgres function to `anon`.

**`/order/confirmed` is throttled too, and where the check sits is the point.**
It was the last route family with no limit at all, and it reads a Stripe session
by id. The `rateLimit()` call is *inside* the `if (sessionId)` branch, so a
visit carrying no `session_id` calls Stripe not at all and spends nobody's
allowance; and the throttled path returns **before** the Stripe calls, because
throttling that still spends the quota protects nothing. Two consequences to
preserve if you touch that page: the early return means `<ClearCartOnMount />`
never renders, so a throttled basket survives exactly as an unpaid one does; and
the copy on that path claims **nothing** about the payment, because we did not
ask Stripe and do not know. Telling someone who has just been charged that no
money was taken is the one mistake that page exists to avoid. A page cannot set
a 429 or `Retry-After` the way a route handler can, so the wait is stated in the
copy instead.

**`clientKey()` no longer reads the first `x-forwarded-for` value — do not put
that back.** Vercel's proxy overwrote the header; **Fly's proxy appends to it**,
so the first value was whatever the caller sent, and rotating it bought
unlimited attempts against the endpoint that returns a postal address. It now
prefers `Fly-Client-IP`, gated on `FLY_APP_NAME` (set by the Machines runtime,
never by a request, so the header cannot be believed off-Fly), and falls back to
the **last** XFF hop — the one value a caller cannot write — for non-Fly hosts.
On Fly the last XFF hop is the app's own shared address, the same string for
every caller, which is why `Fly-Client-IP` is preferred there. The function's
own comment records the caveats; read it before changing the header logic.

**Guest order visibility.** RLS on `orders` is `auth.uid() = user_id`, so a
guest can read nothing — which is why `/order/confirmed` goes through
`public.order_confirmation_summary(text)`, a `SECURITY DEFINER` function keyed
on the Stripe session id the page already holds, called with the service role.
It returns **order number and status only**; that column list is a security
boundary and `verify.sql` asserts its exact shape. `lookup_order` behind
`/api/track` is the same pattern, and `/api/track` rebuilds its response field
by field as an allow-list, so a column added to the function reaches nobody
until someone widens the route too.

**Redirect safety.** `next=` parameters that survive sign-in must go through
`safeNext()` in `lib/safe-next.ts`, which resolves the value and compares
`.origin`. Prefix checks like `startsWith("/")` are not sufficient — the URL
parser strips tab/CR/LF *after* such a check, so `/<TAB>//evil.com` reads as
protocol-relative by the time a browser sees it.

## Deployment — constraints a code change can break

Four committed files describe the deployment: `Dockerfile`, `fly.toml`,
`.dockerignore`, `.github/workflows/deploy.yml`. Each carries its reasoning in
comments at the line it applies to. Read the file before changing it; what
follows is what a *code* change has to respect.

**Build and run are separated by memory.** `next build` peaks at ~1.6 GB RSS —
it cannot build on the 512 MB app machine, and not reliably on 1 GB either. The
running server is ~150 MB. Builds run on Fly's remote builder
(`fly deploy --remote-only`, which CI uses); the machine only runs the finished
server. `output: "standalone"` (in `next.config.ts`) gives ~72 MB of deployable
tree, ~24 MB gzipped, against 629 MB of `node_modules`. A dependency that
inflates the traced tree, or a build step that needs more memory, is a
deployment problem before it is a performance one. The build stage also needs
outbound network — `next/font/google` fetches Poppins and Nunito Sans.

**The standalone server reads no `.env` file.** `.env.local` is local
development only. Config arrives as real env vars, two ways:

- **Build args** — every `NEXT_PUBLIC_*`. Inlined by `next build`; changing one
  needs a **rebuild**, never a restart.
- **Fly secrets** — `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, and **`AUSPOST_API_KEY`**
  (new in round 9; without it postage quotes from the fallback table and the
  shop still works). Read per request.

**Never move a secret into a build arg** — build args are recorded in image
history. And never advise the owner to set a `NEXT_PUBLIC_*` value as a Fly
secret: it does nothing.

**`NEXT_PUBLIC_SITE_URL` is constant-folded, and this is measured, not assumed.**
Turbopack inlines it into the server bundle: in the built tree `siteUrl()`
compiles to `function(){ return "https://…".replace(/\/$/,"") }` inside
`.next/server/chunks/lib_stripe_ts_*.js`, with the `process.env` read and the
throw branch both gone. Booting the built server with a different value emits
the value it was built with; booting it with the variable removed does not throw.
Consequences to hold on to:

- **Changing the shop's domain is a rebuild and redeploy.** Not an env change
  and a restart.
- The `siteUrl()` throw fires **at build time only** (via `metadataBase` in
  `app/layout.tsx`). That, plus the Dockerfile's `test -n` guard, is what keeps
  a bad image from existing. **Keep both** — the guard fails in a second with a
  message naming the fix, the throw is the actual protection. The Dockerfile
  comment explains why neither is redundant.
- The value is **not** in `.next/static`, so nothing leaks to the browser. Do
  not call `siteUrl()` from a client component.
- Contrast: `getStripe()` in the same file keeps its `process.env` read in the
  compiled output. Secrets genuinely are runtime reads.
- The `NODE_ENV !== "development"` guard in `siteUrl()` must never be rewritten
  as `=== "production"`; Turbopack was measured folding exactly that comparison
  in this repo.

**`fly.toml`'s always-on settings are correctness, not cost.**
`auto_stop_machines = "off"`, `auto_start_machines = false`,
`min_machines_running = 1`. The order-confirmation email runs in `after()`,
i.e. after the response is flushed, and the rate limiter is an in-process `Map`.
A machine that stops drops both; `suspend` keeps the memory but resumes with
dead sockets, which breaks the in-flight Resend request specifically. **If you
ever make the app scale to zero, both have to be fixed first** — a durable queue
for the email, shared storage for the limiter. `kill_timeout = "30s"` is the
same concern's drain window. (`min_machines_running` is strictly inert while
autostop is off; it is a second lock, not a duplicate.)

**`app/api/health/route.ts` must stay dependency-free.** No Supabase, no Stripe,
no network, no filesystem. Fly polls it every 15s for the life of the machine,
and a check that fails when a *dependency* fails is a readiness check wearing a
liveness check's clothes — Fly would restart a healthy machine because Supabase
blinked, which restarting cannot fix. The shop is designed to browse with no
database at all, so "Supabase is down" must not read as "this container is
dead". A dependency probe, if ever wanted, belongs at its own path, polled far
less often, wired to alerting rather than to Fly's restart policy.

**`getStripe()`'s error message has been fixed** — it now names `.env.local` for
local work and `fly secrets set` for the server, and says the key is a runtime
secret and never a build arg. Earlier versions of this file listed the old
Vercel wording as a known-stale string; it is gone from the code.

## Traps in this working environment

None of these is about the app. All of them have cost time.

- **Turbopack constant-folds `process.env.NODE_ENV === "production"` comparisons
  in a production build.** Measured in this repo: a guard written that way was
  silently made unconditional in the compiled output. Write environment guards
  as **`!== "development"`**, which survives the optimiser. `siteUrl()` in
  `lib/stripe.ts` carries the same note at the line.

  **The one existing `=== "production"` guard is deliberate and must stay.**
  `app/api/checkout/route.ts:275` is scoped that way on purpose, and the fold is
  harmless there because it folds to the value the guard wants in each mode: on
  in a production build, off in development, which is exactly what the replay
  harness (running with no database) depends on. The rule above is about guards
  where the fold *changes* the meaning. Do not "consistency-fix" line 275.
- **The device bridge VM has no network access.** `git push`, `fly`, `curl` and
  anything else that needs egress must be run by the owner. Do not report a
  push as done because the command exited.
- **`git` on the mounted Windows folder cannot delete its own lock files.**
  Clear them by moving them aside — `mv .git/index.lock /tmp/`, and the same for
  any other `.git/**/*.lock` — rather than `rm`.
- **Nine files show as permanently modified and it is pure CRLF line-ending
  noise** (`git diff --ignore-all-space` is empty). **Never `git add -A`.** Stage
  the files you actually changed, by name, or a commit becomes unreviewable.
- **A Next build cannot complete on the device shell.** Each call is a fresh
  ~45s shell and anything left running is killed between calls — `nohup`,
  `setsid` and `disown` all die. What works: `tar` the source (excluding
  `node_modules`, `.next`, `.git`, `.env*`), stage that one file, then `npm ci`
  and `npm run build` in a cloud container with dummy `NEXT_PUBLIC_*` values.
  **Never stage `.env.local`.**
- **`../Documents/3D_Planner.xlsx` is not in the sandbox**, so
  `scripts/generate-seed.mjs` cannot be run here. `lib/fallback-data.ts` and
  `supabase/seed.sql` were patched in place in round 9; a real regenerate is
  owed.

## Conventions

- Money is cents everywhere. `lib/format.ts` renders it.
- Australian English in all customer-facing copy ("colour", "personalised",
  "favourites", "postcode", "suburb").
- Comments in this codebase explain *why*, usually recording a defect that was
  found and closed. Match that when you touch a guarded path — a future session
  needs to know the constraint, not the syntax.
- Product artwork is illustrated (`components/ProductArt.tsx`), not photos.
  New products need an `ART_BY_SKU` entry or they fall back to a theme default.
