# Bam Studio — online shop

The storefront for Bam Studio: 3D-printed fidget clickers, charms and a
build-your-own name charm, printed to order in Sydney.

- **Framework:** Next.js 16 (App Router, React 19, TypeScript)
- **Styling:** Tailwind CSS v4, design tokens in `app/globals.css`
- **Database & accounts:** Supabase (Postgres + Auth, Google + email)
- **Payments:** Stripe Checkout + webhook
- **Transactional email:** Resend, over plain `fetch` (no client library)
- **Hosting:** Vercel

## Run it locally

```bash
npm install
cp .env.example .env.local     # fill in the keys — see SETUP.md
npm run dev                    # http://localhost:3000
```

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
  about/ faq/ contact/ legal/ not-found.tsx
  api/
    checkout/                 creates the Stripe Checkout Session
    webhooks/stripe/          records paid orders (service role), sends the
                              order-confirmation email via after()
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
  types.ts  format.ts  stripe.ts  safe-next.ts  supabase/
supabase/
  migrations/0001_init.sql    THE schema — RLS policies, helper functions,
                              grants. (There is no `schema.sql`.)
  seed.sql                    catalogue, generated from the workbook
  verify.sql                  schema smoke test — every row must print `t`
scripts/
  generate-seed.mjs           regenerates seed.sql + fallback-data.ts
  verify-sql.sh               applies the schema + seed + verify.sql to a
                              local Postgres 16 and checks every assertion
  replay-checkout.mjs         replays the real CartView payloads at /api/checkout
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

./scripts/verify-sql.sh          # schema + seed + assertions on local Postgres 16
node scripts/replay-checkout.mjs # replay the real client baskets at /api/checkout
```

Neither script is optional after a change to checkout or the schema, and
neither reads the way you expect: in the checkout replay **HTTP 502 is the
pass** (validation succeeded and the call reached Stripe, where the dummy key
fails), and its last case is a negative control that must be **rejected with
400** — if that one passes, the harness is not testing anything. `WORKLOG.md`
§4 and `CLAUDE.md` have the full protocol and the reasons behind it.

## Known limitation worth reading before launch

`lib/rate-limit.ts` is in-memory and per-instance, and `clientKey()` trusts
`x-forwarded-for`. It is now the **only** thing in front of `/api/track`, which
returns a customer's postal address for an order number plus the matching email
— and order numbers are a sequence plus four hex characters. Move it to Vercel
KV or Upstash before launch; the call sites do not change. `WORKLOG.md` §6 has
the rest of the open list.
