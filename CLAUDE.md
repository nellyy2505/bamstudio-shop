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

`WORKLOG.md` is the source of truth for project state: what was built, six
rounds of review findings, what is deliberately still open, and — in **§0** —
the ten launch blockers with their current status. All ten have been addressed;
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
```

There is **no test framework**. Verification is done by replaying real payloads
against a running dev server and by running SQL assertions — see below.

## Verifying a change (this is the part that matters)

Static checks are not evidence here. `tsc`, `eslint`, `build` and every SQL
check passed while all ten launch blockers in `WORKLOG.md` §0 were live, and
three times in this project a *fix* introduced a regression that only a
replayed payload caught. Hand-written API tests passed while checkout was
completely broken for the highest-margin products.

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

One command, self-bootstrapping, exits non-zero if any assertion is not `t`. It
drives a **locally installed PostgreSQL 16** (`apt install postgresql-16`):
`initdb`s a disposable cluster outside the repo, recreates the database from
empty, applies the Supabase stand-ins the migration needs (`anon` /
`authenticated` / `service_role`, `auth.users`, `auth.uid()`, `pgcrypto`), then
the migration, the seed and `verify.sql`, and prints the assertion table. It
refuses to run against anything that is not Postgres 16.

> **The schema is `supabase/migrations/0001_init.sql`. There is no
> `supabase/schema.sql`.** This file and `WORKLOG.md` both used to say to pipe
> `schema.sql`; it does not exist and never did, and that cost someone real
> time.

Docker is the alternative where a local Postgres is unwanted — it is the older
recipe, kept because the script assumes an `apt`-installed server and Docker
was *unavailable* in the environment this was last verified in:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), and the service_role/anon/
# authenticated roles first, then pipe supabase/migrations/0001_init.sql,
# supabase/seed.sql and supabase/verify.sql through
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
  and how many, never what it costs.

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

**Business rules live in `lib/config.ts`** — shipping prices and the free
threshold, print lead time, builder bundle pricing, personalisation limits,
payment badges, the GST and support-email flags. Change a number there and it
propagates to every page, the basket and the Stripe session together. Never
inline one of these values in a component.

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
  `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. Read per request.

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

**One stale reference you cannot fix from a docs pass:** `getStripe()` in
`lib/stripe.ts` still throws `"STRIPE_SECRET_KEY is not set. Add it in
.env.local (and in Vercel)."` The advice is wrong now — deployed, it is a Fly
secret. Fix the string next time you are editing that file for another reason.

## Conventions

- Money is cents everywhere. `lib/format.ts` renders it.
- Australian English in all customer-facing copy ("colour", "personalised",
  "favourites", "postcode", "suburb").
- Comments in this codebase explain *why*, usually recording a defect that was
  found and closed. Match that when you touch a guarded path — a future session
  needs to know the constraint, not the syntax.
- Product artwork is illustrated (`components/ProductArt.tsx`), not photos.
  New products need an `ART_BY_SKU` entry or they fall back to a theme default.
