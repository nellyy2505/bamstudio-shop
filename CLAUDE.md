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
Stripe Checkout · Vercel. All money is **integer cents (AUD)**.

`WORKLOG.md` is the source of truth for project state: what was built, five
rounds of review findings, what is deliberately still open, and — in **§0** — a
ranked list of defects that must be fixed before customers see this. Start
there, not here. `SETUP.md` is the owner's deployment runbook.

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
check pass right now while launch blockers are live, and three times in this
project a *fix* introduced a regression that only a replayed payload caught.
Hand-written API tests passed while checkout was completely broken for the
highest-margin products.

**After any change touching checkout**, copy the exact JSON that
`CartView.checkout()` builds (`app/cart/CartView.tsx`) and POST it to
`/api/checkout` with a dummy Stripe key:

```bash
printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev
```

- **502** = validation passed and it reached Stripe. This is success.
- **400/409** = validation rejected the basket.

Cover all four personalised products — `custom-name-charm` and
`alphabet-bag-charm-on-cord` (builder mode), `custom-number-date-chain` and
`personalised-bowl-with-pet-s-name` (text mode) — plus an ordinary product and
a mixed basket. **One bad line rejects the whole basket**, which is how two
previous blockers escaped notice.

**For SQL**, `supabase/verify.sql` asserts the guarantees that otherwise only
fail in production (most importantly that the webhook may allocate order
numbers and move stock — without those grants customers pay and no order is
ever recorded). Every row must print `t`. Exercise it locally against real
Postgres 16:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), and the service_role/anon/
# authenticated roles first, then pipe schema.sql, seed.sql, verify.sql through
# docker exec -i pg psql -U postgres
```

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

Because the shop makes claims to customers, a change that makes an on-site
statement untrue is as serious as a crash. §0.1 of the log is exactly that: a
dozen places promise an email that no code ever sends.

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
   webhook rebuilds the order from Stripe's own line items.
5. Order numbers are allocated **on payment**, not at checkout, so abandoned
   baskets don't burn them.

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

**Supabase clients** (`lib/supabase/`): `createClient()` uses the anon key and
respects RLS; `createAdminClient()` uses the service-role key and bypasses RLS
entirely. The admin client belongs only in trusted server paths that a request
body cannot steer. `proxy.ts` refreshes the auth cookie on every request and
guards `/account` — it deliberately skips `api/webhooks`, which must receive an
untouched raw body for Stripe's signature check.

**Rate limiting** (`lib/rate-limit.ts`) is in-memory and per-instance — a speed
bump, not a guarantee. Never let it be the *only* thing protecting data: a
Postgres function granted to `anon` is callable directly over PostgREST with
the public key, which bypasses every route-level throttle.

**Redirect safety.** `next=` parameters that survive sign-in must go through
`safeNext()` in `lib/safe-next.ts`, which resolves the value and compares
`.origin`. Prefix checks like `startsWith("/")` are not sufficient — the URL
parser strips tab/CR/LF *after* such a check, so `/<TAB>//evil.com` reads as
protocol-relative by the time a browser sees it.

## Conventions

- Money is cents everywhere. `lib/format.ts` renders it.
- Australian English in all customer-facing copy ("colour", "personalised",
  "favourites", "postcode", "suburb").
- Comments in this codebase explain *why*, usually recording a defect that was
  found and closed. Match that when you touch a guarded path — a future session
  needs to know the constraint, not the syntax.
- Product artwork is illustrated (`components/ProductArt.tsx`), not photos.
  New products need an `ART_BY_SKU` entry or they fall back to a theme default.
