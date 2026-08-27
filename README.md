# Bam Studio — online shop

The storefront for Bam Studio: 3D-printed fidget clickers, charms and a
build-your-own name charm, printed to order in Sydney.

- **Framework:** Next.js 16 (App Router, React 19, TypeScript)
- **Styling:** Tailwind CSS v4, design tokens in `app/globals.css`
- **Database & accounts:** Supabase (Postgres + Auth, Google + email)
- **Payments:** Stripe Checkout + webhook
- **Transactional email:** Resend, over plain `fetch` (no client library)
- **Hosting:** Fly.io — one always-on 512 MB machine in `syd`, running a Docker
  image built from `output: "standalone"`. See *Deployment shape* below

## Run it locally

```bash
npm install
cp .env.example .env.local     # fill in the keys — see SETUP.md
npm run dev                    # http://localhost:3000
```

`.env.local` is **local development only**. The deployed shop reads no `.env`
file at all — `output: "standalone"` does not load them — so production config
arrives as real environment variables: build args for the `NEXT_PUBLIC_*` values
and Fly secrets for the rest. *Deployment shape* below has the split.

The app **runs with no database at all**: when the Supabase variables are
missing it serves a sample catalogue from `lib/fallback-data.ts`, so you can
browse, search and build a name charm immediately. This is an intended mode,
not a failure mode — the checkout verification harness depends on it. Checkout
needs real Stripe keys.

It also **runs with no email configured**, and says so rather than pretending:
every promise of an email is gated, and the contact and newsletter forms tell
the sender when their message reached nobody. See *Email* below.

Full step-by-step credentials and deployment guide: **[SETUP.md](SETUP.md)**.
History of what was built, what reviews found, and what is deliberately still
open: **[WORKLOG.md](WORKLOG.md)** — read it before picking this up.

## Project layout

```
app/
  page.tsx                    home
  shop/                       catalogue + filters + sort
  product/[slug]/             product detail, gallery, buy box, reviews
  builder/                    design-your-own name charm
  collections/                the six colourways
  search/                     search results
  cart/                       basket → Stripe Checkout
  order/confirmed/            post-payment confirmation
  track/                      guest order tracking
  login/ signup/ forgot-password/ reset-password/ auth/
  account/                    orders, favourites, addresses, settings
  admin/                      the staff area — overview, orders, products,
                              inventory (print queue, buy list, and
                              measure/), reports, colours, settings, access.
                              Every page, route and action calls requireStaff()
  (admin-join)/admin/join/    accepting a staff invitation. A route group, so
                              the URL is /admin/join but the page is NOT
                              wrapped by app/admin/layout.tsx — an invited
                              person is not staff yet
  about/ faq/ contact/ legal/ not-found.tsx
  api/
    checkout/                 creates the Stripe Checkout Session
    webhooks/stripe/          records paid orders (service role), sends the
                              order-confirmation email via after()
    health/                   dependency-free liveness endpoint for Fly's
                              health check — touches no Supabase, no Stripe,
                              no network
    search/suggest/           header typeahead
    track/ contact/ newsletter/
components/
  ui/                         Button, Pill, Stars, Field, Alert, Icon…
  layout/                     Header, Footer, SearchBar
  product/                    ProductCard, QuickAdd, Favourite
  builder/                    Keycap, KeycapWord
  cart/CartProvider.tsx       basket state (localStorage-backed)
  ProductArt.tsx              the illustrated product artwork
lib/
  config.ts                   prices, shipping, builder bundles — business rules
  queries.ts                  all catalogue reads (with fallback)
  email.ts                    Resend over fetch; never throws, never logs PII.
                              `isEmailConfigured()` lives here and is the one
                              answer to "can the shop send email"
  contact.ts                  the shared "can a customer reach us, and what do
                              we send them" predicates — import, never re-derive
  rate-limit.ts               in-memory throttle (see the caveat below)
  shipping/                   Australia Post postage. dimensions · weights ·
                              select · client · cache · fallback · quote ·
                              lines. `quoteBasket()` is the one entry point,
                              used by checkout, the cart and
                              /api/shipping/quote (see Postage below)
  auth/staff.ts               requireStaff() and the role → capability map.
                              The role lives in public.staff, never on profiles
  costing.ts                  a transcription of the workbook's Products sheet
                              (columns T–AA). Fractional cents; nulls stay null
  types.ts  format.ts  stripe.ts  safe-next.ts  supabase/
supabase/
  migrations/0001_init.sql    THE schema — RLS policies, helper functions,
                              grants. (There is no `schema.sql`.)
  migrations/0002_shipping.sql  product measurements, the rate cache, and
                              quote provenance on orders
  migrations/0003_admin.sql   the staff area: staff, invitations, colours,
                              filament stock, settings, accessories, recipes
  migrations/0004_letter_eligible_default.sql
                              products.letter_eligible defaults to false
  storage.sql                 the product-photos bucket. NOT a migration and
                              deliberately not run by verify-sql.sh — run it
                              by hand once in the Supabase SQL editor
  seed.sql                    catalogue, generated from the workbook
  verify.sql                  schema smoke test — one table of 52 rows, and
                              every one must print `t`
scripts/
  generate-seed.mjs           regenerates seed.sql + fallback-data.ts
  check-costing.mjs           lib/costing.ts against the workbook's own
                              cached values
  verify-sql.sh               applies every file in migrations/ + the seed +
                              verify.sql to a local Postgres 16 and checks
                              every assertion
  replay-checkout.mjs         replays the real CartView payloads at /api/checkout
proxy.ts                      Next 16's renamed middleware: refreshes the
                              Supabase auth cookie, guards /account and /admin
                              (signed-in only — the role cannot be checked
                              here), carries the query string on next=, and
                              excludes api/webhooks and api/health
Dockerfile                    deps → build → runtime; node:22-slim
fly.toml                      app, region, machine size, health check
.dockerignore                 what never enters the build context
.github/workflows/deploy.yml  push to master → flyctl deploy --remote-only
```

## Deployment shape

The shop runs as a Docker container on **one always-on Fly.io machine in `syd`**
(`shared-cpu-1x`, 512 MB). It moved off Vercel because Vercel's Hobby plan
forbids commercial use — its own example being "any method of requesting or
processing payment from visitors of the site" — and Pro is US$20/developer/month;
Fly is about A$6/month, is the only managed option with a Sydney region, and
keeps a long-lived Node process, which two things in this app require (see
*Always-on is a correctness constraint* below). `SETUP.md` Step 5 is the
owner-facing runbook; this section is the reasoning.

**Build and run are separated by memory.** `next build` peaks at about **1.6 GB
RSS**, which does not fit on the 512 MB app machine and is not reliable on 1 GB
either. The running server is about **150 MB RSS**. So builds happen on Fly's
remote builder — `fly deploy --remote-only`, which is what
`.github/workflows/deploy.yml` runs — and the machine only ever receives a
finished image. `next.config.ts` sets `output: "standalone"`, which traces what
the server actually imports: about **72 MB of deployable tree (~24 MB gzipped)**
against **629 MB of `node_modules`**.

The `Dockerfile` is three stages — `deps` (`npm ci`) → `build` (`next build`) →
`runtime` (`node server.js`) — on `node:22-slim`. Points worth not rediscovering,
all of them recorded in comments at the lines themselves:

- `.next/static` and `public/` are **not** traced by standalone, because they are
  served rather than imported. The runtime stage copies them beside `server.js`
  by hand. Drop either and pages still return 200 while every asset 404s.
- The app tree is **root-owned and the process runs as `node`**, so a code
  execution bug cannot rewrite `server.js`. Only `.next/cache` is writable.
- `HOSTNAME=0.0.0.0`, port 8080. Fly's proxy reaches the machine over its
  private 6PN address, so the standalone server's default localhost bind would
  make every health check fail with connection refused.
- The build stage **needs outbound network**: `next/font/google` downloads
  Poppins and Nunito Sans and self-hosts them.
- There is no `HEALTHCHECK` instruction — Fly Machines do not read Docker's
  health status. The check that matters is `[[http_service.checks]]` in
  `fly.toml`, hitting `/api/health` every 15s.

### Configuration reaches the container two different ways

The standalone server **does not read `.env.local`, or any `.env` file**. That is
the root of the only real deployment gotcha here:

| Kind | Route in | Changing it |
|---|---|---|
| Every `NEXT_PUBLIC_*` value | Docker **build arg**, inlined by `next build` | **Rebuild and redeploy** |
| `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `AUSPOST_API_KEY` | **Fly secret**, read at request time | Restart |

Never put a secret in a build arg — build args are recorded in image history.

**`NEXT_PUBLIC_SITE_URL` is worth its own paragraph, because it does not behave
the way "environment variable" suggests.** Turbopack **constant-folds** it into
the server bundle: in the built tree `siteUrl()` compiles down to
`function(){ return "https://…".replace(/\/$/,"") }` inside
`.next/server/chunks/lib_stripe_ts_*.js`, with the `process.env` read and the
throw branch both gone. Measured at runtime: booting the built server with a
*different* value still emits the value it was built with, and booting it with
the variable *removed* does not throw — it serves the baked one. So **changing
the shop's domain is a rebuild and redeploy, not an env change and a restart**,
and setting it as a Fly secret does nothing at all. The `siteUrl()` throw in
`lib/stripe.ts` therefore fires **at build time only** (via `metadataBase` in
`app/layout.tsx`); that, plus the `test -n` guard in the Dockerfile, is what
stops a bad image existing in the first place. The value is **not** in
`.next/static`, so nothing about this leaks to the browser. For contrast,
`getStripe()` in the same file compiles with its `process.env.STRIPE_SECRET_KEY`
read intact — a secret really is read at runtime.

### Always-on is a correctness constraint, not a cost setting

`fly.toml` sets `auto_stop_machines = "off"`, `auto_start_machines = false` and
`min_machines_running = 1`. **Do not "optimise" these.** Two things live only in
the machine's memory:

1. **The order-confirmation email** is sent from `after()` in
   `app/api/webhooks/stripe/route.ts`, which by definition runs *after* the
   response has been flushed to Stripe. Fly's proxy counts inbound connections
   and cannot see work running inside the machine, so a machine that stops
   drops a send that nothing is holding a connection open for — a charged
   customer who is never told.
2. **`lib/rate-limit.ts` is an in-process `Map`**, and it is the only protection
   on `POST /api/track`. A stop resets every bucket, so anyone who can provoke
   an idle stop wins their retry budget back for free.

`suspend` is not a middle ground: it snapshots RAM, so the limiter would
survive, but the machine resumes believing sockets are still live that the other
end has abandoned — precisely the in-flight Resend request from (1). It keeps
the state and breaks the socket, which is the half that mattered.

(Strictly, `min_machines_running` is inert while autostop is `"off"` — Fly
defines it only for `"stop"`/`"suspend"`. It is kept as a second lock in case
someone flips autostop on anyway.)

`kill_signal = "SIGTERM"` with `kill_timeout = "30s"` is the other half of the
same concern: the default 5s drain window is too short for an in-flight Resend
request that no inbound connection accounts for. Next's standalone `server.js`
registers its own SIGTERM handler, so no `tini`/`dumb-init` shim is needed.

### The health endpoint, and why `proxy.ts` excludes it

`app/api/health/route.ts` answers exactly one question — is this process alive
and serving HTTP — and touches no Supabase, no Stripe, no network and no
filesystem. That is deliberate on two counts: Fly polls it every 15 seconds
forever, so anything hung off it is permanent background load; and a check that
fails when a *dependency* is down is a readiness check in a liveness check's
clothes, which would have Fly restart a healthy machine because Supabase
blinked. The shop is built to browse on sample data with no database at all, so
"Supabase is down" must not read as "this container is dead".

`proxy.ts`'s matcher excludes `api/health` alongside `api/webhooks`, because
every matched request runs `supabase.auth.getUser()` — a network round trip.
Leaving the health path matched would spend Supabase free-tier request budget
continuously, on a request that carries no cookies and can never be signed in.
(`api/webhooks` is excluded for a different reason: Stripe's signature is
computed over the exact bytes that arrived, so that body must stay untouched.)

### Deploying

Push to `master`. `.github/workflows/deploy.yml` runs `flyctl deploy
--remote-only`, passing each `NEXT_PUBLIC_*` value as a `--build-arg` from a
GitHub Actions Secret or Variable; it also checks the required ones by name and
stops with a readable message before building anything. `workflow_dispatch` lets
you deploy from the Actions tab without pushing. The app name and region come
from `fly.toml`, so there is one place to change them. The exact list of GitHub
Secrets and Variables is in `SETUP.md` Step 5d.

## The catalogue comes from your spreadsheet

`scripts/generate-seed.mjs` reads the **Products** sheet of
`../Documents/3D_Planner.xlsx` and writes both `supabase/seed.sql` and the
local fallback data. It is the one place that maps a SKU to its artwork.

```bash
node scripts/generate-seed.mjs                    # default workbook path
node scripts/generate-seed.mjs /path/to/file.xlsx
```

Rules it applies:

- **"My price" wins.** When that column is filled it becomes the shop price.
  Until then, a per-category fallback price is used — see `PRICE_BY_CATEGORY`.
- **Licensed characters are excluded** (`LICENSED_SKUS`). Hello Kitty is
  currently filtered out; add any others there.
- Display/packaging items and the lucky scoop are stall-only and skipped.
- New products need an entry in `ART_BY_SKU` to get bespoke artwork,
  otherwise they fall back to their theme's default.

After regenerating, re-run `supabase/seed.sql` against your database.

## Email

`lib/email.ts` posts to the Resend HTTP API with `fetch`. There is no npm
client: the whole surface needed is one POST, so `package.json` stays untouched
and the cold start stays small.

Two properties the rest of the app relies on:

- **`sendEmail` never throws.** It returns an `EmailResult`, and the caller
  decides what to say. Email is a side effect of a checkout, a webhook or a
  form post, and none of those may fail because a mail provider is slow — a
  webhook that 500s over a mail failure makes Stripe redeliver a completed
  order.
- **Nothing here logs a message body or a recipient address.** A masked address
  (`a***@example.com`) is the most that reaches the log stream, and provider
  error text is scrubbed of anything email-shaped before it is returned.

### One switch, not two

`isEmailConfigured()` in `lib/email.ts` is the **single source of truth** for
"the shop can send email":

```ts
Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
```

That is the same expression `sendEmail` itself checks, so a claim printed on a
page and the capability behind it cannot disagree. **There is no public mirror
of it.** There used to be — `SHOP.canSendEmail`, reading
`NEXT_PUBLIC_EMAIL_ENABLED` — and two switches for one fact is the defect
described in the callout below. Do not reintroduce one.

The variables the owner sets:

| Variable | What it does |
|---|---|
| `RESEND_API_KEY` | Server-only secret. Never `NEXT_PUBLIC_`. Set it with `EMAIL_FROM` or not at all |
| `EMAIL_FROM` | The `From:` address, on a domain verified in Resend |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | The studio mailbox. **Not optional** if the contact form or the newsletter box is to work at all — both deliver by emailing it |

`isEmailConfigured()` **throws when called in the browser** rather than
answering `false`. Neither secret is `NEXT_PUBLIC_`, so Next replaces both reads
with `undefined` in a client bundle: the secret cannot leak, but the answer
would silently be `false` there while the server said `true` — different words
either side of hydration, from the same component. The guard is a hand-rolled
stand-in for `import "server-only"`, which is not a dependency of this project.
So:

- a **server component** calls `isEmailConfigured()` directly;
- a **client component** takes a `canSendEmail` boolean **prop** from its server
  parent. `app/account/settings/page.tsx` is the only place that threads it —
  down to `ProfileCard`, `EmailPreferences` and `DeleteAccountCard`.

### The predicates live in `lib/contact.ts`

Nothing re-derives one. The module reads only `NEXT_PUBLIC_` values, so it is
safe to import from a client component; the two predicates that depend on the
secret take it as an argument instead of reading it.

| Predicate | True when |
|---|---|
| `hasStudioMailbox` | `NEXT_PUBLIC_SUPPORT_EMAIL` is set. Never print `SHOP.supportEmail` or build a `mailto:` without it — unset, it renders the literal `[HELLO@YOURDOMAIN]` |
| `hasSocialAccount` | an Instagram or TikTok URL is set |
| `canReachStudio` | either of the above — "is there any door at all". Deliberately does **not** count the on-site form |
| `formsReachStudio(canSendEmail)` | `canSendEmail && hasStudioMailbox` |
| `sendsOrderConfirmation(canSendEmail)` | `canSendEmail` **alone** |
| `socialLinks` | the accounts that actually exist, in display order |

> **The difference between those last two is the bug that shipped.** The order
> confirmation depends on the secrets **alone** — the webhook sends an itemised
> mail whether or not a support mailbox exists. The contact form and the
> newsletter additionally need the mailbox, because they deliver *by emailing
> it*. Anding the two together produced four false statements: the terms, the
> privacy policy and the account settings page each said the shop sends no
> order emails while, in the launch configuration, the webhook was sending an
> itemised one — and Resend was disclosed as a data processor only when the
> support mailbox happened to be set too, so in realistic partial
> configurations customer names, addresses, order contents and totals reached a
> US processor the privacy policy did not name. Keep the two apart.

What is sent:

- **Order confirmation**, from the Stripe webhook, scheduled with `after()` so
  a slow provider can never delay the 200 that tells Stripe the work is done.
  It is triggered from exactly one place — the successful compare-and-set that
  allocates the order number — so retries and duplicate events cannot send it
  twice.
- **Contact enquiries**, to the studio mailbox, with the sender as `reply-to`.
  Nothing persists an enquiry, so the email *is* the delivery: the route
  returns `{ ok, delivered }` and the form says plainly when `delivered` is
  false.
- **Newsletter sign-ups** — a *notification* to the studio, not a
  subscription. **There is no subscriber list**, no audience and no unsubscribe
  mechanism; the owner adds the address by hand. No page may promise a
  newsletter until one exists.

Supabase Auth's own emails (sign-up confirmation, password reset) are separate
and are sent by Supabase whether or not any of this is configured.

### How the claim pages are rendered

Worth knowing, because a stale build would make a legal document false: **no
page carries `export const dynamic`.** The only one in the app is
`force-dynamic` on `app/api/webhooks/stripe/route.ts`, and it is there so the
raw body reaches Stripe's signature check untouched, not for freshness.

The legal, FAQ, contact, track, about and order-confirmed pages are nonetheless
rendered per request, because the **root layout awaits `getUser()`**, which
awaits `cookies()` — that opts the whole tree out of static prerendering. The
build's prerender manifest confirms it: the only prerendered entries are
`/_global-error` and `/favicon.ico`.

That protection is **incidental, not declared**. Each of those pages reads its
capability at module scope (`const CAN_SEND_EMAIL = isEmailConfigured()`), so
if the layout ever stops touching cookies they become static and a build-time
answer gets baked into a page that states what the shop does with customer
data. If you change the layout's auth read, add `export const dynamic =
"force-dynamic"` to the pages that make email claims in the same change.

## Postage

`lib/shipping/` quotes real Australia Post rates. **It is built and not yet
connected**: `app/api/checkout/route.ts` still charges the flat
`shippingCost()` from `lib/config.ts`. `WORKLOG.md` §5 round 9 is the full
record; this is the shape.

**`quoteBasket(lines, methodId)` in `lib/shipping/quote.ts` is the only entry
point, deliberately.** Both the cart and the checkout route have to call it, so
the price a customer agreed to and the price Stripe charges cannot diverge. It
resolves **cache → live API → fallback table**, it **never throws**, and it never
returns zero for a basket with something in it. A postage lookup sits inside
rendering a cart and inside creating a checkout session; neither may fail
because a carrier is slow.

Three facts about Australia Post shaped everything, and all three were checked
against the live API rather than the documentation:

- **Domestic parcel price does not vary by destination postcode** (verified
  across eight, from Melbourne CBD to Christmas Island). Postcodes change which
  services are *available*, never what they cost. So postage needs **no customer
  address** — which is what makes it quotable on the cart page, before Stripe
  collects an address.
- **There is no cubic weighting.** Dimensions decide validity and Large Letter
  eligibility. Weight decides price.
- **Prices are GST-inclusive retail.** The shop is not GST-registered, so the
  total passes straight through and no page may show a GST component against it.

**Large Letter is the interesting tier and the reason for the care.** Under
125 g and 260 × 360 × 20 mm it is **$3.40**, against about **$10.20** for the
cheapest parcel — but it is **untracked and uninsured**. Every product is
`letter_eligible: false` today, and since
`supabase/migrations/0004_letter_eligible_default.sql` that is the column's
default too, so nothing becomes letter-eligible by being typed into the table
editor and everything quotes as a tracked parcel: slightly dear, never short.
Turning it on is a per-row tick in Supabase, with no deploy. The half that used
to have to ship with it is done: `transitLabel(methodId, tracked)` takes tracking
as a **required argument** rather than hardcoding "· tracked", and the cart
passes `quoteBasket()`'s own `tracked` boolean. Never pass that argument a
literal.

Everything rounds toward the shop paying — weights up, limits pulled in, and the
fallback table returns the band *above* the one a basket falls in. Overcharging
a dollar is recoverable and visible; undercharging is paid quietly by the studio
on every order until someone reconciles a postage bill.

**Label printing and tracking are not automatable at this scale.** Australia
Post's Shipping & Tracking API needs an eParcel or StarTrack contract (2,000+
parcels a year, and a credit account wanting $1,000+ a month plus an issued
ABN); MyPost Business is free and needs no ABN but is **portal-only, with no
API**. Labels are printed by hand in the portal, and the automation path when
volume arrives is a third-party platform such as Starshipit or Shippit — not
Australia Post's own API.

`AUSPOST_API_KEY` (free, self-serve) is a **runtime** value: a Fly secret, never
a build arg. Without it every quote comes from the fallback table and the shop
keeps working. It is listed in `.env.example`, and is **not set anywhere yet**.

## Business rules live in one file

`lib/config.ts` holds the free-shipping threshold, postage prices, print lead
time and the builder's flat bundle pricing. Change a number there and it
updates every page, the basket and the Stripe session together. **All money is
in cents** to avoid floating-point drift.

## Prices are recalculated server-side

`app/api/checkout/route.ts` never trusts the browser's prices. It reloads each
product from the database, re-derives the unit price from the base price plus
the attachment delta (or the flat bundle price for a name charm), and charges
that. A tampered basket cannot change what Stripe collects.

## How an order is recorded

1. **Checkout** creates the Stripe session *and* writes the basket to `orders`
   with status `pending`, keyed by `stripe_session_id`. (Stripe's metadata
   caps each value at 500 characters, far too small for a basket.)
2. **The webhook** (`checkout.session.completed`) flips that row to
   `confirmed` and fills in the address and total Stripe collected. The update
   is scoped to rows still `pending`, so Stripe's retries are harmless.
3. If the database was unreachable at step 1, the webhook rebuilds the order
   from Stripe's own line items instead, so a paid sale is never lost. Each
   line carries `product_data.metadata.slug` — `short_name` is **not** unique,
   so the slug is the only key that cannot link the wrong product row — and the
   line items are fetched with `expand: ['data.price.product']` so the variant
   string survives and the order is still printable.
4. The webhook allocates the order number, and *that* compare-and-set is what
   schedules the confirmation email — once, whatever Stripe redelivers.
5. `checkout.session.expired` deletes the abandoned `pending` row.

Two properties of that path are easy to break and worth stating:

- **`cancelled` is the only status treated as terminal.** A late
  `async_payment_succeeded` on an order a person has already pulled must not
  number it, move its stock or email its customer a confirmation. The later
  fulfilment states (`printing`, `packed`, `shipped`, `delivered`) are *not*
  terminal — an interrupted delivery still has to be repairable. A cancelled
  order returns **200**, not a throw: no retry can make it eligible, so a 500
  buys nothing but an unbounded redelivery loop. **The money did arrive, so
  the refund is a manual job** — the branch logs at error level saying so.
- **`orders.email` is `NOT NULL`, so the rebuild path writes the sentinel
  string `"unknown"`** when Stripe gave no address. It is truthy, so
  `if (!order.email)` accepts it as a real mailbox; the confirmation guard
  therefore tests by name, through `hasCustomerEmail()`. **The sentinel still
  escapes the webhook** — `/track`, the account order pages and `lib/queries.ts`
  read the column without knowing about it. Open item, in `WORKLOG.md` §6.

**A guest can see their order number without any email.** `/order/confirmed`
reads it through `public.order_confirmation_summary(stripe_session_id)`, a
`SECURITY DEFINER` function granted to `service_role` only and keyed on the
unguessable session id the page already holds. It returns the order number and
status and nothing else. RLS on `orders` is `auth.uid() = user_id`, so without
this a guest could never learn the number they are later asked to quote at
`/track` — email is a convenience, not the only path.

`pending` rows are excluded from the account order list and from guest
tracking — an unpaid checkout is not an order. `/order/confirmed` reads the
session's real `payment_status` and only claims an order is confirmed when
Stripe says it was paid; anything else keeps the basket intact.

If the order cannot be staged (a database blip), checkout **fails and expires
the Stripe session** rather than letting someone pay for an order we have no
record of and cannot print.

## The staff area

`/admin` is where the shop is run from: Overview, Orders (including a form for
typing in a market or TikTok sale), Products, Inventory (the print queue, the
filament buy list, and *Measure the catalogue*), Reports, Colours, Settings and
Studio access. It is deployed and has been driven against the live database; the
tables behind Inventory and Reports are still empty, so those screens say "not
measured" rather than printing a zero.

**Authority is a table, not a column.** `0001_init.sql` grants every signed-in
account UPDATE on its own `profiles` row across *all* columns, and RLS cannot
restrict a policy to a subset of columns — so a `role` there would be
self-assignable over PostgREST with the anon key that ships in the browser
bundle. It lives in `public.staff` instead: RLS on, **no policy at all**, and an
explicit revoke from `anon` and `authenticated`, so only the service-role key can
read it. `verify.sql` asserts every part of that.

The consequence worth knowing before changing anything: **the role cannot be
checked in `proxy.ts`**, which holds only the anon client. The proxy establishes
"signed in at all"; `requireStaff()` in `lib/auth/staff.ts` does the real check
and is called by every page, route handler and server action under `/admin`. A
layout is not a security boundary for a route handler, and a server action is a
public HTTP endpoint with a generated id.

Roles are a whitelist per role rather than a rank: `owner` is everything,
`studio` is everything but Studio access, and `packing` is orders and nothing
else — so the person helping post parcels never sees a cost or a margin.

**Invitations.** There is no way to register as staff. The first owner is placed
by hand in the SQL editor; everyone else is invited, and an invitation can only
ever grant Studio or Packing. Tokens are stored hashed. `/admin/join?token=…`
lives in a route group (`app/(admin-join)/admin/join/`) so that the URL is still
`/admin/join` while the page escapes `app/admin/layout.tsx` — that layout calls
`requireStaff()`, and an invited person is by definition not staff yet. Accepting
is a POST, never a page render: a GET that grants authority is one a link preview
or a scanner can fire on somebody's behalf. `acceptInvitation` is the only server
action in the shop that does not call `requireStaff()`, and it checks the
invitation itself instead — including that the signed-in email is the invited
one.

**Costing.** `lib/costing.ts` transcribes the workbook's Products sheet, columns
T–AA, in fractional cents with exactly one rounding at the end;
`scripts/check-costing.mjs` checks it against the values Excel itself cached.
Nulls stay null, and a piece with no print time and no filament has **no**
suggested price rather than one derived from the cost of its packaging.

## Personalisation

Two modes, set per product in `scripts/generate-seed.mjs` and stored in
`products.personalisation_mode`:

- **`builder`** — the keycap letter builder at `/builder?product=<slug>`,
  priced by letter count from `BUILDER_PRICING`. The catalogue price is the
  cheapest bundle, so the page never advertises a figure the builder can't
  charge.
- **`text`** — one free-text line collected on the product page (a pet's name,
  a date), priced at the product's own price.

Checkout refuses a builder payload on anything that isn't `builder` mode —
without that check, any product could be bought at name-charm prices.

## Commands

```bash
npm run dev      # dev server
npm run build    # production build (run before every deploy)
npm run lint     # eslint
npx tsc --noEmit # typecheck

./scripts/verify-sql.sh          # every migration + seed + assertions on local
                                 # Postgres 16. It globs supabase/migrations/ —
                                 # there is no list to keep in step — and prints
                                 # how many it applied. verify.sql is 52 rows;
                                 # count the rows as well as the ticks
node scripts/check-costing.mjs   # lib/costing.ts vs the workbook's cached values
node scripts/replay-checkout.mjs # replay the real client baskets at /api/checkout

fly status -a bamstudio-shop     # is the machine up, and where
fly logs -a bamstudio-shop       # what the server is saying
fly secrets list -a bamstudio-shop   # names only, never values
```

Deploys are automatic on push to `master`. To run one by hand you must pass
every `NEXT_PUBLIC_*` value as a `--build-arg` — they are not read from
`.env.local` — so prefer the workflow; `SETUP.md` Step 5d has the full command
for the cases where you cannot.

Neither script is optional after a change to checkout or the schema, and
neither reads the way you expect: in the checkout replay **HTTP 502 is the
pass** (validation succeeded and the call reached Stripe, where the dummy key
fails), and its last case is a negative control that must be **rejected with
400** — if that one passes, the harness is not testing anything. `WORKLOG.md`
§4 and `CLAUDE.md` have the full protocol and the reasons behind it.

## Known limitation worth reading before launch

`lib/rate-limit.ts` is in-memory and per-process. It is now the **only** thing
in front of `/api/track`, which returns a customer's postal address for an order
number plus the matching email — and order numbers are a sequence plus four hex
characters. Move it to Upstash/Redis before launch; the call sites do not
change. `WORKLOG.md` §6 has the rest of the open list.

**What is no longer true of it:** `clientKey()` used to take the *first*
`x-forwarded-for` value. That was safe on Vercel, whose proxy overwrites the
header, and unsafe on Fly, whose proxy **appends** to whatever the caller sent —
so the first value was simply a string the client chose, and rotating it bought
unlimited attempts against the endpoint that hands back a postal address. It now
prefers **`Fly-Client-IP`**, gated on `FLY_APP_NAME` (set by the Machines
runtime, never by a request) so the header cannot be forged off-Fly, and falls
back to the **last** `x-forwarded-for` hop — the one value the caller could not
write — for hosts that are not Fly. Per Fly's docs the last hop *on Fly* is the
app's own shared address, identical for every caller, which is why
`Fly-Client-IP` is preferred there rather than XFF. So the limiter now reads the
right identity; it is still in one process's memory, and that is the part still
outstanding. Putting another proxy in front of Fly (Cloudflare, say) would
collapse every visitor into one bucket and means revisiting the function.
