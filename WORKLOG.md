# Work log — Bam Studio shop

Everything a new session needs to pick this up: what was built, what was found
wrong and fixed, what is deliberately still open, and how to verify any of it.

Last updated: 25 August 2026. Branch: `master`. Two pieces of work have landed
since the last docs pass: **round 8**, the move from Vercel to Fly.io, and
**round 9**, phase 1 of Australia Post postage — built, and deliberately **not
yet wired into checkout**. §0 has the current open list; §5 rounds 8 and 9 have
the reasoning; §7 has the commit state and what to distrust in it.

---

## 0. START HERE — the ten blockers, and exactly where they now stand

A final independent review (round 5, §5) found three security defects and one
class of false claims. A remediation pass (round 6, §5) addressed all ten
items, and adversarial verification of that pass found two further defects in
the fixes themselves. A second adversarial pass (round 7, §5) then found that
the §0.1 email fix had itself shipped four false statements, rebuilt the email
contract, and found six more defects on the way. **Both rounds are recorded in
§5 because the pattern, not the fix, is the lesson: every defect in rounds 6
and 7 was in brand-new code written to close a blocker.**

**Addressed is not the same as finished.** Two items are closed only for the
*claims* they made; the capability behind the claim is still not built. Read
the status column literally rather than the number of ticks.

### The open list, as it stands today

This is the short version of §6, and the first thing to read. Nothing below is
a §0 blocker regression; they are the items a new session or the owner has to
act on next.

| # | Item | Who | Where |
|---|---|---|---|
| A | **Wire `quoteBasket()` into checkout.** `lib/shipping/` is built and verified against the live Australia Post API, and **nothing imports it** — `app/api/checkout/route.ts:499` still calls the flat-rate `shippingCost()`. Until it is wired, postage is the old flat $9.50 / $14.50 | agent | §5 round 9, §6 |
| B | **`scripts/verify-sql.sh` applies only `0001_init.sql`, and `verify.sql` now asserts against `0002_shipping.sql`.** So the SQL harness **cannot pass as it stands** — the run would error on `shipping_rate_cache` and on the new product columns. Fix the script before trusting any SQL claim | agent | §4 |
| C | **Weigh three items and give the real numbers** — one name charm, one clicker keychain, one pet bowl, each in the mailer actually used: grams, and thickness in mm. **Every** weight and dimension in `lib/shipping/dimensions.ts` and in the seed is a reasoned estimate today. These three readings are the single highest-value input to postage accuracy | **owner** | §6 backlog |
| D | **Decide: cheap-untracked or dearer-tracked.** Every product is `letter_eligible: false`, so everything quotes as a tracked parcel — which overcharges slightly and never undercharges. Large Letter is $3.40 against ~$10.20, and is **untracked and uninsured**. Enabling it is a per-row toggle in Supabase **plus** the `transitLabel()` fix in item E. This is a business decision, not a code one | **owner** | §6 |
| E | **`transitLabel()` in `lib/config.ts` hardcodes "· tracked".** True only while everything ships as a parcel. It **must** be fixed in the same change that ever enables Large Letter, or the site tells customers untracked mail is tracked | agent | §6 |
| F | **The Supabase JWT secret does not appear to have been rotated.** The previously-exposed anon key still authenticates, so the leaked `service_role` key is very likely still live. **Outstanding security action** | **owner** | §6 |
| G | **`AUSPOST_API_KEY` is a new runtime secret** — free, self-serve, instant from developers.auspost.com.au. It is a **Fly secret, never a build arg**. Without it postage still works: it falls through to the deliberately pessimistic fallback table | **owner** | §6, `SETUP.md` |
| H | **Delete the Porkbun parking wildcard.** `bamstudioshop.com` is registered, but DNS still carries `*` CNAME → `uixie.porkbun.com`, which shadows email records | **owner** | `SETUP.md` Step 5f |
| I | **The rate limiter is still one process's memory.** Round 8 fixed *which IP it reads*; it did not make it durable. Still the only thing in front of `/api/track` | agent | §6 |

| # | Status | What it was, and where it stands now |
|---|---|---|
| 1 | **Closed for the claims — and the fix itself had to be rebuilt** | No email was ever sent while ~40 places said one was. `lib/email.ts` now posts to the Resend API directly with `fetch` (no npm dependency, 8s timeout, never throws) and the Stripe webhook sends a real itemised confirmation. Round 6 gated the *claims* on a separate public flag, `SHOP.canSendEmail` / `NEXT_PUBLIC_EMAIL_ENABLED`; **that was a defect and round 7 removed it** — two switches for one fact shipped four more false statements (§5 round 7). The single source of truth is now `isEmailConfigured()`, the same condition `sendEmail` checks. **The real remedy is still not the email**: `/order/confirmed` shows the guest their order number, so an order is trackable whether or not mail is configured. Still open behind this: the newsletter has **no subscriber list** (see 9 and §6) |
| 2 | **Closed** | `lookup_order` was granted to `anon`, so it was callable straight over PostgREST with the public key and `/track`'s throttle was decorative. Revoked from `anon` and `authenticated`, granted to `service_role` only, with an explicit `revoke execute` so the migration also closes the hole on an **already-deployed** database. `/api/track` moved to the admin client and now allow-lists the fields it returns, dropping the customer's `phone` from the wire entirely. Five new grant assertions in `verify.sql` |
| 3 | **Closed, re-verified** | Open redirect in `lib/safe-next.ts`. Was already fixed; **independently re-verified this session** against the real `safeNext` — 41 named payloads plus ~192,000 fuzz cases, zero bypasses, and `/reset-password` still matches exactly, so the recovery-cookie gate is intact |
| 4 | **Closed** | A transient read error stranded a paid order invisibly. The staged-row SELECT now binds and checks its error; the `23505` path no longer returns a blanket 200 but re-reads and returns 200 **only** when it can prove the existing order is genuinely finished — past `pending`, numbered, stock claimed, has items. Several other swallowed errors in the same file were closed with it |
| 5 | **Closed** | Stripe live + Supabase absent took money and recorded nothing. New guard in `app/api/checkout/route.ts`, deliberately scoped to `NODE_ENV === "production"`. **That scoping is load-bearing — §4 says why. Do not make it unconditional** |
| 6 | **Closed** | `[HELLO@YOURDOMAIN]` was hardcoded in the legal pages, bypassing `SHOP.hasSupportEmail`. Every rendered placeholder is now a gated fallback chain: real mailbox → social handles → a plain statement that no contact address has been published yet |
| 7 | **Closed** | The `stock_applied` backfill marked *stranded* orders applied, so the repair branch could never move their stock. Predicate narrowed to orders that demonstrably finished (`order_number is not null` **and** has `order_items`). Verified against real PostgreSQL 16 by re-applying the migration over seeded data |
| 8 | **Closed** | A repaired order lost what to print, and could double-insert items. The existence-probe error is now checked; `listLineItems` uses `expand: ['data.price.product']`; checkout stamps `metadata: { slug }` on the Stripe line because **`short_name` is not unique** and the webhook prefers the slug with a name fallback for older sessions. Recovered variant data is validated against the product's own colour and attachment lists and left **null** when ambiguous, never guessed |
| 9 | **Partly closed** | Marketing consent is now unticked by default, and PII is out of the contact and newsletter logs. "Delete account" now describes what it actually does — which is nothing: it files a request by hand. **Real account deletion is not built** and needs a service-role admin route, re-authentication and an in-flight-order guard. §6 carries it |
| 10 | **Closed** | "Free shipping" was stated unqualified but only ever applied to standard post. Qualified everywhere, and the cart now derives the claim from `shippingCost()` for the **selected** method, so it can no longer say "Free shipping unlocked" while Express is selected and charged $14.50 |

Lower-severity items from round 5 (uncapped "Only N ready to ship", no quantity
cap in the cart, **no CSP**, inert `revalidate`, the recovery cookie keyed on
`next` rather than the flow) are still open and still not launch-blocking. That
list used to say "empty `next.config.ts`" — it is no longer empty, it sets
`output: "standalone"` for the Fly image (§5 round 8), but it still declares no
security headers.

### What is verified by execution, and what is only verified by reasoning

This distinction matters more than the status column, and it is the thing a
green check is least able to tell you.

**Run, and observed to pass:**

- `./scripts/verify-sql.sh` — the migration, the seed and `verify.sql` applied
  to a real local PostgreSQL 16 from an empty database. **24/24 assertions
  `t`**, including the five grant assertions (three for `lookup_order`, two for
  the confirmation lookup) and the §0.7 backfill predicate, exercised over a
  seeded stranded order and a seeded finished one.

  **That 24/24 is now historical, and the harness is currently broken.**
  `verify.sql` has grown to **29 assertions** — the two new product-measurement
  checks and three rate-cache grant checks came with `0002_shipping.sql` — but
  `scripts/verify-sql.sh` still applies `0001_init.sql` only (`grep -n 0002
  scripts/verify-sql.sh` returns nothing). A run today errors on
  `shipping_rate_cache` and on `products.weight_grams` rather than printing a
  table. **29/29 has never been observed.** Teaching the script to apply `0002`
  after `0001` is the whole fix, and it is item B in the list above.
- **The anon-privilege denial, against real Postgres.** `permission denied for
  function lookup_order` for both `anon` and `authenticated`; a row returned
  for `service_role`. Run on a fresh database *and* on a simulated
  already-deployed one, which is what proves the explicit `revoke execute`
  closes the hole rather than merely not opening it.
- `node scripts/replay-checkout.mjs` — **7/7**: the six real
  `CartView.checkout()` baskets plus the negative control, against a running
  dev server.
- **The webhook behavioural harness — 43/43.** The real route module against a
  fake Supabase client and a fake Stripe, asserting on the calls made and the
  status returned. **It lives in `/tmp/webhook-harness/` and will not survive
  this session** — see §4 for what it covers, so it can be rebuilt.
- **An 80-page browser crawl across four configuration states** (no email +
  no mailbox, email only, mailbox only, both), with zero failed assertions.
  This is what would have caught the round-7 false statements earlier.
- `safeNext` (item 3) — 41 named payloads and ~192,000 generated cases, run
  against the real exported function, not a copy of it.
- `npx tsc --noEmit`, `npx eslint .`, `npm run build`.

**Reviewed by reading only — believed correct, not demonstrated:**

- **Real Resend delivery.** Nothing here has ever put a message in a mailbox.
  The 43-scenario harness proves *when* a send is attempted and with what body;
  it stubs the provider.
- **A real Stripe session end to end.** The webhook harness feeds the route
  synthesised events in Stripe's shape, and `recoverVariant` and the rebuild
  path were exercised against them — but never against a payload a genuine
  Stripe account produced, because that needs the owner's keys.
- That `price_data.product_data.metadata.slug` survives the round trip and
  comes back under `expand: ['data.price.product']`. That is what Stripe
  documents; it has not been observed here. **If this is wrong, item 8's fix
  silently degrades to the name fallback** — which is the ambiguous path it
  exists to replace. Check it with the first real test order.
- Real Resend delivery, and whether `EMAIL_FROM`'s domain is verified.
- **`after()`'s behaviour on the deployed Fly machine** — whether the queued
  confirmation email reliably completes. The hosting move (round 8) changed the
  shape of this risk rather than removing it: there is no longer a serverless
  instance that freezes, but a machine that stopped or suspended would drop the
  send in exactly the same way, which is why `fly.toml` pins the machine on. The
  first real order is what tests it.
- Grants on a **hosted** Supabase project. The migration is the only thing that
  has been tested; a project where someone has since granted something in the
  dashboard is outside what `verify.sql` was run against.

---

## 1. What this is

The online shop for Bam Studio, a pre-revenue Australian sole trader selling
3D-printed fidget clickers, charms and a build-your-own name charm. Catalogue
and costing live in `../Documents/3D_Planner.xlsx`.

**Stack:** Next.js 16 (App Router, React 19, TypeScript), Tailwind v4,
Supabase (Postgres + Auth incl. Google), Stripe Checkout, **deployed as a Docker
image on Fly.io** — one always-on 512 MB machine in `syd`, ~A$6/month. It was on
Vercel until round 8; §5 round 8 records why it moved and what was measured.
All money is integer cents (AUD).

**Design source:** `../shop-design/v2/` — the 27 approved screens as
`.dc.html` artboards, generated by `node build.mjs` from six `.mjs` modules.
`node preview.mjs` writes `preview/` as plain HTML you can open in a browser;
start at `preview/index.html`. Style: Etsy-like, Poppins + Nunito Sans,
illustrated product art standing in for photos.

The design was also published as a Claude Design canvas during this work, but
**that link is dead** — the artifact no longer exists on the account. Nothing
was lost: the local files above are the source it was generated from, and
re-publishing is a re-run of the seed step, not a redesign. Don't chase the
old URL if you find it referenced in the conversation history.

**Read before changing anything:** `AGENTS.md` — this Next version has real
breaking changes vs. most training data (`middleware` is renamed `proxy`;
`params`/`searchParams` are async). `README.md` covers architecture,
`SETUP.md` the deployment steps.

## 2. Hard business rules

These are not preferences. Breaking one is a real-world problem, not a bug.

| Rule | Why | Where it lives |
|---|---|---|
| **No licensed characters, ever** | Listing one gets shops pulled from marketplaces | `LICENSED_SKUS` in `scripts/generate-seed.mjs` (Hello Kitty is filtered) |
| **Not GST-registered** | Under the $75k threshold. Showing GST you don't collect misrepresents the price | `SHOP.gstRegistered` gates every GST surface |
| **No invented reviews, ratings or stock** | ACCC treats fabricated reviews as misleading conduct | Seed emits `rating 0`, `review_count 0`, `stock_on_hand 0` |
| **Everything is printed to order** | 2–4 business days before dispatch — that is *not* delivery time | `PRINT_LEAD_TIME` |
| **Personalised items are non-returnable** | Except when faulty | Consistent across product page, cart, builder, FAQ, refunds policy |
| **Prices are recomputed server-side** | The client says which product and how many, never what it costs | `app/api/checkout/route.ts` |

## 3. Architecture worth knowing

**The catalogue is generated.** `node scripts/generate-seed.mjs` reads the
workbook and writes both `supabase/seed.sql` and `lib/fallback-data.ts`. It
reads `BUILDER_PRICING` out of `lib/config.ts` so a builder product can never
advertise a price the builder cannot charge. Re-run it after editing the
workbook, then re-run `seed.sql`.

**The app runs with no database.** Missing Supabase env vars → the bundled
sample catalogue. This is an intended mode, not a failure mode; a "strict"
guard that broke it has already had to be re-fixed once (see §5, round 3).

**Order lifecycle.** Checkout creates the Stripe session *and* stages the
basket as a `pending` order keyed by `stripe_session_id` (Stripe metadata caps
at 500 chars per value — far too small for a basket). The webhook promotes it
to `confirmed`. If staging fails, checkout **expires the session and fails**
rather than taking money for an order it cannot print. If the database was
unreachable at checkout, the webhook rebuilds from Stripe's line items using a
compact `slug:qty` map left in metadata.

**Two personalisation modes**, in `products.personalisation_mode`:
`builder` (keycap letters, priced by length, at `/builder?product=<slug>`) and
`text` (one free-text line on the product page, priced at the product price).
Checkout refuses a builder payload on anything that isn't builder mode.

**The email contract — one switch, and the predicates on top of it.**
`isEmailConfigured()` in `lib/email.ts` is
`Boolean(RESEND_API_KEY && EMAIL_FROM)`, the same expression `sendEmail` itself
checks, so a claim on a page and the capability behind it cannot disagree.
There is no public mirror; `SHOP.canSendEmail` and `NEXT_PUBLIC_EMAIL_ENABLED`
were removed in round 7 and `lib/config.ts` carries a comment at the spot. It
**throws in the browser** rather than answering `false` — a hand-rolled
stand-in for `import "server-only"`, which is not a dependency here — so a
server component calls it and a client component takes a `canSendEmail`
boolean prop; `app/account/settings/page.tsx` is the one threading site.

`lib/contact.ts` holds everything built on it, in one definition each:
`hasStudioMailbox`, `hasSocialAccount`, `canReachStudio`,
`formsReachStudio(canSendEmail)`, `sendsOrderConfirmation(canSendEmail)`,
`socialLinks`. **`sendsOrderConfirmation` is the secrets alone**; the webhook's
itemised confirmation has no dependency on the studio mailbox.
**`formsReachStudio` additionally needs `NEXT_PUBLIC_SUPPORT_EMAIL`**, because
the contact form and the newsletter box deliver *by emailing* it. Anding the
two into one test is the round-7 defect.

**Postage is quoted from Australia Post, in `lib/shipping/` — and nothing
imports it yet.** Seven modules, one entry point: `quoteBasket(lines, methodId)`
in `lib/shipping/quote.ts`, resolving cache → live API → a pessimistic fallback
table, never throwing and never returning zero for a non-empty basket. The
supporting facts, all verified against the live API on 25 August 2026:
**domestic parcel price does not vary by destination postcode** (checked across
eight postcodes — postcode affects service *availability* only), so a basket can
be priced on page one with **no customer address at all**; there is **no cubic
weighting**, so dimensions decide validity and Large Letter eligibility, never
price; prices are **GST-inclusive retail** and the shop is not GST-registered, so
the total passes through and no GST component may ever be shown against it.
`supabase/migrations/0002_shipping.sql` adds five product columns, the
`shipping_rate_cache` table (revoked from `anon` and `authenticated`) and three
quote-provenance columns on `orders`. **The wiring into `app/api/checkout/route.ts`
is not done** — §5 round 9 has the full record and §6 the remaining work.

**Deployment is a Docker image on one always-on Fly machine**, built on Fly's
remote builder because `next build` needs ~1.6 GB and the machine has 512 MB.
`output: "standalone"` means the server **reads no `.env` file**: every
`NEXT_PUBLIC_*` value is a build arg baked into the bundles (rebuild to change),
everything secret is a Fly secret read per request (restart to change).
`fly.toml`'s always-on settings are a correctness constraint, not a cost
setting. Round 8 in §5 has the numbers and the reasoning; `README.md` has the
architecture and `SETUP.md` the runbook.

**Nothing declares `export const dynamic`** except `force-dynamic` on the
Stripe webhook route, and that is for the raw body. The claim-making pages are
rendered per request only because the **root layout awaits `getUser()` →
`cookies()`**, which opts the whole tree out of static prerendering — the
build's prerender manifest holds only `/_global-error` and `/favicon.ico`. Each
of those pages reads its capability at module scope, so the protection is
incidental: change the layout's auth read and a build-time answer gets baked
into a legal document.

## 4. How to verify — do this, don't trust the diff

Three times in this work a *fix* introduced a regression. Two were caught only
because the real payloads were replayed. The lesson, concretely:

**Test the payload the client actually builds, not one you write by hand.**
Both checkout blockers in round 2 passed hand-written API tests and were still
completely broken, because `CartView` sent a different shape.

Both checks below are now scripts, so there is nothing to reconstruct by hand
and nothing to get subtly wrong.

### The checkout replay

```bash
# 1. Static checks
npx tsc --noEmit && npx eslint . && npm run build

# 2. Run it with a dummy Stripe key so validation runs but no charge can occur
printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev

# 3. In a second terminal, replay the payloads the client actually builds
node scripts/replay-checkout.mjs
```

`scripts/replay-checkout.mjs` POSTs the exact JSON `CartView.checkout()` sends
— key order and omitted-vs-null included — for seven cases: all four
personalised products (`custom-name-charm` and `alphabet-bag-charm-on-cord` in
builder mode, `custom-number-date-chain` and `personalised-bowl-with-pet-s-name`
in text mode), an ordinary product, a five-line mixed basket, and **a negative
control**.

**Read the results inverted. HTTP 502 is the pass**: with a dummy Stripe key
the request is meant to die at Stripe, so 502 means every server-side
validation accepted the basket. 400/409 mean it was rejected; 503 means the app
is misconfigured.

**Case 7 is the negative control and it is what makes a green run mean
anything.** It puts free-text personalisation on an ordinary product, which
checkout must refuse: it expects **400**. If that case also returns 502, the
harness is not observing validation at all and every PASS above it is
worthless — the script says so in as many words. A run without a failing
negative control is a run that has proved nothing.

The route rate-limits to 10 requests per 60s per IP and the script sends 7, so
it spaces them by `DELAY_MS` (default 1000) and **aborts on a 429** rather than
reporting throttling as failures. `BASE_URL` (default `http://localhost:3000`)
points it at another deployment. Two runs back to back will trip the limit —
wait a minute or raise `DELAY_MS`.

A validation failure on one line rejects the **whole basket**, which is exactly
how two previous blockers hid, so the mixed basket is not optional.

### The webhook harness — 43 scenarios, and it is not in this repo

Neither script below touches `app/api/webhooks/stripe/route.ts`, which is the
highest-consequence file in the project. Round 7 built a behavioural harness
for it: the real route module loaded against a fake Supabase client with a
seeded fake database and a fake Stripe, asserting on the calls the route makes
and the HTTP status it returns. **Last run 43/43.**

**It lived in `/tmp/webhook-harness/` (a loader, a Supabase stub, the
scenarios, a typecheck) and does not survive the session that wrote it.** If it
is gone, that is expected — rebuild it rather than assuming the path is
covered. What it covers:

- every `23505` duplicate-insert path — existing row genuinely finished, still
  pending/unnumbered/itemless, and the re-read itself erroring;
- a transient error at each formerly-swallowed site: the staged-row SELECT, the
  order-items probe, the products lookup, the confirming compare-and-set, the
  order-number pre-read, the stock claim, both `decrement_stock` RPCs, the
  rebuild insert, the staged-row delete;
- duplicate delivery of one event, and a genuine concurrent winner mid-flight
  (first retry 500, next 200);
- two rows sharing a `stripe_session_id` (PGRST116 → 500);
- **zero line items from Stripe** — must not close the event;
- **unexpanded** line items (`price.product` is an id string) — nothing may be
  invented, the line still has to be written;
- **a segment matching both a colour name and an attachment label** — placed as
  neither;
- slug-versus-name matching, including a legacy line carrying no
  `metadata.slug`;
- the sentinel-email path — order still numbered and stocked, mail task queued,
  **no send attempted**;
- **a cancelled order** — not numbered, no stock claim, no decrement RPC, no
  mail, no writes at all, and still 200; and cancelled-and-itemless;
- a `confirmed`-but-unfinished and a `confirmed`-but-itemless order, both still
  repaired — which is what proves the terminal check is scoped to `cancelled`
  rather than to "anything past pending".

### The SQL

`supabase/verify.sql` asserts the guarantees that otherwise only fail in
production — most importantly that the webhook may allocate order numbers and
move stock (without those grants customers pay and **no order is ever
recorded**), and that `lookup_order` is *not* reachable by `anon`. Every row
must print `t`. Paste it into the Supabase SQL editor after setup, and locally:

```bash
./scripts/verify-sql.sh
```

> ⚠️ **The script is currently out of step with the file it runs.**
> `verify.sql` is now **29 assertions** and its header says to apply
> `0001_init.sql`, `0002_shipping.sql` *and* `seed.sql`. `scripts/verify-sql.sh`
> still applies `0001` only, so a run today errors on `shipping_rate_cache` and
> on `products.weight_grams` instead of printing a table. **29/29 has never been
> observed.** Teach the script to apply `0002` between the migration and the
> seed before you trust — or report — any SQL result.

One command, self-bootstrapping. It drives a **locally installed PostgreSQL
16** (`apt install postgresql-16`) — `initdb`s a disposable cluster outside the
repo on first run, starts it on a unix socket, recreates the database from
empty, applies the Supabase stand-ins the migration needs (the `anon` /
`authenticated` / `service_role` roles, `auth.users`, `auth.uid()`, `pgcrypto`),
then applies the migration and the seed, runs `verify.sql`, prints the
assertion table and **exits non-zero if any row is not `t`** — so it can gate a
release. It refuses to run on any server that is not 16.

> **The schema file is `supabase/migrations/0001_init.sql`.** There is no
> `supabase/schema.sql`. This document and `CLAUDE.md` both used to say to pipe
> `schema.sql`, and that cost someone real time — the migration *is* the
> schema.

Docker remains the alternative where a local Postgres is not wanted, but note
that Docker was unavailable in the environment this was last verified in, which
is why the script exists:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), and the service_role/anon/
# authenticated roles first, then pipe supabase/migrations/0001_init.sql,
# supabase/seed.sql and supabase/verify.sql through
# docker exec -i pg psql -U postgres
```

### Why the §0.5 checkout guard is scoped to `NODE_ENV === "production"`

`app/api/checkout/route.ts` refuses checkout when Stripe is configured and
Supabase is not — otherwise a real charge succeeds, no order row is ever
written, and `/order/confirmed` still tells the customer their order is
confirmed. That guard is **deliberately inert outside production**, and the
scoping is not timidity. It is there because of this:

**The only end-to-end verification this project has runs the app with no
database at all.** The checkout replay above is a dummy Stripe key, no Supabase
env, and the real `CartView` payloads against `/api/checkout`. An unconditional
guard turns all seven of those cases into a 503 that never reaches the
validation being tested — the harness goes quiet and *looks* fine, because a
503 is not a crash.

This has already happened twice. §5 round 3 and round 4 are both a "strict"
guard that could not tell *"the database returned an error"* from *"there is no
database"*, and both had to be re-fixed. Round 4's rule is the constraint that
came out of it, and it still holds: **a guard may reject a query error, never
the absence of a database.** Running with no database is an intended mode
(§3, `CLAUDE.md`), not a failure mode.

Outside production the key in use is a test key and no real money can move, so
the trade is one-sided: guard where the charge is real, stay out of the way
where it is not. The reasoning is repeated in a comment at the guard itself.
**Do not "tidy" it into an unconditional check.** That would be the fourth
time, and it would silently disable the one test that has caught three
regressions.

---

## 5. Review history

Seven review rounds, then a hosting migration. Rounds 1–7 were each an
independent full-codebase pass, then fixes, then re-verification. Round 6 is the
remediation of §0 and the adversarial pass over those fixes; **round 7 is the
adversarial pass over round 6, and it found that the §0.1 email fix had
reproduced the defect class it was closing.** If you read only one, read 7 — its
closing paragraph is the design rule. **Round 8 is not a review**: it is the
move from Vercel to Fly.io, recorded here because three of its findings are
constraints on future code.

### Round 1 — first full review

| Finding | Resolution |
|---|---|
| **Any product buyable for $3** by attaching a fake `custom` block | Checkout rejects `custom` on non-builder products; colourway resolved server-side |
| Stock decremented twice on webhook retry (0-row UPDATE reports no error) | Row-count checked, later replaced by a `stock_applied` compare-and-set |
| **GST displayed while not GST-registered** | Gated behind `SHOP.gstRegistered` |
| Order numbers sequential from 1042 and issued at checkout — enumerable, and burned by abandoned baskets | Allocated on payment, with a random suffix |
| Reviews: any signed-in account could post one on any product with `verified: true` | Insert policy withdrawn entirely (no review UI exists yet) |
| Fabricated "4.9 rating", invented per-product reviews and stock | All removed; seed emits zeros |
| Attachment filter applied *after* pagination — counts and pages disagreed | Pushed into the query as a jsonb containment test |
| `/reset-password` changed the password from the session alone | Requires the current password unless a recovery cookie is present |
| Sign-up revealed which addresses were registered | Already-registered now indistinguishable from success |
| Transit ranges, payment badges, support address hardcoded in several places | All sourced from `lib/config.ts` |

### Round 2 — verification found two blockers *introduced by round 1*

Both were mine, both from the colour-validation and personalisation work, and
both failed the **entire basket**, not just the affected line.

1. **Builder charms unbuyable.** `BuilderClient` sends the colourway in the
   `colour` field; builder products have no colour list, so the new validation
   400'd every name charm. → Colour is now resolved per branch: a builder line
   takes it from the collections table it was already validated against.
2. **Text personalisation unbuyable.** `CartView` never forwarded
   `personalisation_text`, which checkout requires. → Forwarded, as
   `?? undefined` (not `?? null` — the schema is `.optional()`, and sending
   `null` from an ordinary line would reject the whole basket).
3. **Two names merged into one basket line** — two bowls charged, both printed
   "Mochi". → `lineKey` now includes the personalisation.

Also closed: webhook could delete a confirmed paid order (delete wasn't scoped
to `pending`); `/api/search/suggest` unthrottled over a leading-wildcard scan;
`/login` distinguished a wrong password from an unknown address; guest
favourites never merged on sign-in; placeholder support address was a live
`mailto:`.

### Round 3 — schema robustness (self-initiated)

The migration is all `create table if not exists`, so re-running it on an
existing database silently skipped every column added since — and `SETUP.md`
tells you to paste and run that file. An upgrade block now brings an existing
database up to date. Added `supabase/verify.sql`. Both exercised against a
real PostgreSQL 16.

### Round 4 — verification found two launch blockers, plus a third self-inflicted

1. **Paid orders could be stranded forever.** Database down at checkout *and*
   the webhook dying mid-rebuild → every retry hit the "confirmed but empty"
   branch and returned. Customer paid; no order number, nothing to print, no
   recovery. → That branch now repairs in place; the item rebuild is shared
   with the fresh-insert path.
2. **`stock_applied` not backfilled.** Orders confirmed before the column
   existed read as unclaimed → a Stripe redelivery would double-decrement.
   → Backfilled in the upgrade block. Verified against real Postgres.
3. **Self-inflicted, caught in a minute:** making `getCollections` strict
   caused it to throw when Supabase simply isn't configured, re-breaking the
   builder in the sample-catalogue mode. → Strict now only rejects a *query
   error*, not the absence of a database.

Also: favourites reconcile installed its memo after an `await`, so every heart
on `/shop` started its own round trip (~24 per load); the builder ignored
attachment price deltas; and `verify.sql`'s own compare-and-set check ran both
claims in one statement, so it printed `t` without testing the race.

---

### Round 5 — final verification (the findings in §0)

Confirmed round 4's two blockers are genuinely closed: the repair branch
terminates without looping, renumbering or double-decrementing, and the
`stock_applied` backfill was exercised against real PostgreSQL 16 (a shipped
order is protected, a pending one untouched). Checkout was re-verified for all
four personalised products across every combination of database-configured,
query-succeeding and query-erroring; builder pricing cannot be steered by the
client; the favourites rewrite makes one round trip for many buttons and
cannot write after sign-out.

It then found what §0 lists. The pattern worth noting: **the serious defects
were not in the code being fixed.** Rounds 1–4 each reviewed the payment path
and each found real problems there; round 5 looked wider and found an open
redirect, a directly-callable Postgres function that leaks home addresses, and
a dozen user-facing statements that are simply untrue because no email is ever
sent. None of those would have been caught by testing checkout harder.

Two of the three security defects are in code written during this work
(`lookup_order`'s `anon` grant, and the swallowed SELECT error), which is the
argument for the next session starting with a security-focused pass rather
than a feature.

### Round 6 — remediating §0, and an adversarial pass over the remediation

All ten §0 items were worked (statuses and the honest caveats are in §0). The
part worth keeping is not the fixes; it is what the pass over the fixes found.
**Both defects below were in brand-new code written to close a blocker, and
both would have shipped**, because the code they were in reads perfectly well.

1. **A paid order could still finish with nothing to print.** If Stripe
   returned **zero** line items on the rebuild path, `fillItemsFromStripe`
   inserted nothing, reported success, and let the caller confirm the order,
   allocate its number and spend its stock claim — then returned **200**, which
   tells Stripe to stop retrying. A paid, confirmed, numbered order with no
   record of what to print, and no further deliveries coming. A paid Checkout
   Session always has line items, so an empty list is a failed read of Stripe,
   not an empty basket. It now throws.
2. **`recoverVariant` invented a product the customer never ordered.** A
   segment matching **both** a colour name and an attachment label was
   attributed to the attachment, because the attachment list was tried first.
   That silently added a finding nobody chose *and* dropped the colour — the
   wrong thing gets printed and posted. Such a segment is now placed as
   neither; `variant_label` still holds the raw string, so the packing list
   shows what was actually bought.

The pattern is the same one round 5 named, one level in: **the defects were not
in the code being reviewed, they were in the code being written to fix it.**
Rounds 1–5 each hardened the payment path and each found real problems there;
round 6's two were reached only by asking what the *new* code does on inputs
nobody had pictured — Stripe answering with an empty list, and a colour named
the same as a finding. Neither is exotic; both are one product-catalogue edit
away.

Also closed in this round, none of them in §0, all found by reading the paths
the fixes touched: `assignOrderNumber` consumed the order-number sequence on
every duplicate Stripe delivery (the `await` sat inside the update payload, so
the number was allocated before the compare-and-set matched nothing) and had no
`.select()`, so a silent no-op and a real assignment were indistinguishable;
`decrementStock` logged and continued past a failed decrement with the stock
claim already spent, making the drift permanent and invisible; the staged-row
delete discarded its error and fell into the insert that the undeleted row was
still blocking; and the products lookup on the rebuild path discarded its
error, defaulting every line to `art: "macaron"`, `tint: "cream"` and a null
`product_id` — an order that looks complete, links to nothing and prints the
wrong artwork.

### Round 7 — the round-6 email fix was itself shipping false statements

Round 6 closed §0.1 by gating every email claim on a **public** flag,
`SHOP.canSendEmail` reading `NEXT_PUBLIC_EMAIL_ENABLED`, kept in step by hand
with the private `RESEND_API_KEY` / `EMAIL_FROM` capability. §0.1's whole
subject was a shop saying something it did not do. **The fix reintroduced that,
one level in.** Two switches for one fact can disagree, and in the launch
configuration they did:

- the **Terms of Service**, the **Privacy Policy** and the **account settings
  page** each stated that the shop sends no order emails — while the webhook
  was sending an itemised confirmation carrying line items, subtotal, postage
  and total paid;
- **Resend was disclosed as a data processor only when the support mailbox was
  also set**, because one predicate (`canSendEmail && hasSupportEmail`) was
  serving two different questions. In every configuration with the secrets but
  no mailbox — a realistic partial setup, and the one an owner reaches first —
  customer names, addresses, order contents and totals went to a US processor
  the privacy policy did not name. That is not a wording problem.

**The rebuild.** `SHOP.canSendEmail` and `NEXT_PUBLIC_EMAIL_ENABLED` are gone;
nothing reads the variable. `isEmailConfigured()` is the single source of
truth, it throws in the browser rather than lying, and client components take
the answer as a `canSendEmail` prop. `lib/contact.ts` is new and holds the six
predicates that were previously copy-pasted; crucially it keeps
`sendsOrderConfirmation` (secrets alone) and `formsReachStudio` (secrets **and**
mailbox) apart. §3 has the shape.

**Six further defects, found by the same adversarial method and all in code
written to close a blocker:**

1. **The empty-line-items hole.** If Stripe returned zero line items on the
   rebuild path, the order was confirmed, numbered, its stock claim spent, and
   the webhook returned **200** — a paid order with nothing to print, and
   Stripe told never to retry. A paid Checkout Session always has line items,
   so an empty list is a failed read of Stripe, not an empty basket. It throws.
2. **An invented fitting.** A variant segment matching **both** a colour name
   and an attachment label was attributed to the attachment, inventing a cord
   the customer never ordered *and* dropping the colour they did. Placed as
   neither now; `variant_label` still carries the raw string.
3. **A guard that did not guard.** `orders.email` is `NOT NULL`, so the rebuild
   path writes the sentinel `"unknown"`. The confirmation-email guard tested
   `!order.email` — which a truthy sentinel sails straight past, so the shop
   would have handed `"unknown"` to Resend as a recipient. It tests by name now,
   through `hasCustomerEmail()`.
4. **Cancelled orders were being resurrected.** Both `status !== "pending"`
   repair branches would number, stock-move and (once email existed) confirm a
   `cancelled` order on a late `async_payment_succeeded` — undoing a decision a
   person made on purpose. Scoped so **only `cancelled` is terminal**: the later
   fulfilment states (`printing`/`packed`/`shipped`/`delivered`) must stay
   repairable, or an interrupted delivery strands a real order. It returns
   **200 rather than throwing**, because no retry can make a cancelled order
   eligible and a 500 buys only an unbounded redelivery loop. **The money did
   arrive, so the refund is a manual job** — it logs at error level naming the
   order and the session, and `SETUP.md` tells the owner what to do.
5. **Hanging auth forms.** With no Supabase configured, `/login`, `/signup`,
   `/forgot-password` and `/reset-password` threw inside their async submit
   handlers; the rejection was unhandled, the pending state never reset, and the
   button sat on "Sending…" forever with no error shown — while
   `/forgot-password` had already told the customer to go and check their spam
   folder for a mail that was never sent. **All four** client forms now gate on
   `isSupabaseConfigured()`, disable their controls with an explanation
   rendered before the customer types anything, and reset pending state in a
   `finally`, so no path can leave a button stuck. `/reset-password` also
   gained an honest third branch: unconfigured now says accounts are not open
   yet, rather than claiming a link "has expired" when no email could ever have
   sent one. Its recovery-cookie waiver is unchanged and was re-checked by
   driving a browser with and without the cookie.
6. **The replay harness had a silent-drift bug.** It hardcoded `fallback-N`
   product ids, which are **positional** in the generated catalogue, and
   checkout resolves a line by `slug` while only echoing `product_id` back — so
   regenerating the catalogue could silently re-point every id and the harness
   would keep printing PASS while exercising different products than the ones
   it names. It derives the ids from `lib/fallback-data.ts` at run time by slug
   and **aborts with exit 3 rather than guessing** if a slug is missing.

**The lesson, stated once.** Round 6's was "the defects were in the code being
written to fix it". Round 7's is narrower and worse: **the round-6 fix
reproduced the exact defect class it was closing**, because "gate the claim"
was implemented as a second switch instead of as a single reading of the
capability. A claim and the capability behind it have to be the same
expression, or nothing keeps them true together. That is the design rule; the
rest of this section is its evidence.

### Round 8 — the hosting migration: Vercel → Fly.io

Not a review round. A move, forced by a licence term and then measured rather
than assumed. It is recorded here because three of its findings are constraints
on future code, not deployment trivia.

**Why it moved.** Vercel's Hobby plan forbids commercial use, and its own
example of commercial usage is "any method of requesting or processing payment
from visitors of the site" — which is the entire purpose of this repo. The
compliant option there is Pro at US$20/developer/month. Fly.io in the `syd`
region on a 512 MB machine is about **A$6/month**, is the only managed option
with a **Sydney** region, and keeps a **long-lived Node process** — which this
app needs for two reasons that are both in this log already: the confirmation
email is sent from `after()`, and the rate limiter is an in-process `Map`.

**New and changed files:** `Dockerfile`, `fly.toml`, `.dockerignore`,
`.github/workflows/deploy.yml`, `app/api/health/route.ts` are new;
`next.config.ts`, `lib/stripe.ts`, `lib/rate-limit.ts` and `proxy.ts` changed.

**The measured numbers.**

| What | Measured |
|---|---|
| `next build` peak | **~1.6 GB RSS** — cannot build on the 512 MB app VM, and not reliably on 1 GB |
| Running server | **~150 MB RSS** — comfortable in 512 MB |
| Standalone tree | **~72 MB on disk, ~24 MB gzipped** (`tar \| gzip` measured 23.9 MB) |
| `node_modules` | **629 MB** — which is what `output: "standalone"` exists to avoid shipping |

So builds run on Fly's remote builder (`fly deploy --remote-only`, which the CI
workflow uses) and the machine only ever runs the finished server.

**`NEXT_PUBLIC_SITE_URL` does not behave the way its name suggests — and this
contradicts an earlier note in this repo.** Measured, three ways:

- Turbopack **constant-folds** it into the server bundle. In the built tree
  `siteUrl()` compiles to `function(){ return "https://…".replace(/\/$/,"") }`
  inside `.next/server/chunks/lib_stripe_ts_*.js` — the `process.env` read and
  the throw branch are both gone from the compiled output.
- At runtime the variable is **ignored**. The built server booted with a
  *different* value still emitted the value it was built with; booted with the
  variable *removed* it did **not** throw — it served the baked one.
- It is **not** in `.next/static`, so nothing leaks to the browser.

The consequence is the one to carry forward: **changing the shop's domain
requires a rebuild and redeploy, not an env change and a restart.** Setting it
as a Fly secret does nothing. The `siteUrl()` throw therefore fires **at build
time only** (`metadataBase` calls it at module scope); that, plus the
Dockerfile's `test -n` guard, is what prevents a bad image existing at all.

**Two security-relevant changes.**

1. **`clientKey()` read the wrong IP, and on Fly that was exploitable.** It took
   the **first** `x-forwarded-for` value. Vercel's proxy *overwrites* that
   header; **Fly's proxy appends to it**, so on Fly the first value was just a
   string the caller chose — send one, get a bucket; send another, get another.
   Unlimited attempts, dressed as a rate limit. That matters because this
   limiter is the only protection on `/api/track`, which returns a customer's
   postal address to anyone holding an order number and the matching email.
   It now prefers **`Fly-Client-IP`**, gated on `FLY_APP_NAME` (set by the
   Machines runtime, never by a request, so the header cannot be believed
   off-Fly), and falls back to the **last** XFF hop — the only value a caller
   cannot write. Per Fly's docs the last XFF hop *on Fly* is the app's own
   shared address, identical for every caller, which is why `Fly-Client-IP` is
   used there rather than XFF. **This fixes which value identifies the caller.
   It does not make the limiter durable** — see §6.
2. **`/api/health` is new, and `proxy.ts` excludes it.** The endpoint is
   deliberately dependency-free: no Supabase, no Stripe, no network, no
   filesystem. `fly.toml` health-checks it every 15s for the life of the
   machine, so anything hung off it would be permanent background load — and a
   check that fails when a *dependency* fails would have Fly restart a healthy
   machine because Supabase blinked, which restarting cannot fix. The matcher in
   `proxy.ts` now excludes `api/health` alongside `api/webhooks`, because every
   matched request runs `supabase.auth.getUser()`; leaving it matched would
   spend Supabase free-tier request budget continuously on a request that
   carries no cookies and can never be signed in.

**One `fly.toml` decision that is a correctness constraint, not a cost setting.**
`auto_stop_machines = "off"`, `auto_start_machines = false`,
`min_machines_running = 1`. Two things live only in the machine's memory: the
`after()` email task, which by definition runs after the response has been
flushed and which Fly's proxy cannot see (Fly documents this trap in as many
words), and the rate limiter's `Map`, which a stop resets — handing an attacker
their full retry budget back for free. **`suspend` is not a middle ground**: it
snapshots RAM, so the limiter would survive, but the machine resumes believing
sockets are live that the other end has abandoned — which is exactly the
in-flight Resend request. It keeps the state and breaks the socket. If this app
ever needs to scale to zero, both problems must be fixed first: a durable queue
for the email, shared storage for the limiter. `kill_timeout = "30s"` (against a
5s default) is the drain window for the same in-flight send.
(`min_machines_running` is strictly inert while autostop is `"off"` — Fly
defines it only for `"stop"`/`"suspend"` — and is kept as a second lock.)

**Deployment is now automatic.** Push to `master` runs
`.github/workflows/deploy.yml`, which checks the required GitHub settings by
name, then runs `flyctl deploy --remote-only` passing each `NEXT_PUBLIC_*` value
as a `--build-arg`. `workflow_dispatch` allows a manual run. The exact Secrets
and Variables the owner must create are in `SETUP.md` Step 5d. Nothing builds on
the GitHub runner.

**Documentation cleanup that came with it.** `.env.example` documented a
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` that **no code in this repo reads** —
checkout is redirect-based, so the browser never needs a publishable key. It has
been removed, with the reason written where it stood. `@stripe/stripe-js` is
likewise a dependency nothing imports; it is recorded in §6 as a cleanup
candidate and `package.json` was deliberately left alone.

**Not verified.** Nothing in this round was run against a real Fly account. The
memory figures, the constant-folding and the standalone sizes were measured
locally against a real build; the deploy path, the health check firing, the
`Fly-Client-IP` header actually being set by Fly's proxy, and `after()`
completing on a real machine are all first proved by the owner's first deploy.
`lib/rate-limit.ts`'s own comment records the caveat that Fly's docs *recommend*
`Fly-Client-IP` without promising the proxy overwrites a client-supplied one.

### Round 9 — Australia Post postage, phase 1: built, and not wired

Not a review round either. The owner asked for real Australia Post rates
instead of the flat $9.50 / $14.50 in `lib/config.ts`. What follows was
researched against the **live** Postage Assessment Calculator (PAC), not against
the documentation, because the documentation is wrong about several of these.

**The finding that shaped the whole design: domestic parcel price does not vary
by destination postcode.** Verified across eight destinations, from 3000
(Melbourne CBD) to 6798 (Christmas Island): the price was identical every time.
Postcodes affect which services are *available*, never what they cost. So
quoting needs **no customer address**, which deletes the problem that made this
look hard — Stripe collects the shipping address *after* the price is fixed, and
that no longer matters. A basket can carry a real postage figure on page one.

**Second finding: there is no cubic weighting.** Dimensions never move the
price at any weight tested — a 100 × 60 × 20 mm parcel and a 220 × 160 × 70 mm
parcel at the same weight quote identically. Dimensions decide **validity** and
Large Letter eligibility, and nothing else.

**Response traps, all observed rather than inferred.** They are why
`lib/shipping/client.ts` is 570 lines for what is a handful of GETs:

- `costs.cost`, `services.service` and `options.option` are a **bare object for
  one entry and an array for several** — sometimes both in one document.
  Anything that indexes `[0]` without normalising crashes on a quiet basket.
- **Money comes back as a string** (`"10.20"`, never `10.2`). Parsed to integer
  cents digit-by-digit; `parseFloat("10.20") * 100` is `1020.0000000000001` on
  this runtime and the same expression produces `1019.9999999999999` elsewhere.
- **An error is not signalled by the status.** The documented behaviour is a
  **200** carrying `{"error":{"errorMessage":…}}`; what this environment
  actually returns for the same bad requests is a **404** carrying the same
  body. Both happen, so neither is trusted — the body is parsed first and
  `error.errorMessage` is the authority, whatever the status line says.
- The letter endpoint's third dimension parameter is **`thickness`, not
  `height`** (sending `height` gets "Please enter Thickness."), and it takes no
  postcodes — domestic letters are flat-rate nationally.

**Prices are GST-inclusive retail.** The shop is not GST-registered, so it
passes the total through and never displays or computes a GST component from it.
That would claim a tax the shop does not collect.

**The money finding: Large Letter.** ≤125 g, ≤260 × 360 mm, ≤20 mm thick is
**$3.40** — but **untracked and uninsured**. The cheapest parcel is **$10.20**.
Quoted live on 25 August 2026: 1 charm **$3.40**, 4 charms **$3.40**, 12 charms
**$11.70** (weight tips it into a parcel), 1 pet bowl **$10.20**. On a basket of
two keycap charms that is the difference between postage costing more than the
charms and postage being an afterthought.

> **`transitLabel()` in `lib/config.ts` hardcodes "· tracked".** That is true
> today only because everything ships as a parcel. It **must** be fixed in the
> same change that ever enables Large Letter for a product, or the site tells
> customers that untracked mail is tracked. `lib/shipping/quote.ts` returns a
> `tracked` boolean per quote for exactly this reason; the UI must read that,
> not the label.

**Label printing and tracking APIs are not available to this business — do not
re-research this.** Australia Post's Shipping & Tracking API requires an
eParcel or StarTrack contract. eParcel needs **2,000+ parcels a year**, and the
Business Credit Account behind it wants **$1,000+ a month** in parcel spend plus
an **issued ABN**. MyPost Business is free and needs no ABN, but is
**portal-only — there is no API**. So at this scale: labels are printed by hand
in the MyPost Business portal, and the automation path when volume actually
arrives is a **third-party platform (Starshipit, Shippit) on a MyPost Business
account**, not Australia Post's own API.

**What was built** — `lib/shipping/`, seven files, each verified against the
live API:

| File | What it is |
|---|---|
| `dimensions.ts` | Every tunable: carrier limits, the margins held back from them, per-category fallbacks, packaging, rounding. One rule governs all of it — **round toward the shop paying** |
| `weights.ts` | Basket roll-up from **server-loaded product rows**. The browser says which product and how many, never how heavy |
| `select.ts` | Letter or parcel, on four rules evaluated together so a surprising verdict can be explained. Rule 4 (`max` thickness, not sum) is legitimate **only because** rule 3 forces a single flat layer — the two must not be separated |
| `client.ts` | The PAC HTTP layer. 2.5 s timeout, one retry on a network error only, **never throws** |
| `cache.ts` | L1 in-process `Map` with a 6 h TTL, and a marked **L2 seam** for the `shipping_rate_cache` table. `lookupRate`/`storeRate` are async purely so adding L2 changes this file and nothing else |
| `fallback.ts` | The pessimistic rate table, rates read live **2026-08-25** (`RATES_VERIFIED_ON`). It returns **the band above** the one a basket falls in — overcharging a dollar is recoverable, undercharging silently is not |
| `quote.ts` | `quoteBasket(lines, methodId)` — **the single entry point both cart and checkout must use**, so the price a customer agreed to and the price Stripe charges cannot diverge |

`supabase/migrations/0002_shipping.sql` adds `weight_grams`, `length_mm`,
`width_mm`, `thickness_mm` and `letter_eligible` to `products` (each with a
default, so no backfill), the `shipping_rate_cache` table with RLS on, no
policies and an explicit `revoke` from `anon`/`authenticated`, and three
nullable quote-provenance columns on `orders` (`shipping_quote_source`,
`quoted_weight_grams`, `quoted_service_code`) so a discrepancy found months
later is diagnosable. `verify.sql` grew from 24 to **29 assertions**.

**What is NOT done.** Phase 1 is the quoting engine; none of it is reachable
from the site:

- **Nothing imports `lib/shipping/`.** `app/api/checkout/route.ts:499` still
  calls the flat-rate `shippingCost()`. That is the wiring job.
- No `POST /api/shipping/quote` route, no cart UI, no copy changes.
- `scripts/verify-sql.sh` applies only `0001_init.sql`, so the SQL harness
  cannot run the 29 assertions (§4).
- The L2 cache tier is a documented seam, not an implementation.
- **Every physical constant in `dimensions.ts` is an estimate.** See §6's
  backlog item — three real weighings is the highest-value input there is.

**New environment variable: `AUSPOST_API_KEY`** — free, self-serve and instant
from developers.auspost.com.au. It is a **runtime** value, so it is a **Fly
secret, never a build arg**. Without it the client reports "not configured"
once per process and every quote falls through to the fallback table, which
still works. (The API does answer unauthenticated today; that is undocumented,
unpromised, and not something to build on.)

**Verified by execution:** the live PAC quotes above, the object-vs-array and
string-money shapes, the 200-vs-404 error behaviour, the postcode invariance
across eight destinations, and the absence of cubic weighting. **Verified by
reasoning only:** that the packing model matches how the studio actually packs
(single flat layer, items beside each other and never stacked — `select.ts`
depends on this and it is a packing-bench convention, not a measurement), and
every gram and millimetre in `dimensions.ts`.

## 6. Open items

### Postage — the half phase 1 did not do, and it comes first

`lib/shipping/` is built, documented and verified against the live carrier API
(§5 round 9). **Nothing imports it.** Until the list below is done the shop
still charges the flat $9.50 / $14.50 from `lib/config.ts`, which is a made-up
number that happens to be roughly right for a parcel and badly wrong for a
letter.

1. **Wire `quoteBasket()` into `app/api/checkout/route.ts`**, replacing the
   `shippingCost()` call at **line 499**. `quoteBasket` answers what the post
   office charges; `SHIPPING.freeThreshold` / `shippingCost()` still decides
   *who pays it* — the free-shipping rule is about the basket subtotal and is
   deliberately not inside the quoter. Stamp the three provenance columns
   (`shipping_quote_source`, `quoted_weight_grams`, `quoted_service_code`) on
   the order while you are there; `0002` added them for this.
2. **Add `POST /api/shipping/quote`** so the cart can price a basket without
   creating a checkout session. It must call `quoteBasket` and nothing else —
   two code paths computing postage is exactly how the cart price and the
   Stripe charge come to differ for some baskets and not others.
3. **Cart UI and copy.** Show the real figure, and label a `source:
   "fallback"` quote as an estimate if you show anything at all.
4. **Fix `scripts/verify-sql.sh` to apply `0002_shipping.sql`** — see §4. The
   29 assertions have never been run.
5. **The L2 cache tier** is a marked seam in `lib/shipping/cache.ts`, not an
   implementation. Read the three numbered warnings in that file first; the
   important one is that **a fallback price must never be persisted**, or a
   two-second outage becomes six hours of deliberately-inflated quotes.

**A trap in the schema, worth knowing before you touch a product row.**
`0002_shipping.sql` declares `letter_eligible boolean not null default true`,
while `lib/shipping/weights.ts` treats an absent flag as **false** and the seed
writes `false` for all 44 products. The two disagree in the expensive
direction: **a new product row added in the Supabase table editor arrives
letter-eligible**, and would quote at Large Letter rates for something nobody
has measured. Either flip the column default to `false` in a follow-up
migration, or make adding a row a checklist item that includes setting it.
Nothing is wrong today — every existing row is explicitly `false` — but the
default is the wrong way round.

### Front end — too many hand-drawn components

**Requested by the owner, and not urgent.** The shop draws a lot of things by
hand that a component library already solves: every table is a bare `<table>`
with its own paddings, the checkbox in `app/admin/products/ProductForm.tsx` is
a styled `<input type="checkbox">`, `Panel` exists twice (once in
`app/admin/ui.tsx` for server components, once inside `ProductForm.tsx` because
that file is `"use client"` and importing the other would drag it into the
browser bundle), and there is no date picker, no combobox and no dialog — the
places that would want one work around not having it.

Nothing here is broken. The cost is that a change to "how a table looks" is a
change in eight files, and the eight have already drifted: two of them round
their corners differently.

Before adding a component, check whether one of these does it:

* `components/ui/index.tsx` — buttons, pills, fields, alerts, breadcrumbs,
  empty states, **and `Pagination`, which every admin table must use**. Do not
  write a second pager.
* `app/admin/ui.tsx` — page headings, panels, stats, swatches, status pills.

The refactor itself, when someone picks it up: adopt a headless library
(Radix, or React Aria) for the interactive primitives only — menu, dialog,
combobox, checkbox, radio — and keep the visual layer where it is. Tailwind v4
tokens in `app/globals.css` are the design system and they are fine; the gap is
behaviour and accessibility, not colour. Do NOT adopt a styled component kit:
it would fight the tokens and the shop would end up looking like the kit.

### The admin area — what is verified and what is not

Built in round 10. Verified by execution: the SQL (50 assertions, each one
tested by breaking it), the costing chain (against the workbook's own cached
values), the authorisation layering (a real built server, four scenarios,
including replaying an owner's captured server-action request as a customer),
and every screen rendered in a real Chromium.

**Not verified against a real Supabase.** The rig used for the above answers
`/auth/v1/user` and `/rest/v1/staff` truthfully and returns fixtures for
everything else — it does not parse PostgREST syntax. So nothing in it is
evidence that a `select` string with an embedded join is correct. The queries
that have never run against PostgREST are the embedded-resource ones in
`app/admin/data.ts`:

* `product_filament(grams, colours(id, name, hex))` — a two-level embed
* `order_items(id)` used for a count, and the full line embed on `getOrder`
* `order_items(...) → orders!inner(status)` in `getOpenDemand`, which filters a
  child by a parent column

Run each of those once against the real project before trusting a number on
the Inventory or Reports screen.

### Backlog — the owner's input, and the thing that would help most

> **Weigh three items and give the real numbers.**
>
> One name charm, one clicker keychain, one pet bowl — each **in the mailer
> actually used** — and for each: **grams**, and **thickness in millimetres**.
>
> Every weight and every dimension in `lib/shipping/dimensions.ts` and in the
> seeded catalogue is a **reasoned estimate**. They were chosen to round toward
> the shop paying, so nothing undercharges today, but three real readings would
> replace the largest source of error in the whole postage path — and they are
> ten minutes with a kitchen scale and a ruler. This is the highest-value input
> to postage accuracy that exists, and nobody but the owner can supply it.
> It is repeated in `SETUP.md` under "What only you can supply".

### Pending owner decision — cheap-untracked, or dearer-tracked

Every product is `letter_eligible: false` today, so **everything quotes as a
tracked parcel**. That overcharges slightly on small baskets and never
undercharges, which is the safe place to sit while the decision is open.

The decision is a business one:

- **Large Letter** — $3.40 for a basket under 125 g, **untracked and
  uninsured**. A lost one is a loss the studio wears, and the customer has
  nothing to look up.
- **Parcel** — about $10.20, tracked, and the customer can watch it move.

Enabling Large Letter is **two things, and they must ship together**: flipping
`letter_eligible` to `true` per row in the Supabase table editor (no deploy),
**and** fixing `transitLabel()` in `lib/config.ts`, which hardcodes
"· tracked" for both shop methods. Doing the first without the second means the
site tells customers untracked mail is tracked. `quoteBasket` already returns a
`tracked` boolean per quote; the UI must read that rather than the label.

### Top follow-up in the app code — the JSX half of the contact dedupe

**The predicates are done. The JSX is not.**

The previous entry here asked for the copy-pasted "can the customer reach us"
tests — three names across the pages, two genuinely different questions — to be
moved into one module. **That is done.** `lib/contact.ts` now holds
`hasStudioMailbox`, `hasSocialAccount`, `canReachStudio`,
`formsReachStudio(canSendEmail)`, `sendsOrderConfirmation(canSendEmail)` and
`socialLinks`, with one definition each, imported by fifteen files. Doing it is
what surfaced the round-7 privacy defect: the single old `FORM_DELIVERS` test
was answering two questions that have different conditions.

**What is still duplicated is the markup.** The "reach us" fallback chain —
real mailbox → social handles → a plain statement that no contact address has
been published yet — is written out six times:

- `Reach` in `app/legal/terms/page.tsx`, `app/legal/privacy/page.tsx`,
  `app/legal/refunds/page.tsx` and `app/account/orders/[id]/page.tsx` — four
  near-identical copies, each with its own `SocialLinks` and `NO_CHANNEL`;
- `HowToAsk` in `app/account/settings/DeleteAccountCard.tsx`;
- `emailChangeHint` in `app/account/settings/ProfileCard.tsx`.

(`ReachUsCard` in `app/contact/page.tsx` is a seventh instance of the same
branching, but it renders a card rather than a sentence and may honestly stay
its own component.)

**It wants a `components/contact/Reach.tsx`.** A `.ts` module holds no markup,
which is exactly why the predicates could move and this could not; a `.tsx`
component can. Each copy words its fallback slightly differently, so the
component has to take the wording as props rather than flatten six voices into
one. The argument is unchanged: what this chain decides is whether a page tells
a charged customer to "get in touch", so a drift between copies is a false
claim.

### Deliberately not done — decide before launch

| Item | Detail |
|---|---|
| **The newsletter has no subscriber list** | There is no table, no audience, no unsubscribe mechanism. `/api/newsletter` forwards a *notification* to the studio inbox and the owner adds the address by hand wherever the list eventually lives — it is **not a subscription**, and the footer copy must never promise a newsletter, a welcome email or an unsubscribe link until one exists |
| **Real account deletion is not built** | §0.9 closed the *claim* only: the card now says a request is filed by hand, which is what happens. Actual deletion needs a server-side admin route holding the service-role key (the browser client uses the anon key and is refused), **re-authentication** before it fires, and a guard for in-flight orders. TODO in `DeleteAccountCard.tsx` |
| **Saved addresses don't prefill checkout** | Stripe collects the address fresh. The copy is honest about this. Real prefill needs a Stripe Customer with `shipping`, passed as `customer` on the session. TODO in `app/account/addresses/page.tsx` |
| **No review UI** | The insert policy was withdrawn. The migration records the shape of a correct one (requires a delivered order, forces `verified`) for when reviews ship |
| **Promotion codes disabled** | `allow_promotion_codes: false`. Orders have no discount column, so a promo would leave subtotal/shipping/total inconsistent |
| **The domain is registered but not attached** | **`bamstudioshop.com` is registered at Porkbun.** DNS still carries Porkbun's parking wildcard (`*` CNAME → `uixie.porkbun.com`), which **must be deleted** — it shadows email records. The first deploy still targets `https://bamstudio-shop.fly.dev`; the matching **`.com.au` needs an *issued* ABN** — auDA requires one and a pending application does not qualify. Moving to the real domain later is five jobs, and the first is the one people miss: change the `NEXT_PUBLIC_SITE_URL` **build arg and redeploy** (it is baked in — a restart does nothing), then `fly certs add`, update Stripe's webhook endpoint, update Supabase's Site URL and redirect allow-list, and re-verify the sending domain in Resend. `SETUP.md` Step 5f is the runbook |

### Known limitations

- **Rate limiting is in-memory, per process, and is still load-bearing.**
  `lib/rate-limit.ts` was a decorative speed bump when §0.2 was open, because
  `lookup_order` was callable straight over PostgREST and the throttle could
  simply be walked around. Revoking that grant closed the side door — which
  means the throttle in `/api/track` is now **the only thing** in front of the
  lookup. Order numbers are a public incrementing sequence plus four hex
  characters, so an attacker holding a customer's email address has ~65k
  guesses standing between them and that customer's street address.
  **Move it to Upstash/Redis before launch.** The call sites do not change.

  **What round 8 fixed, and what it did not.** It is now correct about *which
  IP it reads*: `clientKey()` used to take the **first** `x-forwarded-for`
  value, which was safe on Vercel (whose proxy overwrites the header) and
  outright forgeable on Fly (whose proxy **appends** to it) — a caller could
  mint a fresh bucket per request and walk straight through. It now prefers
  `Fly-Client-IP`, gated on `FLY_APP_NAME` so the header cannot be believed
  off-Fly, and falls back to the **last** XFF hop. **That is identity, not
  durability.** The counters still live in one process's memory, so a restart or
  a deploy resets them, and scaling past one machine multiplies the allowance
  again — which is part of why `fly.toml` pins the app to a single always-on
  machine (round 8). Running behind another proxy in front of Fly (Cloudflare,
  say) would collapse every visitor into one bucket and means revisiting the
  function. The real fix is still shared storage.
- **The `"unknown"` email sentinel escapes the webhook.** `orders.email` is
  `NOT NULL`, so the Stripe-rebuild path has to write *something* when Stripe
  gave no address, and that something is the truthy string `"unknown"`. The
  webhook reads it correctly, through `hasCustomerEmail()` — that guard is
  round 7's item 3. **Nothing outside the webhook knows it exists**: `/track`,
  the account order pages and `lib/queries.ts` all read the column as though
  every value were an address. Nothing is known to break today, but it is a
  sentinel in a column three readers treat as data, and the last one that was
  reached a paying customer.
- **Nothing writes `orders.tracking_number`, and there is no admin surface.**
  `/track` shows customers a `confirmed → printing → packed → shipped`
  progression that, today, only advances if the owner edits the row by hand in
  the Supabase table editor. The claim is not false — the states are real and
  the page reads them — but the shop has no way to move an order along, and no
  screen anywhere for the person running it. Decide before launch whether that
  is acceptable for the first few orders or whether an owner view comes first.
- **`verify.sql`'s backfill assertions test a duplicate, not the migration.**
  The §0.7 checks (`backfill skips a stranded order`, `backfill marks a
  finished order`) evaluate a **hand-copied copy** of the backfill's `WHERE`
  clause from `0001_init.sql`, because the backfill itself is a one-shot
  `UPDATE` that has already run by the time `verify.sql` executes. Editing the
  migration's predicate therefore leaves both assertions green while they test
  the old logic. Exactly the silent-drift class the replay harness was just
  fixed for (round 7, item 6) — and the fix is the same shape: derive the
  predicate from the migration rather than restate it.
- **`public.handle_new_user()` keeps its default `PUBLIC EXECUTE`.** Not
  exploitable — it is a trigger function and does nothing useful when called
  directly — but it is the one function in the schema that was not brought
  under an explicit grant, so it reads as an oversight next to the others.
  Revoke it for consistency, and to keep the "every function has a deliberate
  grant" rule true enough to be worth checking.
- **The `reviews` table is world-readable, including `user_id` and
  `author_name`.** Nothing is in it (no review UI, insert policy withdrawn), so
  there is nothing to leak today. It becomes a real disclosure the day reviews
  ship: `user_id` joins a review to an account. Decide the select policy before,
  not after.
- **Sign-up enumeration is closed only while email confirmation is ON** in
  Supabase (it is by default). With it off, a new sign-up gets a session and
  redirects while an existing address lands on the confirm screen — still
  distinguishable. Don't switch confirmation off without revisiting this.
- **`order_items.colour` is polymorphic**: a product colour for ordinary
  lines, a colourway name for builder lines. Nothing breaks (`reorderLines`
  skips personalised products) but it is worth knowing.
- **`/search?q=` truncates a long query to 64 chars in SQL while
  `/api/search/suggest` rejects it with 400.** Same paste, two behaviours.
  Cosmetic.
- **Basket lines saved by an older build** carry a key without the
  personalisation segment, so an identical new line won't merge with them.
  Self-healing; affects nobody but a developer mid-iteration.
- **`@stripe/stripe-js` is a dependency no file imports.** Checkout is
  redirect-based — the server creates a Checkout Session and the browser goes to
  Stripe's hosted page — so no publishable key and no client library are needed.
  The matching `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` was removed from
  `.env.example` in round 8; `package.json` was **deliberately left alone**, so
  this is a cleanup candidate rather than a done thing: remove the dependency
  and re-run `npm run build` to confirm nothing pulls it in transitively.
  (`public/vercel.svg` is a leftover of the same kind, unreferenced by any
  component.)
- ~~`getStripe()`'s error message still names Vercel.~~ **Fixed in the code.**
  `lib/stripe.ts` now says to add it to `.env.local` locally and to set it with
  `fly secrets set` on the server, naming it a runtime secret and never a build
  arg. Recorded here only because `CLAUDE.md` carried this as a known-stale
  string for a while and someone may remember it that way.

### Outstanding security action — the Supabase JWT secret

**The Supabase JWT secret does not appear to have been rotated.** The anon key
that was previously exposed in chat **still authenticates**, which is the test
that matters: rotating the JWT secret invalidates every key signed with the old
one. If the anon key still works, the old signing secret is still live — and the
`service_role` key that was leaked alongside it is therefore very likely still
live too.

That key **bypasses row-level security entirely**. It can read every order, every
address and every profile in the project, and write anything it likes.

What the owner has to do, in the Supabase dashboard: rotate the JWT secret, take
the newly issued keys, update `NEXT_PUBLIC_SUPABASE_ANON_KEY` (a **GitHub
Actions Secret** — it is a build arg, so this needs a **redeploy**, not a
restart) and `SUPABASE_SERVICE_ROLE_KEY` (`fly secrets set`, restart only), and
update `.env.local` on her own machine. Rotating and *not* updating both places
takes the shop down, so do it in one sitting.

The Stripe live key that was exposed in the same way **has been rolled** — the
owner has confirmed that. Test keys are in use everywhere today.

### The owner's own setup, as at 25 August 2026

Recorded because a new session will otherwise assume more exists than does.
None of it has been verified from here — it is what the owner reports.

| Thing | State |
|---|---|
| Domain | **`bamstudioshop.com` registered at Porkbun.** DNS still on Porkbun's parking wildcard (`*` CNAME → `uixie.porkbun.com`), **which must be deleted** — it shadows email records |
| GitHub | `https://github.com/nellyy2505/bamstudio-shop`, **public**, branch `master`, pushed |
| Supabase | Project exists; **the database is still empty — no migration has been run.** `0001_init.sql` *and* `0002_shipping.sql`, then `seed.sql`, then `verify.sql` |
| Fly | **App not created yet.** No deploy has ever happened |
| Stripe | **Test** keys in use. The live key exposed in chat has been rolled |
| Supabase keys | **JWT secret appears not to have been rotated** — see above |
| Email | **Nothing configured.** Plan: Resend free tier (3,000/month, custom domains included) for sending, Porkbun's free forwarding for receiving. `EMAIL_FROM` **cannot** be a gmail.com address |
| Australia Post | No `AUSPOST_API_KEY` yet. Free, self-serve, instant |

### Cannot be verified without the owner's accounts

These are not open *items* — they are things believed correct that no one here
could put a claim behind. §0 lists them with the reasoning; repeated here
because they are what the owner's first real test order is for.

- Real Resend delivery, and that `EMAIL_FROM`'s domain is verified. The
  43-scenario harness proves *when* a send is attempted and with what body; it
  stubs the provider, so nothing here has put a message in a mailbox.
- That `product_data.metadata.slug` survives the Stripe round trip and comes
  back under `expand: ['data.price.product']`. If it does not, §0.8's fix
  quietly falls back to matching on the non-unique `short_name`.
- `after()`'s behaviour on the deployed Fly machine — whether the queued
  confirmation email reliably completes. `fly.toml` is configured so the machine
  never stops or suspends underneath it (round 8), but that is a setting, not an
  observation.
- Grants on a hosted Supabase project, including anything granted in the
  dashboard outside the migration.
- **The whole Fly deployment.** Nothing in round 8 has been run against a real
  Fly account: not the deploy, not the health check firing, not a rolling
  release, and not `Fly-Client-IP` actually arriving on a request. The memory
  figures, the constant-folding of `NEXT_PUBLIC_SITE_URL` and the standalone
  sizes *were* measured locally against a real build. Fly's own docs recommend
  `Fly-Client-IP` without promising the proxy overwrites a client-supplied one —
  if that promise turns out to be false, the limiter is back to a speed bump and
  the fix is a real store, not a different header.

### Only the owner can do these

**Weigh three items and give the real numbers** (the backlog item above — one
name charm, one clicker keychain, one pet bowl, in the mailer actually used:
grams and thickness in mm) · **decide Large Letter vs tracked parcel** (the
pending decision above) · **rotate the Supabase JWT secret** and update both
places that hold its keys · **delete Porkbun's `*` parking CNAME** ·
`AUSPOST_API_KEY` from developers.auspost.com.au (free, self-serve, instant —
a **Fly secret**, never a build arg; without it postage falls back to the
pessimistic table and still works) · **run `0001_init.sql`, then
`0002_shipping.sql`, then `seed.sql`, then `verify.sql`** on the Supabase
project, which is still empty · create the Fly app ·
ABN (Stripe needs it to release money) · registered business name · business
postal address · return address · a support mailbox
(`NEXT_PUBLIC_SUPPORT_EMAIL` — **not optional**: without it the contact form
and the newsletter box have nowhere to deliver, so the shop does not offer
them) · the Resend keys (`RESEND_API_KEY` and `EMAIL_FROM`, both or neither —
there is no third flag any more) · **naming Fly.io as the hosting provider on
`/legal/privacy`** (the page names its other processors — Stripe, Supabase,
Resend — and still describes hosting generically; it is Fly.io as of round 8,
and any draft still saying Vercel is wrong) · a Fly account and a `FLY_API_TOKEN`
in GitHub · business bank account · real prices
("My price" is empty in the workbook, so the shop shows placeholders from
`PRICE_BY_CATEGORY`) · product photography · legal review of the three
`/legal/*` drafts, **especially the rewritten contract-formation clause in
`app/legal/terms/page.tsx`** · Sydney market dates · optional social handles ·
deciding whether to enable PayPal / Apple Pay / Afterpay in Stripe and adding
them to `PAYMENT_BADGES`. `SETUP.md` is the runbook for all of it.

## 7. State now

```
314ba58 Clear the last two launch blockers, and the quality items behind them
42f6e5b Make the schema re-runnable, and add a smoke test that proves it
c07e734 Fix two blockers the previous pass introduced, and the rest of the review
3a26161 Tighten two details from the fix pass
4dbbfae Act on the full-codebase review
38d4da5 Document the GST registration flag
dcc6e16 Close a pricing exploit and harden the checkout path
f9745fb Stage orders in the database instead of Stripe metadata
71e701f Build the Bam Studio online shop
```

The rounds-6-and-7 remediation of §0 sits on top of that, with `lib/email.ts`,
`lib/contact.ts`, `scripts/verify-sql.sh` and `scripts/replay-checkout.mjs`
new. **The round-8 hosting migration** added `Dockerfile`, `fly.toml`,
`.dockerignore`, `.github/workflows/deploy.yml` and `app/api/health/route.ts`,
and changed `next.config.ts`, `lib/stripe.ts`, `lib/rate-limit.ts` and
`proxy.ts`. **Round 9** added `lib/shipping/` (seven files) and
`supabase/migrations/0002_shipping.sql`, and changed `lib/types.ts`,
`supabase/verify.sql`, `scripts/generate-seed.mjs`, `supabase/seed.sql` and
`lib/fallback-data.ts`.

**Where those changes live is not the same answer everywhere, so check rather
than assume.** On the owner's device the hosting move is reported as commit
**`896c08d`, pushed to `master`** at `github.com/nellyy2505/bamstudio-shop`.
That commit does **not** exist in the sandbox checkout these docs were written
in (`git log` there shows two synthetic checkpoint commits, and every round-8
and round-9 file is untracked or modified in the working tree). Both statements
can be true at once — they are different clones — but it means **`git status`
and `git diff --stat` are the only trustworthy answer to "what is committed",
and this paragraph is the first thing in the file to go stale.**

Round 9 is **not** committed anywhere as far as anything here can tell.

`npx tsc --noEmit`, `npx eslint .` and `npm run build` were clean as of round 8.
**They have not been re-run since round 9 landed**, and round 9 changed
`lib/types.ts` — `Product` gained five non-optional fields — so a typecheck is
the first thing a new session should run. Verified **by
execution**, at the time each was run: `./scripts/verify-sql.sh` **24/24**
against a real PostgreSQL 16
from an empty database (including the anon-privilege denial, on a fresh
database and on a simulated already-deployed one);
`node scripts/replay-checkout.mjs` **7/7** with the negative control; the
webhook behavioural harness **43/43**; an 80-page browser crawl across four
configuration states with zero failed assertions; the `safeNext`
re-verification, 41 payloads plus ~192,000 fuzz cases. **The webhook harness
lives in `/tmp/webhook-harness/` and will not survive this session** — §4 says
what it covers so it can be rebuilt.

**The SQL number above is stale and the harness is currently broken**:
`verify.sql` is now **29 assertions** and asserts against `0002_shipping.sql`,
while `scripts/verify-sql.sh` still applies `0001` only. 29/29 has never been
observed (§4, §6).

Round 9's own verification was **against the live Australia Post API** — the
quotes, the response shapes, the 200-vs-404 error behaviour, the postcode
invariance across eight destinations and the absence of cubic weighting were all
observed. Nothing in `lib/shipping/` has been exercised through the app, because
nothing in the app calls it.

Verified **by reasoning only**, and worth repeating because the distinction is
the most useful thing in this file: real Resend delivery, the Stripe
`product_data.metadata.slug` round trip, `after()` completing on the deployed
machine, grants on a hosted Supabase project applied outside the migration, and
**the entire Fly deployment** — no part of round 8 has been run against a real
Fly account. What round 8 *did* measure, against a real local build: the ~1.6 GB
build peak and ~150 MB running server, the ~72 MB / ~24 MB-gzipped standalone
tree against 629 MB of `node_modules`, and the constant-folding of
`NEXT_PUBLIC_SITE_URL` into `.next/server/chunks/lib_stripe_ts_*.js` with its
runtime read gone.

**None of that means it is ready.** Every check above passed while all ten §0
blockers were live, which is the whole reason §4 exists: green checks measure
the things being watched. What is genuinely left is smaller and named:

- The shop cannot send anything until the owner sets `RESEND_API_KEY` and
  `EMAIL_FROM` — both, or neither — see `SETUP.md`. There is no third flag to
  keep in step any more, and that is deliberate: the shop now works out what it
  can do and says only that. `NEXT_PUBLIC_SUPPORT_EMAIL` is separate and is
  **not optional** if the contact form or the newsletter box is to work.
- **Real account deletion does not exist**, and the newsletter has **no
  subscriber list** (§0.9, §0.1, §6). Both are honest on the page now; neither
  is built.
- The `/track` throttle is the only thing in front of a customer's postal
  address. Round 8 fixed *which IP it reads* — the old first-`x-forwarded-for`
  read was forgeable on Fly — but it is still one process's memory, and moving
  it to shared storage is still the top security follow-up (§6).
- **The shop has never been deployed, and the database is still empty.** The Fly
  app has not been created; no migration has been run on the Supabase project.
  `bamstudioshop.com` **is** registered (Porkbun), but DNS still carries the
  parking wildcard that shadows email records, and the `.com.au` needs an
  *issued* ABN. Changing to the real domain later is a rebuild, not a setting
  (§5 round 8, §6, `SETUP.md` Step 5f).
- **Postage is built and not connected.** `lib/shipping/` quotes real Australia
  Post rates and nothing imports it; checkout still charges the flat rate. The
  wiring, the `transitLabel()` trap and the owner's three weighings are all in
  §6, and they are the first work a new session should pick up.
- **The Supabase JWT secret appears not to have been rotated**, so the leaked
  `service_role` key is very likely still live (§6). That is the one item on
  this page that is a live security exposure rather than a missing feature.
- The `"unknown"` email sentinel escapes the webhook into three readers that do
  not know about it, and nothing writes `orders.tracking_number` — the status
  progression customers are shown is a manual database edit today (§6).
- The legal pages have never been read by a lawyer, and the
  contract-formation clause in `app/legal/terms/page.tsx` was **rewritten**
  during this pass — it now keys on payment succeeding and the order number
  being allocated, because the old wording keyed on a confirmation email that
  no code ever sent, which meant no contract ever formed. It is the most
  load-bearing sentence on the site and it needs a professional eye.

Start at §0 and its open list, then §5 round 7 — the design rule it ends on is
the one thing in this file that will stop the same defect being written a third
time — then §5 round 9 and §6's postage section, which is where the actual work
is.
