# Bam Studio — online shop

The storefront for Bam Studio: 3D-printed fidget clickers, charms and a
build-your-own name charm, printed to order in Sydney.

- **Framework:** Next.js 16 (App Router, React 19, TypeScript)
- **Styling:** Tailwind CSS v4, design tokens in `app/globals.css`
- **Database & accounts:** Supabase (Postgres + Auth, Google + email)
- **Payments:** Stripe Checkout + webhook
- **Hosting:** Vercel

## Run it locally

```bash
npm install
cp .env.example .env.local     # fill in the keys — see SETUP.md
npm run dev                    # http://localhost:3000
```

The app **runs with no database at all**: when the Supabase variables are
missing it serves a sample catalogue from `lib/fallback-data.ts`, so you can
browse, search and build a name charm immediately. Checkout needs real Stripe
keys.

Full step-by-step credentials and deployment guide: **[SETUP.md](SETUP.md)**.

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
  about/ faq/ contact/ legal/ not-found.tsx
  api/
    checkout/                 creates the Stripe Checkout Session
    webhooks/stripe/          records paid orders (service role)
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
  types.ts  format.ts  stripe.ts  supabase/
supabase/
  migrations/0001_init.sql    schema, RLS policies, helper functions
  seed.sql                    catalogue, generated from the workbook
scripts/generate-seed.mjs     regenerates seed.sql + fallback-data.ts
```

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
   from Stripe's own line items instead, so a paid sale is never lost.
4. `checkout.session.expired` deletes the abandoned `pending` row.

`pending` rows are excluded from the account order list and from guest
tracking — an unpaid checkout is not an order. `/order/confirmed` reads the
session's real `payment_status` and only claims an order is confirmed when
Stripe says it was paid; anything else keeps the basket intact.

If the order cannot be staged (a database blip), checkout **fails and expires
the Stripe session** rather than letting someone pay for an order we have no
record of and cannot print.

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
```
