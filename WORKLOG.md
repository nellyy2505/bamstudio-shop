# Work log — Bam Studio shop

Everything a new session needs to pick this up: what was built, what was found
wrong and fixed, what is deliberately still open, and how to verify any of it.

Last updated: 27 August 2026. Branch: `master`. Eight rounds have landed since
the last full docs pass: **round 10**, the pre-launch remediation, which also wired
postage into checkout; **round 11**, the staff area; **round 12**, the first
session to drive the deployed studio against the live database; **round 13**,
the migration harness, `0004_letter_eligible_default.sql`, `next=` carried
through sign-up, and a screen for measuring the catalogue; **round 14**, the
first real sale recorded in the studio — which finally exercised the three
embedded joins with rows in them — plus the measure screen's markup and seven
admin page titles; **round 15**, the security and truthfulness sweep: response
headers and a CSP, a throttle on `/order/confirmed`, six untrue customer-facing
statements removed, and `0005_sale_integrity.sql`; **round 16**, which made
a customer's contact message a row before it is an email (`0006_enquiries.sql`);
and **round 17**, Lucky Scoop — the one product this shop sells before it knows
what is in it (`0007_lucky_scoop.sql`, four tables, a shopfront, a studio, and
the pack flow that is the only moment a scoop's stock moves and its cost is
known). Round 17 also **rebuilt the webhook harness this file had listed as lost
since round 7**, and is the first round since round 12 whose numbers were
*observed* rather than read off a file. §0 has the current open list; §5 rounds
10–17 have the reasoning; §7 has the commit state and what to distrust in it.

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
| A | **`git push origin master`.** The three round-12 commits (`1a4e0d0`, `7c049aa`, `10a683f`) are made on `master` on the owner's machine and **not pushed** — the device shell has no network and cannot reach the Windows credential store. Nothing in them is live until she pushes | **owner** | §5 round 12, §7 |
| B | ~~**Record one real sale against a measured product.**~~ **Done, round 14.** The three embedded-resource selects in `app/admin/data.ts` had run against real PostgREST and returned `[]` every time, because every table behind them was empty; a real sale on Orders → *Record a sale*, against a product with a print time and a filament colour, exercised all three with rows in them, and the costing chain was checked by hand against the live numbers. **Keep the rule that made this an item** — an empty table is a question about the database, not about the query — because the next new join will be in the same position | done | §5 round 14 |
| C | **Weigh three items and give the real numbers** — one name charm, one clicker keychain, one pet bowl, each in the mailer actually used: grams, and thickness in mm. **Every** weight and dimension in `lib/shipping/dimensions.ts` and in the seed is a reasoned estimate today. These three readings are the single highest-value input to postage accuracy | **owner** | §6 backlog |
| D | **Decide: cheap-untracked or dearer-tracked.** Every product is `letter_eligible: false`, and since `0004_letter_eligible_default.sql` that is the column's default too, so everything quotes as a tracked parcel — which overcharges slightly and never undercharges. Large Letter is $3.40 against ~$10.20, and is **untracked and uninsured**. Enabling it is a per-row tick in Supabase **plus** carrying `quoteBasket()`'s `tracked` boolean through the UI, which `transitLabel(methodId, tracked)` now requires as an argument. This is a business decision, not a code one | **owner** | §6 |
| E | **Owner data entry — the studio has almost nothing to work with.** 44 products, **all still at the seed price of $9.00**, **0 of 44 with a filament recipe**, and print times effectively all missing, so every cost, margin and suggested price reads "Not measured". `/admin/inventory/measure` is the screen built for the print-time-and-grams half of it | **owner** | §6 |
| F | **Confirm the production secrets on Fly, then place one test order.** `NEXT_PUBLIC_SUPPORT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM` and the **production** `STRIPE_WEBHOOK_SECRET` are filled in `.env.local`; the deployed shop reads Fly secrets, which is a different set of values. Nothing in this repo has ever been through a real Stripe session or put a message in a mailbox | **owner** | §6, `SETUP.md` |
| G | **`AUSPOST_API_KEY` is a new runtime secret** — free, self-serve, instant from developers.auspost.com.au. It is a **Fly secret, never a build arg**. Without it postage still works: it falls through to the deliberately pessimistic fallback table | **owner** | §6, `SETUP.md` |
| H | **Delete the Porkbun parking wildcard.** `bamstudioshop.com` is registered, but DNS still carries `*` CNAME → `uixie.porkbun.com`, which shadows email records | **owner** | `SETUP.md` Step 5f |
| I | **The rate limiter is still one process's memory.** Round 8 fixed *which IP it reads*; round 15 closed the last route family with no limit at all (`/order/confirmed`). Neither made it durable, and it is still the only thing in front of `/api/track` | agent | §6 |
| J | **Get `0004`, `0005`, `0006` and `0007` onto the live project — which is now one push, not four pastes.** `0005` is the money migration (the confirmation-email stamp, the observable stock clamp, the refund register), `0006` makes a contact message a row, `0007` is Lucky Scoop; **none of the four is applied** and none of them does anything until it is. **The procedure changed in round 17's flow**: migrations run themselves on deploy via `scripts/migrate.sh` and the `migrate` job that `deploy` has a `needs:` on, so she adds the `SUPABASE_DB_URL` secret, takes a backup, and runs **Actions → Run migrations** once with `0001 0002 0003` in the "already run by hand" box. `verify.sql` then prints **126** rows | **owner** | §5 rounds 15–17, `SETUP.md` Step 1c |
| K | **Exercise `0005`'s three behaviours against real rows.** `verify.sql` asserts them against synthetic rows inside a rolled-back transaction, which proves the schema and not the webhook. An oversell that accumulates on `products.oversold_units`, a redelivered Stripe event that does not send a second email, and a payment on a cancelled order that writes exactly one incident are each still believed-correct-by-reading | agent | §5 round 15 |
| M | ~~**Run `0006_enquiries.sql` on the live project.**~~ **Folded into J** — the deploy applies every missing migration in order now, so `0006` is not a separate errand. The consequence is unchanged: until it is applied a contact-form message is stored nowhere and a failed send still loses it | **owner** | §5 round 16, `SETUP.md` Step 1c |
| O | **`0007_lucky_scoop.sql` is not applied to production either, and the shopfront is written to survive that.** No scoop tier exists anywhere — nothing is seeded, and `getScoopTiers()` carries no sample tier — so `/scoop`, the home highlight card, the FAQ answer and the sitemap entries are all conditional on a tier being both active and priced. On a database without `0007` the reads fail closed rather than erroring, and on one with `0007` and no tiers the scoop simply is not there. **That is why "the feature is built" and "the shop sells scoops" are two different statements**; the second needs the owner to create a tier, price it, weigh a test pack and fill a pool | **owner** | §5 round 17, `SETUP.md` |
| P | **Three Lucky Scoop decisions are the owner's, and the copy deliberately says nothing in either direction on all three.** (1) May a scoop contain two of the same charm? (2) How is the video promised — is "we film every scoop" a term of sale, or a thing the studio does? (3) Is a change of mind on a scoop accepted? `app/legal/refunds/page.tsx` carries **two drafted paragraphs in a comment**, (a) accept and (b) decline, for her to choose between; `scoop_packs.video_url` is nullable so that a `not null` does not answer (2) for her; and `scoopsAvailable()` counts **distinct** products so that (1) is safe under either answer. **Do not close any of these by guessing.** Silence favours the customer, which is the safe direction to be wrong in — but (b) on the refunds page is only relied on if it is stated *before* purchase, so it stays a decision rather than a default | **owner** | §5 round 17 |
| N | **Exercise `0006` against real rows too** — an enquiry posted with the mail provider deliberately unconfigured must still land as a row, which is the whole point of the migration and the case that used to lose the message; a repeated sign-up must be idempotent; an unsubscribe must survive a later sign-up | agent | §5 round 16 |
| L | ~~**The basket limits exist in three places.**~~ **Done.** `BASKET_LIMITS` is in `lib/config.ts` (line 222) and nowhere else; `components/cart/limits.ts` is deleted, and both route schemas and `CartProvider.tsx` import the constant. **Keep the rule**: change the number there and do not put a literal back into a Zod schema | done | §5 round 15, `AGENTS.md` |
| Q | ~~**Rebuild the webhook harness before the payload changes again.**~~ **Done, round 17.** It is `scripts/check-webhook.mjs` with its fakes in `scripts/webhook-harness/`, it is **in the repo** rather than in `/tmp`, and it ran **91/91 across 12 scenarios** with five deliberate mutations of the routes each proved to fail it. It is smaller than the lost 43-scenario harness and says so: the delayed-payment, expired-session and paid-while-cancelled branches are **not** rebuilt and are the first things to add back | agent | §4, §5 round 17 |

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
| 10 | **Closed** | "Free shipping" was stated unqualified but only ever applied to standard post. Qualified everywhere, and the cart derives the claim for the **selected** method, so it can no longer say "Free shipping unlocked" while Express is selected and charged the express rate. (The predicate is now `isFreeShipping(subtotal, methodId)`; `shippingCost()` was deleted in round 10 when postage moved to `quoteBasket()`) |

Lower-severity items from round 5: **two of them are now closed.** Round 15 gave
`next.config.ts` a full set of security headers — HSTS, an enforced CSP,
`frame-ancestors`/`X-Frame-Options`, `nosniff` and `Referrer-Policy` — and moved
the quantity cap into the cart itself instead of leaving a breaching basket to
be refused at checkout with a blanket "Invalid basket." Still open and still not
launch-blocking: the uncapped "Only N ready to ship", the inert `revalidate`,
and the recovery cookie keyed on `next` rather than on the flow. That list used
to say "empty `next.config.ts`", then "it sets `output: standalone` but declares
no security headers"; **neither sentence is true any more, and the file is now
one of the more heavily reasoned in the repo** — see §5 round 15 before changing
a directive in it.

### What is verified by execution, and what is only verified by reasoning

This distinction matters more than the status column, and it is the thing a
green check is least able to tell you.

**Run, and observed to pass:**

- `./scripts/verify-sql.sh` — the migration, the seed and `verify.sql` applied
  to a real local PostgreSQL 16 from an empty database. **24/24 assertions
  `t`**, including the five grant assertions (three for `lookup_order`, two for
  the confirmation lookup) and the §0.7 backfill predicate, exercised over a
  seeded stranded order and a seeded finished one.

  **That 24/24 is historical, and so is every number after it.** The file has
  grown with the schema: 29 assertions with `0002_shipping.sql`, 50 with the
  staff area in `0003_admin.sql`, 52 with `0004_letter_eligible_default.sql`'s
  two letter-eligibility checks, 65 with `0005_sale_integrity.sql` — the
  confirmation-email stamp, the observable stock clamp and the refund register —
  86 with `0006_enquiries.sql`, the contact-enquiry and newsletter-sign-up
  tables, and **126** with `0007_lucky_scoop.sql` — the scoop tiers, their
  pools, and what went into a packed scoop.
  `scripts/verify-sql.sh` no longer carries a list of migrations at all — it
  applies **every `.sql` in `supabase/migrations/`** in `LC_ALL=C` filename
  order and prints how many it applied, because the hand-written list fell
  behind twice. Observed: **29/29** in round 10, **50/50** in round 11 with
  every assertion individually proved to fail when the thing it asserts was
  broken, **50 rows all `t` against the live Supabase project** on 26 August
  (round 12), and **126/126 against a real local PostgreSQL 16 from an empty
  database** in round 17.

  **This file said for four rounds that the count had never been observed above
  50, and that sentence is now wrong.** The correction matters more than the
  number: "distrust every count after 50" was the standing instruction to the
  next session, and acting on it now means re-deriving something that has been
  run. 52, 65 and 86 were each superseded before anyone executed them; **126 is
  the first count after 50 that has actually printed.** What is still owed is a
  run against the **live** project, which is a different claim and is item J.

  One property of the 0007 block worth knowing before editing it: it briefly
  `set role`s to `anon` to count what the shopfront can really see, because RLS
  is invisible from the `postgres` role. A policy asserted any other way is
  asserted by reading its source rather than by running it. The role is reset
  immediately and the whole thing is inside the same rollback.
- **`node scripts/check-scoop.mjs` — 34 assertions, all passing.** The Lucky
  Scoop rules in `lib/scoop.ts`, compiled by the project's own `tsc` and
  exercised without a database, a server or a browser, in the shape
  `check-costing.mjs` established. The expected values are worked out in
  comments beside each case rather than taken from a fixture: unlike costing
  there is no spreadsheet to check against, so what it proves is that the code
  does what `0007_lucky_scoop.sql` and `lib/scoop.ts` say.
- **`node scripts/check-webhook.mjs` — 91 assertions across 12 scenarios, all
  passing, and five deliberate mutations of the routes each proved to fail it.**
  This is the harness this file has listed as lost since round 7, rebuilt and
  **in the repo** (`scripts/webhook-harness/` holds its four fakes). It loads
  the **real** route modules through `jiti` so the TypeScript and the `@/`
  aliases resolve as Next resolves them; only Supabase, Stripe, the mail
  provider and the costing tables are faked. It is smaller than 43 scenarios and
  does not pretend otherwise — see §4 for what it does not cover.
- **`npx tsc --noEmit`, `npm run lint` and `npm run build` — all clean** on the
  round-17 tree.
- **The anon-privilege denial, against real Postgres.** `permission denied for
  function lookup_order` for both `anon` and `authenticated`; a row returned
  for `service_role`. Run on a fresh database *and* on a simulated
  already-deployed one, which is what proves the explicit `revoke execute`
  closes the hole rather than merely not opening it.
- `node scripts/replay-checkout.mjs` — **7/7**: the six real
  `CartView.checkout()` baskets plus the negative control, against a running
  dev server.
- **The round-7 webhook behavioural harness — 43/43**, historically. It lived in
  `/tmp/webhook-harness/` and did not survive the session that wrote it, which
  is why this file carried "rebuild it" for nine rounds. **That item is closed**:
  the rebuild is `scripts/check-webhook.mjs` above, it is in the repo, and it
  covers a different and smaller set. Neither harness is a superset of the
  other — §4 lists what the old one covered and the new one does not.
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

**Postage is quoted from Australia Post, in `lib/shipping/`, and it is wired.**
Round 10 connected it: `quoteBasket()` prices every basket in
`app/api/checkout/route.ts`, in `POST /api/shipping/quote` and in the cart, the
flat-rate `shippingCost()` was **deleted** rather than deprecated, and
`transitLabel(methodId, tracked)` now takes tracking as a required argument.
Seven modules, one entry point: `quoteBasket(lines, methodId)`
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
quote-provenance columns on `orders`; `0004_letter_eligible_default.sql` fixes
the one column whose default rounded the wrong way. §5 rounds 9 and 10 have the
full record, and §6 what is left.

**The staff area is `/admin`, and authority does not live where you would look
for it.** A role is **not** a column on `profiles` — `0001_init.sql` grants every
signed-in account UPDATE on its own profile row across all columns and RLS
cannot restrict a policy to a subset of them, so a role there would be
self-assignable over PostgREST with the anon key that ships in the browser
bundle. It is `public.staff`: RLS on, **no policy at all**, explicit revokes from
`anon` and `authenticated`, readable only with the service-role key. The
consequence to carry: **the role cannot be checked in `proxy.ts`**, which only
has the anon client. The proxy establishes "signed in at all"; `requireStaff()`
in `lib/auth/staff.ts` does the real check and is called by every page, route
handler and server action under `/admin` — a layout is not a security boundary
for a route handler. The single documented exception is `acceptInvitation` in
`app/admin/actions.ts`, which cannot require staff because it is the action that
makes somebody staff; §5 round 12 records what stands in for the check.

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

**`npm run build` is part of the check list, not a formality.** Round 11 shipped
a tree where `npx tsc --noEmit` and `npx eslint .` both passed and the app could
not compile: one `export const` in a `"use server"` file — every export there
must be an async function — made Turbopack report the whole module as having no
exports and took eleven pages down. Only `next build` sees the server-action
boundary, and only `next build` proves a route group resolves to the URL you
expect, which is what `/admin/join` depends on. `tsc` will also happily accept a
server action defined inside a `"use client"` file, which compiles and then does
nothing.

**And look at the screen.** Round 12's worst defect — a $0.50 suggested price,
$8.73 profit and a 97% margin printed on a piece with no print time and no
filament — was invisible to the typecheck, the lint, the build and all 50 SQL
assertions. It took opening the page.

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

### The webhook harness — rebuilt in round 17, and now in this repo

```bash
node scripts/check-webhook.mjs      # 91 assertions across 12 scenarios
```

Neither the checkout replay nor the SQL harness touches
`app/api/webhooks/stripe/route.ts`, which is the highest-consequence file in the
project. **`scripts/check-webhook.mjs` does**, with its four fakes in
`scripts/webhook-harness/`, and it covers the scoop half of
`app/api/checkout/route.ts` as well. It loads the **real** route modules through
`jiti` so the TypeScript and the `@/` aliases resolve exactly as Next resolves
them; only four edges are faked — Supabase, Stripe, the mail provider and the
costing tables. Nothing in the routes is copied or re-implemented, because **a
test that asserts against a copy of the code is a test that passes after the
original is broken.** Last run **91/91 across 12 scenarios**, with five
deliberate mutations of the routes each proved to fail it.

**Why this exists at last.** Round 7 built a 43-scenario harness in
`/tmp/webhook-harness/`; it did not survive its session, and this file has said
ever since that it must be rebuilt **before the webhook's payload changed
again**. Lucky Scoop changed the payload — a line with no product row, which
must be written to `order_items` with a tier id and must be kept out of stock
claiming — so round 17 is the rebuild, and it is in `scripts/` precisely so the
next change to this route starts with something to run.

**What the rebuild does NOT cover**, stated so a green run is not mistaken for
more than it is: Stripe signature verification (`constructEvent` is faked, so an
unsigned payload is accepted here and is not in production); real PostgreSQL —
constraints, RLS and grants are `verify.sql`'s job, and the one constraint the
fake enforces is the scoop/product mutual exclusion, because a route that
breached it is what these scenarios hunt for; real Resend delivery and `after()`
on a live Fly machine, both still in the reading-only list below; and **the
delayed-payment, expired-session and paid-while-cancelled branches**, which
were in the lost harness, are not rebuilt, and are the first thing to add back.

The old harness's coverage list is kept here as the target for that work, not as
a description of what runs today:

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

> **What it applies, and why there is no list.** `scripts/verify-sql.sh` globs
> **every `.sql` in `supabase/migrations/`**, sorts it under `LC_ALL=C` and
> applies the lot before the seed, then prints `applied N migration(s)` so a run
> says out loud how much schema it saw. The list used to be written out by hand
> and fell behind twice — `0002_shipping.sql` sat unapplied for two rounds while
> `verify.sql` asserted against it, and the run stopped at
> `products.weight_grams` rather than failing an assertion, taking 29 shipping
> checks with it. **A migration that is never applied cannot fail; it just
> removes its own evidence.** A drop in that `applied N` number between two runs
> is the signature.
>
> `verify.sql` is **126 assertions, and 126/126 has been run and observed** —
> 24, then 29 with shipping, 50 with the staff area, 52 with the letter-eligible
> default, 65 with `0005_sale_integrity.sql`, 86 with `0006_enquiries.sql`, 126
> with `0007_lucky_scoop.sql`. **Count the rows as well as the ticks**: a shorter
> table is an older copy of the file, which is a green result that never looked
> at part of the schema. A table that is short and a run that *aborts* are
> different failures — an unapplied migration does not shorten the table, it
> raises at the first assertion naming an object that is not there.
>
> ⚠️ **`supabase/storage.sql` is deliberately NOT applied by the harness** and
> is not a migration. Storage is a platform feature; vanilla PostgreSQL has no
> `storage` schema. Guarding it with an `if exists` would make the harness skip
> it silently and print a full row of ticks about a bucket it never created. It
> is run by hand, once, in the Supabase SQL editor.

One command, self-bootstrapping. It drives a **locally installed PostgreSQL
16** (`apt install postgresql-16`) — `initdb`s a disposable cluster outside the
repo on first run, starts it on a unix socket, recreates the database from
empty, applies the Supabase stand-ins the migration needs (the `anon` /
`authenticated` / `service_role` roles, `auth.users`, `auth.uid()`, `pgcrypto`),
then applies the migration and the seed, runs `verify.sql`, prints the
assertion table and **exits non-zero if any row is not `t`** — so it can gate a
release. It refuses to run on any server that is not 16.

> **The schema is the seven files in `supabase/migrations/`** — `0001_init.sql`,
> `0002_shipping.sql`, `0003_admin.sql`, `0004_letter_eligible_default.sql`,
> `0005_sale_integrity.sql`, `0006_enquiries.sql`, `0007_lucky_scoop.sql`, in
> that order. **Only the first three are applied to the live project**; the
> other four land on the owner's next push, because `scripts/migrate.sh` now
> runs as part of the deploy. That is what was in the directory
> when this was written; the harness globs rather than reading this list, so
> trust `ls supabase/migrations/` over this sentence. There is no
> `supabase/schema.sql`. This document and `CLAUDE.md`
> both used to say to pipe `schema.sql`, and that cost someone real time — the
> migrations *are* the schema.

Docker remains the alternative where a local Postgres is not wanted, but note
that Docker was unavailable in the environment this was last verified in, which
is why the script exists:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), the service_role/anon/
# authenticated roles and pgcrypto in an `extensions` schema first, then pipe
# every file in supabase/migrations/ in order, then supabase/seed.sql and
# supabase/verify.sql through
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

Seven review rounds, then a hosting migration, then four rounds of building.
Rounds 1–7 were each an independent full-codebase pass, then fixes, then
re-verification. Round 6 is the remediation of §0 and the adversarial pass over
those fixes; **round 7 is the adversarial pass over round 6, and it found that
the §0.1 email fix had reproduced the defect class it was closing.** If you read
only one, read 7 — its closing paragraph is the design rule. **Rounds 8 to 13
are not reviews**: hosting, postage, the pre-launch remediation, the staff area,
the first session against the deployed shop, and this one. They are recorded
here because their findings are constraints on future code.

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
been removed, with the reason written where it stood. `@stripe/stripe-js` was
likewise a dependency nothing imports; `package.json` was deliberately left
alone here, and the dependency was finally removed in round 13.

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

**What was NOT done in this round** — all of it closed in round 10, which is
the next section; read this list as the state on 25 August 2026 and not as work
outstanding. Phase 1 was the quoting engine, and none of it was reachable from
the site:

- **Nothing imports `lib/shipping/`.** `app/api/checkout/route.ts:499` still
  called the flat-rate `shippingCost()`. That was the wiring job.
- No `POST /api/shipping/quote` route, no cart UI, no copy changes.
- `scripts/verify-sql.sh` applied only `0001_init.sql`, so the SQL harness could
  not run the 29 assertions (§4).
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

### Round 10 — the pre-launch remediation, and postage finally wired

Ten commits on `master`, `d3f2946` through `8131290`. Two jobs in one round:
closing the §0 remediation the owner could see, and connecting the quoting
engine round 9 had deliberately left unwired.

**Postage is connected, and there is no flat rate anywhere any more.**
`quoteBasket()` prices the basket in `app/api/checkout/route.ts`, in the new
`POST /api/shipping/quote`, and in the cart. Both surfaces build their lines with
`toShippingLines()` (`lib/shipping/lines.ts`) over rows from
`loadProductsBySlug()` — one builder, one loader — so the price a customer agreed
to and the price Stripe charges cannot be computed two different ways.
`shippingCost()` was **deleted rather than deprecated**: a second function still
shaped like a price is one a future call site reaches for by mistake.
`isFreeShipping(subtotal, methodId)` decides *who pays*; `quoteBasket()` decides
*how much*. They must never be merged.

**`transitLabel()` now takes `tracked` as a required argument.** It used to
hardcode "· tracked", which was true only while everything shipped as a parcel —
and `letter_eligible` is a checkbox in the Supabase table editor, so one tick
with no deploy would have armed the lie. Never pass it a literal; that is the
hardcode again, just moved. A page with no basket to ask uses
`transitRangeLabel()` and makes no tracking claim at all.

**A dropped line is not an empty basket.** This shipped as a live $0.00-postage
bug before it was caught: `toShippingLines()` skips a slug it has no product row
for, and a basket that loses every line looks like an *empty* basket to
`quoteBasket()`, which correctly quotes nothing for it. Correct for nothing, and
wrong for a basket. `/api/shipping/quote` now returns 409 when any line was
dropped.

**The SQL harness was taught to apply `0002_shipping.sql`, and then found to be
lying about something else.** With the migration applied the run printed 29/29 —
while `0001_init.sql` **could not be applied to a real Supabase project at
all**. The stand-in installed `pgcrypto` into `public`, where it sat on the
default search path; hosted Supabase puts extensions in an `extensions` schema,
and `next_order_number()` pins `search_path = public`, so on the real platform it
could not resolve `gen_random_bytes`. **A stand-in has to reproduce the hosted
platform's shape, not just its API.** The shim now creates the `extensions`
schema and installs `pgcrypto` there.

**The Supabase key leak dates from this round.** An anon key and a `service_role`
key were exposed in chat. It is closed — see round 12 — but the rule it leaves
behind is the one worth keeping: `service_role` bypasses row-level security
entirely, so a leak of it is a leak of every order, address and profile in the
project, and the only remedy is rotating the JWT secret that signed it.

### Round 11 — the staff area

The shop had no screen for the person running it: nothing wrote
`orders.tracking_number`, and the status progression customers were shown
advanced only by a hand edit in the Supabase table editor. Round 11 built
`/admin` — Overview, Orders (with a form for typing in a market or TikTok sale),
Products (list, edit, new), Inventory, Reports, Colours, Settings and Studio
access — and `supabase/migrations/0003_admin.sql` behind it: `staff`,
`staff_invitations`, `colours`, `filament_stock`, `shop_settings`, `accessories`
and `product_filament`. `verify.sql` went from 29 assertions to **50**.

**Authority is a separate table, and that is not a style choice.** `0001_init.sql`
grants every signed-in account UPDATE on its own `profiles` row across *all*
columns, and RLS cannot restrict a policy to a subset of columns — a `role`
column there would be self-assignable over PostgREST with the anon key that
ships in the browser bundle. One HTTP request and a customer is an admin. So
every table that decides authority or exposes cost has RLS on, **no policy at
all**, and an explicit revoke from `anon` and `authenticated`; only the
service-role key reads them. The consequence: **the role cannot be checked in
`proxy.ts`**, which holds only the anon client. `requireStaff()` is called by
every page, route handler and server action, because a layout is not a security
boundary for a route handler and a server action is a public HTTP endpoint with
a generated id that anyone who has loaded the shop can find.

**Costing is a transcription and stays one.** `lib/costing.ts` reproduces the
workbook's Products sheet, columns T–AA, with the workbook's own formulas quoted
in the comments: fractional cents throughout — a keyring is 9.5c, packaging 13c,
the machine 10.49c an hour — with exactly one rounding, at the end, into the
price. Nulls stay null. `scripts/check-costing.mjs` checks it against the values
Excel itself cached.

Four findings, and each one is a trap rather than a bug:

- **The SQL harness was measuring the absence of a grant, not the presence of a
  revoke.** Deleting a `revoke` from the migration left every "anon cannot read
  X" assertion green. Hosted Supabase grants every new `public` table to `anon`
  as it is created — that is *why* those revokes exist — and vanilla PostgreSQL
  does not. So the harness was passing for the wrong reason, and every privacy
  assertion in `verify.sql` was worthless, and worse than worthless because it
  read as evidence. The shim now sets Supabase's default privileges, and each
  revoke was deleted one at a time to watch its assertion go red. **Third round
  running in which a stand-in for a hosted platform failed to reproduce that
  platform's shape.** Prove an assertion bites before believing it.
- **"Is the table empty" is a question about the database, not about who is
  asking.** The staff area had a friendly "nobody runs this studio yet" screen
  while `staff` was empty — and served it, with a 200, to any signed-in
  customer, for every `/admin` URL, in the window between deploying and
  claiming.
- **`tsc` and `eslint` both passed on a build that could not compile.** One
  `export const` in a `"use server"` file; Turbopack reported the module as
  having no exports and eleven pages went down. `npm run build` is on the check
  list because of this (§4).
- **The spreadsheet's Suggested price column has never produced a number.**
  Settings C19 holds the *text* `1.6%`, so `1 − margin − fee` is `#VALUE!` on
  every row and IFERROR turns Profit/unit into 0. The site computes it
  correctly, so do not copy prices out of that column.

Two things the first schema draft had flattened were also fixed: filament is
**per colour** (up to four per product, and the whole buy list depends on it),
and accessory cost was a lookup that failed silently — Phone strap, Bag charm
cord and Split ring appeared in the Attachment dropdown and in no cost block, so
IFERROR priced them at nothing. They are a table with a foreign key now, those
three seeded at 0 and flagged **NOT COSTED YET**, so "free" and "not measured
yet" are distinguishable.

`supabase/storage.sql` (the `product-photos` bucket) came with this round and is
**not** a migration: it is run by hand, once, because folding it into `0003`
behind an existence guard would let the harness skip it silently and print ticks
about a bucket it never created.

Pushed and deployed: `9098449` (the staff area) and `6cfdafb` (a way into the
studio that is not typing the URL). The shop is live at
**`bamstudio-shop.fly.dev`**.

### Round 12 — the first session to open the deployed studio

All nine screens opened as the owner, against real Supabase. Everything renders,
nothing 500s, no console errors — and three defects, all of one family: **a
screen stating as fact something that was only unmeasured.** Every static check
in the repo passed on all three.

1. **`1a4e0d0` Stop the studio printing numbers it has not measured.** On
   CLK-035, directly under a panel correctly reading *"no unit cost, so there is
   no margin and no suggested price"*, the product page printed **Suggested
   $0.50 · Profit $8.73 · Actual margin 97%**. `unitCost()` returns 13c —
   packaging alone — with `unknown: true`, and `costProduct()` handed that floor
   to `suggestedPrice()` regardless; the page gated on `suggested === null`,
   which was never true. **The fix went into `costProduct()` in
   `app/admin/data.ts`, not into `lib/costing.ts`**, and the reason is the rule:
   that file is a line-by-line transcription of the workbook, checked against
   Excel's own cached values, and the workbook has no notion of an unmeasured
   input. Knowing that an input is missing is the application's job.
2. **`7c049aa` Give an invitation somewhere to be accepted.** Found by reading
   rather than looking: `inviteStaff` had been handing out links to
   `/admin/join?token=…` since the day it was written, and that route did not
   exist. Every invitation ever made 404d, so Studio and Packing access could not
   be given to anybody — the owner was the only person who could ever be in the
   studio, because hers is the one row placed by hand in the SQL editor. The page
   cannot sit at `app/admin/join`: `app/admin/layout.tsx` calls `requireStaff()`
   and an invited person is by definition not staff yet, so the layout would
   bounce them before they could accept. **The fix is not to weaken that guard.**
   It lives in a route group, `app/(admin-join)/admin/join/` — the URL is still
   exactly `/admin/join`, but layouts nest by folder, so this page is not wrapped
   by the admin layout and every other `/admin` route keeps its guard untouched.
   `resolveJoin()` in `invitation.ts` holds the rules once, shared by the page and
   the action so the two cannot disagree; tokens are stored hashed; the role comes
   off the invitation row and is asserted again before the insert, so a row that
   somehow said `owner` is refused; accepting is a POST, never a page render,
   because a GET that grants authority is one a link preview or a scanner can fire
   on somebody's behalf. **`acceptInvitation` is the one action in
   `app/admin/actions.ts` that does not call `requireStaff()`** — requiring staff
   to become staff is circular — and the gate that stands in for it is narrower
   than any capability in the file: signed in, token hashes to a live invitation,
   **and the signed-in email equals the invited email**. Do not add a second
   exception without the same treatment.
3. **`10a683f` Print the studio's page title once.** Every admin tab read
   "Studio · Bam Studio · Bam Studio". A plain string title augments the parent
   template; `title.absolute` ignores it.

**`proxy.ts` was eating query strings.** A signed-out visitor was redirected to
`/login` with `next` set to the pathname only, so `?token=…` vanished before the
join page ever ran — the invitation link survived sign-in as a page that then
said the link was not valid. It now carries `pathname + search`, clearing the
inherited params first so the original query is not also repeated on `/login` as
loose parameters. **Anything that puts state in a query string dies on that round
trip**, so check it whenever you add one.

**The SQL steps were run against the live project**: `0003_admin.sql`,
`storage.sql`, and the claim statement that makes the owner `owner` in
`public.staff`. `verify.sql` re-run against live Supabase: **50 rows, all `t`**.
The gate was deliberate — until the claim ran, `/admin` turned everybody away,
including her.

**The Supabase JWT secret has been rotated** (owner-confirmed, 26 August). The
round-10 key leak is closed. It is not an open item and should not be raised
again.

**What is still not verified, and it is the top of the list.** The rig used for
the round-11 authorisation testing answers `/auth/v1/user` and `/rest/v1/staff`
truthfully and returns fixtures for everything else — it does not parse
PostgREST syntax — so nothing in it was evidence about an embedded `select`.
Against the real project the three embeds in `app/admin/data.ts` now run without
error, which proves the **syntax parses and nothing more**, because every table
behind them is empty: `product_filament(grams, colours(id, name, hex))` and
`orders!inner(status)` have only ever returned `[]`, and the `order_items`
embeds in `getOrder()` have never run at all, because there is no order to open.
**A query that runs is not a query that is right.**

### Round 13 — the schema harness, the default, and two screens

The changes in the working tree as that round was written. **None of them was
re-verified from that session** — no build, no harness run and no browser — so
read them as "landed", not as "proved".

- **`scripts/verify-sql.sh` no longer keeps a list of migrations.** It globs
  `supabase/migrations/*.sql` under `nullglob`, sorts with `LC_ALL=C` and applies
  every one, then prints `applied N migration(s)`. The glob is collected into an
  array before sorting so an empty directory yields an empty list rather than one
  blank filename, and an empty list is treated as a bad checkout and exits 2.
  §4 has why the hand-written list was the defect.
- **`supabase/migrations/0004_letter_eligible_default.sql`** sets
  `products.letter_eligible` to default **false** and clears rows that carry
  `true`. The repair is gated on the column's own default still being `true`, so
  it fires at most once, on a database where the defect has actually been live,
  and can never touch a tick the owner makes deliberately from now on. A new file
  rather than an edit to `0002` because `0002` has been applied, and editing an
  applied migration leaves the repo and the live schema disagreeing with no way to
  tell which is right.
- **`supabase/verify.sql` went to 52 assertions** (it is **126** today — round
  17 took it there). The two added in this round are deliberately
  separate: one reads the declared default, so it catches a migration that changes
  it; the other inserts a row the way the table editor does — every shipping
  column left alone — so it catches a trigger or a rewritten column that produces
  `true` while the catalogue still says `false`.
- **`@stripe/stripe-js` is gone from `package.json`.** Checkout is
  redirect-based, so no publishable key and no client library are needed; the
  dependency was carried for rounds after the last file that imported it went
  away. `npm run build` after a dependency removal is not optional — it is the
  only thing that shows nothing pulled it in transitively.
- **Sign-up honours `next=`.** `app/signup/page.tsx` reads it, validates it once
  through `safeNext()` and hands it to `SignupForm`, which carries it through
  sign-up, the confirmation email and `/auth/callback`; the "Sign in" link
  carries it too, because a round trip that survives the form and dies on a link
  is still broken. The case it exists for: somebody invited to the studio who has
  no account yet arrives on `/login?next=/admin/join?token=…`, clicks through to
  sign up, and used to finish in the shop's account area with the invitation
  still sitting unopened.
- **`/admin/inventory/measure` — measure the catalogue in one sitting.** A row per
  product: print time, a colour, its grams, Save, next. It exists because none of
  the forty-four products had either input, so every unit cost, margin, suggested
  price and the whole filament buy list were dark, and the only way to turn one on
  was to open a product and fill two areas of a long form, forty-four times.
  `saveMeasurement` in `app/admin/actions.ts` guards on **`catalogue`**, not
  `inventory`: counting a shelf is an observation, typing a print time is
  authoring the cost basis every price in the shop derives from. It refuses grams
  with no colour, a colour with no grams, zero grams and a repeated colour rather
  than silently dropping the line, checks every colour id exists **before** it
  deletes anything (the recipe is replaced by a delete then an insert, and
  PostgREST gives no transaction across the two), and rejects a payload with fewer
  than `MEASURE_COLOUR_SLOTS` slots — a POST that simply omitted the filament
  fields would otherwise read as "this piece uses no colours" and wipe a recipe
  the screen never showed anybody.

### Round 14 — the first real sale, and a screen that shipped 1.2 MB of markup

**The item that had sat in §0 as B is closed.** A real sale was recorded through
Orders → *Record a sale* against a product that had been given a print time and
a filament colour, and the three embedded-resource selects in
`app/admin/data.ts` — the ones that had parsed and returned `[]` every previous
time — returned real rows. The costing chain was then checked by hand against
the live numbers rather than against itself.

**The trap this closes is worth keeping even though the instance is settled.**
Those three queries had "run against real PostgREST" for two rounds. That was
true and it proved nothing: an embedded join against an empty table returns `[]`
in exactly the same shape as a join whose foreign-key path is wrong. **An empty
table is a question about the database, not about the query**, and the two are
indistinguishable from the calling code. Every new embedded select starts in that
position. The only way out of it is a row.

**`/admin/inventory/measure` was serving 1.2 MB of markup.** The screen renders a
row per product with up to `MEASURE_COLOUR_SLOTS` (4) colour slots, and every
slot was a full `<select>` over the whole filament palette, rendered
server-side: 176 selects and 3,344 options for 44 products. Only the **first**
colour slot is rendered server-side now; slots two to four start as hidden inputs
carrying the values the row already has, and `ExtraColours.tsx` opens them on
demand for the one row that asked. **182 KB, 44 selects, 836 options.** The
hidden inputs are not an optimisation detail — they are why a row that is saved
without ever opening its extra slots still submits every slot it had, unchanged.
`saveMeasurement` rejects a payload with fewer than `MEASURE_COLOUR_SLOTS` slots
precisely because a POST that simply omitted them would otherwise read as "this
piece uses no colours" and wipe a recipe the screen never showed anybody.

**Seven admin pages were given their own `metadata.title`.** Every page under
`/admin` inherited one title, so the browser tab, the history and a bookmark all
said the same thing for thirteen different screens. Each now sets `"<screen> ·
Studio"` — Overview, Orders, Products, Inventory, Reports, Colours, Settings,
Studio access, and the detail and creation pages under them.

The byte counts above are as reported by the round that made the change; **they
have not been re-measured from a build here.**

### Round 15 — the security and truthfulness sweep

The largest round since the staff area, and the one with the most reasoning
worth preserving. Nothing in it was re-verified from the session that wrote it:
**no build, no harness run, no browser, and the CSP in particular has never been
loaded by a real browser.** An *enforced* policy that is one origin too narrow is
a broken page, not a console warning, so that is the first thing to check.

**Security response headers — `next.config.ts`.** The shop served none at all.
The hole is specific rather than hygiene: `@supabase/ssr`'s cookie defaults are
`httpOnly: false`, `sameSite: "lax"`, 400 days and **no `secure` flag**, and
`proxy.ts` passes them straight through, while `force_https` in `fly.toml` is a
*redirect* — so the browser has already put the session cookie on the wire in
clear before the redirect comes back. One captured plaintext request is 400 days
of somebody else's account, and the account most worth capturing is the owner's.
Now set on `/:path*` with no exclusions: HSTS, an enforced Content-Security-Policy,
`X-Frame-Options: DENY` alongside `frame-ancestors 'none'`, `nosniff`, and
`Referrer-Policy: strict-origin-when-cross-origin`. Four decisions inside that
are recorded so nobody "tightens" them into a broken checkout:

- **`script-src 'self' 'unsafe-inline'` is a known, documented compromise.**
  Next streams the RSC payload through inline `<script>self.__next_f.push(...)`
  tags in every single response. The only supported way to allow those without
  `'unsafe-inline'` is a per-request nonce generated in `proxy.ts`, and Next's
  own docs state the price: a nonce **forces every page to render dynamically**,
  which on one always-on 512 MB Fly machine is a real bill. So the directive
  does **not** stop injected inline script. What it does stop is an injection
  pulling script from an attacker's host, which is how stolen data usually
  leaves. Tightening it means the nonce plus dynamic rendering, and is
  deliberately not done. `'unsafe-eval'` is added in development only, where
  React uses `eval` to rebuild server stack traces.
- **HSTS deliberately omits `preload`** — one year, subdomains included, not
  preloaded. Preloading submits the domain to a list baked into shipped
  browsers; coming back off it is a removal request plus months of waiting for
  browser releases. `bamstudioshop.com` is bought and still parked. What leaving
  it off costs is stated rather than glossed: HSTS is trust-on-first-use, so a
  browser's very first `http://` navigation is still exposed. That window is
  narrow today only because the whole `.dev` TLD is already preloaded and
  `bamstudio-shop.fly.dev` is forced to https regardless. **It stops being
  narrow the day the shop answers on a plain `.com`** — which is exactly when
  `preload` should be added.
- **The policy was derived from evidence, not from a template.** After
  `next build`, the only absolute origins left in `.next/static/chunks` are the
  Supabase URL, our own site URL, the SVG `xmlns` namespace (never fetched) and
  documentation links inside error messages. `font-src 'self'` because
  `next/font/google` downloads and self-hosts at build time and the browser
  never contacts `fonts.gstatic.com`. Re-run that grep after adding any
  browser-side integration.
- **`form-action 'self'` does not list Stripe, and must not.** Checkout reaches
  Stripe by `window.location.href = data.url` — a top-level navigation, which
  `form-action` does not govern and neither does any other directive browsers
  implement. Listing Stripe would document a cross-origin form POST that does
  not exist. Equally, `/api/webhooks/stripe` is **not** excluded here even
  though `proxy.ts` excludes it: the proxy's exclusion is about the *request*
  bytes Stripe signs over, and this config only adds *response* headers, which
  Stripe's client discards. Copying the exclusion would take its shape without
  its reason.

**`/order/confirmed` was the only route family with no rate limit.** It reads a
Stripe session by id. The check is placed inside the `if (sessionId)` branch, so
a visit carrying no `session_id` calls Stripe not at all and spends nobody's
allowance, and it returns **before** the Stripe calls, because throttling that
still spends the quota protects nothing. Two consequences deliberately preserved:
the early return means `<ClearCartOnMount />` never renders, so a throttled
basket survives exactly as an unpaid one does; and the throttled copy claims
**nothing** about the payment, because we did not ask Stripe and do not know.
Telling someone who has just been charged that no money was taken is the one
mistake that page exists to avoid.

**Six untrue customer-facing statements removed.** Each had been true-shaped
rather than true:

1. **"0 reviews" under every search suggestion.** `SearchBar` printed the count
   unconditionally, so every suggestion in the shop read "$9.00 · 0 reviews". No
   product has a review and none is invented; a count of zero printed as fact is
   a claim about a review history that does not exist.
2. **The FAQ and `/track` promised a tracking number.** "…scan it in" was an
   unconditional promise, printed to customers whose parcels the shop knowingly
   posts untracked as Large Letters. Pages that describe postage in general
   cannot know which a basket will be — that is `quoteBasket()`'s answer — so
   they must not say. `transitRangeLabel()` exists for exactly this: the
   carrier's transit range with no tracking claim.
3. **`/track` reported rate-limiting and bad input as "no order matched".** Two
   different facts about the *request* were rendered as a fact about the
   *database*. A customer who typed their email wrong, and a customer who was
   simply throttled, were both told their order did not exist.
4. **The builder claimed letters are "always in stock"** and added a day nothing
   added. Neither was derived from anything.
5. **A promise to email for a review that nothing sends.** The same class of
   defect as §0.1 and round 7 — a claim about a capability, checked against
   nothing.
6. **A "Highest rated" sort over an all-zero column.** Every product is
   `rating: 0`, so the sort was really an arbitrary order presented as a ranking,
   in a shop that suppresses ratings on every other surface. Removed from the
   `ProductFilters["sort"]` type and from both query builders; a bookmarked
   `?sort=rating` falls through to the default rather than erroring, because a
   shared link outlives this change.

   Also on `/track`: **a market sale read as though it had been posted.** A sale
   typed in at a stall is written straight to `delivered` and never had a parcel.

**Money integrity — `0005_sale_integrity.sql` and the code around it.** Six
defects, all of which lost or hid money:

- **`orders.confirmation_email_sent_at`.** The confirmation was sent with no
  record that it had been, so a send lost to a stopped machine was lost for
  good. The webhook now stamps it under a `.is(…, null)` filter, which makes a
  Stripe redelivery either recover a lost email or do nothing — never send
  twice. `getStudioAttention()` counts **website** orders that are numbered,
  past `pending` and still unstamped; market sales are excluded because they
  never had a confirmation to send, and counting them would report a backlog
  that does not exist.
- **`unit_cost_cents` is now written for web sales as well as market sales**,
  from one shared helper — `unitCostsAtSale()` in `app/admin/data.ts`, called by
  both `app/api/checkout/route.ts` and the webhook. It had been written in
  exactly one place, the market-stall form in `recordSale`, so every website
  sale landed with a null cost and Reports had nothing to subtract for the
  shop's **main** channel. Reports was honest about the hole — it counts the
  lines carrying no cost and says the profit understates what was spent — but
  *honest about a hole* is not the same as *measurable*. It is **stamped, not
  derived**: the column records what the piece cost when it sold, and computing
  it at read time would rewrite every historical margin the next time filament
  or an accessory changed price. It stays **null** for a product with no print
  time or no filament recipe, because a 13c "cost" is a 97% margin on a piece
  nobody has timed, and null is the honest answer.
- **`decrement_stock` is atomic, and it answers.** It takes `select … for
  update` on the product row before the arithmetic, so a concurrent call — a
  second webhook delivery, or a market sale typed in while a website order
  confirms — waits rather than reading a value about to be stale. The
  read-modify-write that used to live in `recordSale` cannot exist inside one
  locked transaction. It now returns the **shortfall**: how many units were sold
  that the ready-to-ship buffer did not have. `0` is the ordinary answer; `null`
  means no such product, which is a different question from a sale that took
  nothing.

  **The decision behind it is the part to preserve.** Overselling stays allowed.
  This shop prints to order, and stock only moves in the webhook *after*
  payment, so a stock check at checkout guards a window it does not own — two
  shoppers can both pass it, and the loser would be refused **after being
  charged**, which is worse than printing one more. So the cost of allowing it
  is paid by making it visible: the shortfall accumulates on
  `products.oversold_units`, the webhook logs the order it happened on, and the
  studio overview shows it. It is a print-this-first queue signal, not an error.
  Nothing decrements it automatically; the owner clears it when the backlog is
  printed.
- **`recordSale` no longer leaves an order with no lines counted as revenue.**
- **A customer charged for an already-cancelled order is recorded**, in the new
  `public.payment_incidents`, and surfaced on `/admin`. The webhook correctly
  refuses to number such an order, move its stock or email its customer — but
  its entire response was a `console.error` saying "refund this one by hand" and
  a 200 to Stripe. The customer is charged, receives nothing, and the only
  record is a log line on a platform nobody reads. **Money the shop owed back
  was invisible.** A row rather than a column on `orders`, because the incident
  is a fact about a *payment*, needs its own resolution state, and there is no
  guarantee the order row still exists to hang it on (`on delete set null`:
  losing the order must not lose the debt). `stripe_session_id` is unique, which
  is what makes recording idempotent under redelivery. RLS on with **no policy**
  plus an explicit revoke — the pattern `0002` and `0003` document, because
  hosted Supabase grants every new `public` table to `anon` as it is created.
  `resolveRefundIncident` (guarded on `orders`) marks one issued. **The refund
  itself stays manual and always will**: refunding is a decision with a customer
  at the other end of it, not something a webhook should take on its own.
- **`removePhoto` could delete any object in the storage bucket from a form
  field.** `path` was passed straight to `storage.remove()` on the
  **service-role** client, which bypasses RLS and every storage policy, and the
  only surrounding check merely filtered this product's own JSON array. A POST
  with this action's id and any other object's path deleted that object — every
  photograph in the bucket was one request away from anyone holding a
  `catalogue` capability, which staff invitations grant. The product's stored
  photo list is now the authority. **Deliberately not a path-prefix check**:
  `uploadPhotos` happens to write `<product id>/<random>.<ext>`, but that is a
  naming convention, and a rule derived from a convention stops holding the day
  the convention changes.

**Basket limits are enforced in the cart** (20 per line, 40 lines) instead of
only being rejected at checkout. A breaching basket used to be refused by
checkout with a blanket `{ error: "Invalid basket." }` and by
`POST /api/shipping/quote` with a 400 the cart could only render as "Calculated
at checkout" — a customer left with no total and no reason. **The known defect
in the fix is recorded in the file that carries it**: `components/cart/limits.ts`
says out loud that these belong in `lib/config.ts`, that it is a stopgap, and
that **the real limits are four literals in two Zod schemas** with nothing
enforcing that the three copies agree. It lives there only because the round
that found the defect did not own `lib/config.ts`. Change one, change all three.

**`Field` in `components/ui` announces its errors to screen readers.** The
message carries `role="alert"` rather than `aria-live="polite"` — it is mounted
at the moment it appears, and a live region's first announcement of its own
content is unreliable, whereas `role="alert"` announces on insertion. The
control gets `aria-invalid` and its own `aria-describedby` is preserved with the
field's id appended rather than overwritten, and the message is prefixed
"Error:" so it is identifiable when read out of context.

**`supabase/verify.sql` went from 52 assertions to 65** in this round (**126**
today — round 17 took it there), and it is one
table. The three new groups cover exactly the three behaviours above, against
throwaway rows inside a transaction it rolls back: the confirmation-email stamp,
a sale within stock and a sale past it, and the incident register including that
a redelivery records **one** incident. Note what that does and does not prove:
it proves the schema and the grants, not that the webhook calls any of it
correctly. The RLS-count assertion is `= 17`, deliberately exact rather than
`>=`, because a new table that forgets to enable RLS lands in `public` readable
by the anon key.


### Round 16 — the customer's message is a row before it is an email

**The defect.** `/api/contact` handed the enquiry to Resend and stored it
nowhere. The route said so in its own comment — *"Nothing is persisted — there
is no enquiries table — so the email IS the delivery"* — and on a failed send it
answered `{ ok: true, delivered: false }`. That is an honest answer to the
customer and a **total loss to the shop**: the words they typed existed only in
the HTTP request, and once the send failed there was nothing left anywhere.
Three ordinary configurations lose the message outright, and none of them is
exotic: `RESEND_API_KEY` or `EMAIL_FROM` unset, which are secrets a shop can
deploy without; `NEXT_PUBLIC_SUPPORT_EMAIL` unset, so there is no address to
send to; or Resend answering 4xx/5xx, or not answering inside the 8-second
timeout.

**It matters more here than it would elsewhere.** This shop states in several
places, the legal pages included, that it sends no order emails at all — so the
contact form is one of a very small number of channels a customer has. A
pointer rather than legal advice, recorded in the migration itself: under the
Australian Consumer Law a message reporting faulty goods starts a consumer
guarantee claim, and that is precisely the message that must not vanish. Whether
a given enquiry does so is a lawyer's question; **the engineering conclusion
stands on its own — a channel the shop advertises must not depend on a
third-party API call succeeding on the first attempt.**

So the row is written **first**, and the email becomes a notification about a
row that already exists. A failed send now costs the owner a prompt, not the
customer their message. Do not reorder those two.

**Two tables, not one**, and the reasoning is the transferable part. An enquiry
and a sign-up arrive through the same shaped route, and that is all they have in
common:

- **An enquiry is a piece of WORK.** Name, topic, free text, an optional order
  number; answered once and then done, so it carries `handled_at`/`handled_by`
  and every message is its own row. **Writing twice is two enquiries, and must
  be** — a customer who follows up has said a second thing.
- **A sign-up is a MEMBERSHIP.** One address, held for as long as the shop might
  mail it, and asking twice is the same fact stated twice — so the lower-cased
  address is the primary key and a repeat submission is idempotent. Its
  lifecycle ends in an unsubscribe, not a reply, and `unsubscribed_at` is
  *recorded* rather than the row deleted, so an address that has been taken off
  cannot be silently re-added by a later `on conflict do nothing` insert.

Folded into one table, half the columns are null for half the rows, the
unique-address rule cannot be expressed (wrong for enquiries, required for
sign-ups), and clearing out answered enquiries would delete the mailing list.

**Why there is no anon insert grant, on tables anonymous strangers write to.**
The obvious alternative is `grant insert to anon` with an insert-only RLS
policy, letting the browser write its own row. It was considered and rejected.
The anon key ships in the browser bundle, so that grant *is* a public PostgREST
endpoint accepting arbitrary rows into the table: it walks straight past the
route's zod validation, its rate limiter and its topic enum, and the CHECK
constraints become the entire defence. `/api/contact` already runs server-side
(`export const runtime = "nodejs"`), so the service-role client is right there —
the row is written by the same code that validated it, and the public key gets
nothing at all. **A write-only grant is also not the harmless thing it sounds
like**: `insert … returning` and constraint-violation messages both leak, and a
duplicate-key error on `newsletter_signups` would turn a write-only grant into
an oracle for "is this address on the list". Both tables are `service_role`
only, in and out — RLS on with no policy plus an explicit revoke, the pattern
`0002`, `0003` and `0005` document.

**`notified_at` is a fact, not a status.** It is the same shape and the same
reasoning as `orders.confirmation_email_sent_at` in `0005`: null means no
studio-notification email has gone out for this row. It does **not** mean the
enquiry was lost — the row is the delivery now — it means the only way the owner
finds this one is by looking. A shop with no mail provider configured leaves
every row null, which is true, and the reader asks `isEmailConfigured()` at read
time rather than having this schema mirror a deployment setting it cannot see.

**The length bounds are duplicated from the zod schema in
`app/api/contact/route.ts` on purpose, and the two must move together.** The
route validates; the table is the backstop that makes an unbounded message
impossible no matter which code path writes it. `message` is the only free-text
field a stranger controls.

**What this does NOT create.** There is still **no newsletter, no welcome email
and no unsubscribe link.** `newsletter_signups` is a record that somebody asked
— worth having as evidence the address was volunteered, *before* a first mailout
is ever sent rather than after — and it is not a mailing list that is sent to.
**No copy on the site may promise one.** The table comment says so, and it is
there because this is exactly the shape of §0.1 and round 7: a claim about a
capability, checked against nothing.

**Abuse, written down so nobody re-derives it.** These are unauthenticated
endpoints that now write rows. What stands in front of them is
`rateLimit(clientKey(request, "contact"), 5, 60_000)` — five posts per minute
per client, in a `Map` in one process, resetting on every deploy, with "client"
meaning an IP address, so a caller with a pool of them has a proportional
allowance. That is the same limiter §6 has wanted moved to shared storage since
round 8, and it now guards one more thing.

**`supabase/verify.sql` is 86 assertions**, up from 65. The RLS-count assertion
moved to `= 19` — deliberately exact rather than `>=`, because a new table that
forgets to enable RLS lands in `public` readable by the anon key. The new
assertions cover an enquiry stored as sent, an over-long message rejected, an
invented topic rejected, anon and authenticated locked out of both tables, a
repeated sign-up recording once, a mixed-case address stored lower-cased, and an
unsubscribe surviving a later sign-up.

**Nothing in this round has been verified by running it.** The count above was
read off the file, the behaviour off the code.

### Round 17 — Lucky Scoop: the one product sold before anyone knows what is in it

Built in four phases — the schema and the pure rules; the reads and the studio;
the shopfront and the copy; the basket, checkout and webhook — and the whole
feature turns on one sentence.

**A SCOOP IS SOLD BEFORE ITS CONTENTS ARE DECIDED.** A bowl of small charms at
the stall: the customer buys a **tier** ("Pet scoop, five pieces") and gets a
random selection drawn from a defined pool of products, and a person draws the
pieces by hand, on camera, when the order is packed. Everything else in this
shop is printed to order with a cost known before the sale — `unitCostsAtSale()`
stamps `order_items.unit_cost_cents` at checkout from the product's own recipe.
A scoop inverts that, and **three consequences follow that an agent will
otherwise "fix" back out**:

1. **No stock comes off at the sale**, because at the sale nobody knows which
   products. It comes off when the pack is recorded, one `decrement_stock` call
   per piece, guarded by `scoop_packs.stock_applied` — the same compare-and-set
   shape `orders.stock_applied` uses, so a double-clicked or retried pack panel
   cannot take the same pieces twice. **The absent decrement in the webhook is
   the design.** Scoop lines are excluded from stock claiming *structurally*
   rather than by a filter somebody could delete: `stockMap` takes
   `SummaryLine[]`, scoops live in `scoopSummary`, and the compiler will not let
   one be passed for the other.
2. **Cost is recorded at pack time**, summed from the pieces that actually went
   in, which is what makes the margin real rather than assumed.
   `scoop_pack_items` carries its own `unit_cost_cents` **per piece, stamped
   when packed**, for exactly the reason `order_items.unit_cost_cents` exists: a
   cost derived at read time rewrites every historical margin the next time
   filament changes price. The pack's total is deliberately **not** a column —
   it is the sum of those rows, and a stored total is a fifth number that can
   disagree with the four it adds up. `packCost()` in `lib/scoop.ts` is the one
   place that sum is computed, **and it answers `null`, not a partial sum, when
   any piece is unmeasured.** Adding up only the measured pieces understates the
   cost by however much the rest cost, and the margin computed from it is wrong
   in the flattering direction — round 15's plausible zero wearing a new hat.
3. **The overselling rule does not apply, and both rules are now true at once.**
   This is the paragraph to read twice. `0005_sale_integrity.sql` decided at
   length that this shop **keeps selling** when the shelf is empty:
   `decrement_stock` returns a shortfall rather than refusing, `oversold_units`
   accumulates it, and the studio prints the backlog. **That decision stands and
   nothing here changes it.** But read its premise — everything else is printed
   to order, so `stock_on_hand` is a buffer of pieces already printed, not the
   only ones that exist, and refusing would turn a two-day print into a lost
   order. A scoop breaks the premise: its promise is "these exist now, and five
   of them are going in a bag", and you cannot print a surprise on Tuesday to
   satisfy Monday's order without deciding for the customer what they got. So
   **a tier stops being OFFERED when its pool cannot fill it.** That is a
   *listing* decision asked at read time, not a refused decrement — nothing in
   the scoop path rejects a sale after payment. **The race is smaller, not
   gone**, and that is the honest claim: two shoppers can still both see the
   last fillable scoop, but a miss on an ordinary product means printing one
   more, while a scoop that cannot be filled needs a person — a substitution the
   customer can see was not drawn, or a refund — and the pack panel is where a
   human finds out.

**The tier is the product, and it is deliberately not a `products` row.** A
product row carries a price that is always set, a stock count decremented at
sale, a filament recipe that produces its cost, and a weight of its own. A tier
has none of those: its price starts **null** (never 0 — a zero renders as a free
scoop, and `> 0` rather than `>= 0` is what stops the two being confused), its
stock is a property of a pool of other rows, its cost is not knowable until it
is packed, and its weight is a worst case somebody chose rather than something
that was weighed. Folding it into `products` would mean every one of those
columns lying for scoop rows, and every query in the shop learning to ask which
kind of row it is holding.

**The eligible pool is explicit rows, never a category filter**, and this is the
decision most likely to be "simplified" later. `scoop_tier_products` could have
been a `category = 'Clicker keychain'` filter on the tier. A filter is a rule
about a column somebody edits somewhere else: the day a pet bowl is filed under
the category a clicker scoop draws from — a rename, a new product typed in at
midnight, a tidy-up of the category list — the bowl silently joins the pool.
Nothing raises, nothing is logged, and the first anyone knows is a $2 scoop that
cost $9 to make and does not fit the postage band the tier is quoted on. Rows
also make the promise **describable**: the tier page can say "five pieces drawn
from these twelve" and show them, which is the difference between a surprise and
an unknown — and under the ACL a description binds, so the pool being visible is
what makes the description true. `on delete restrict` on `products`, for the
reason `product_filament` restricts deletes of `colours`: deleting a pooled
product would silently shrink a live tier below what it promises. Deactivate
instead; the availability rule already understands that.

**Small items only is a schema decision, not decoration.** A tier carries ONE
`packed_weight_grams` for postage, and a pool that can produce either a charm or
a pet bowl has no honest weight to carry. The weight must be the **worst case**,
not the average — the studio wears the difference on every order where the real
pack is heavier — which is only possible to set honestly when every piece is the
same order of size. `scoop_tiers` deliberately has **no `letter_eligible`
column**: a scoop is quoted as a parcel, full stop, because a Large Letter is
untracked and uninsured and a parcel whose contents were chosen at random is the
last one to send that way — if it goes missing there is no reprint, the pieces
are gone. `toScoopShippingLine()` writes `letter_eligible: false` **explicitly**
anyway, at the one line of code where a future reader would otherwise have to
guess whether the column had merely been forgotten. One scoop therefore makes
the whole basket a parcel, which is correct: it is going in the same mailer.

**What the schema enforces and what it refuses to pretend to.** It **can**
enforce the static half — an active tier's pool must hold at least
`piece_count` products — and does, with a constraint trigger deferred to commit
so that creating a tier and filling its pool in one transaction works in either
statement order. A tier promising five pieces from a pool of three is not a
stock problem; it is a tier that was never fillable. It **cannot** enforce the
stock half and does not try: `stock_on_hand` changes with every sale and every
print, so a CHECK consulting it would be re-evaluated on every product write and
would fire on the studio's own inventory edits. Activation also requires a price
and a packed weight, as a named constraint added by drop-then-add rather than
inline — an inline check is skipped entirely on a database that already has the
table, so a re-run could never repair it.

**`scoopsAvailable()` counts DISTINCT products, and that is the conservative
reading on purpose.** With stock counts c₁…cₙ, `m` duplicate-free scoops can be
built exactly when Σ min(cᵢ, m) ≥ m × pieceCount. Whether a scoop may contain
two of the same charm is one of the owner's decisions and is not settled; the
distinct rule is true under **either** answer — a pool that can produce five
different pieces can obviously also produce five pieces — and where it errs it
errs by listing one fewer tier rather than by promising a bag that cannot be
filled.

**There is no randomiser, and there must not be one.** `lib/scoop.ts` holds
availability, cost and a suggested price, and nothing else. The shop does not
pick the pieces — a person does, out of a bowl, on camera — and the schema has
no notion of a draw either. Do not add one until she asks. Related, and for the
same honesty: **the theme is the customer's choice, not the draw's.** At the
stall a charm-colour board maps colour to category and the scoop decides which
category you get; online that mechanic sells somebody pet things when they
wanted clickers, and "goods must match their description" is not waived by
calling it lucky. The customer picks the theme; the draw decides only which
pieces come out of it. The board stays in the video, where it is theatre rather
than a term of sale.

**`suggestedTierPrice()` answers `null` whenever the pool is not fully
measured**, and that is the most important line in `lib/scoop.ts`. Zero of
forty-four products have a measured cost today, so almost every pool answers
null — which is correct and is the point. Averaging the pieces that *have* been
measured would put a number on the screen beside the field she is about to price
from; two of twelve measured makes that a guess dressed as arithmetic. Null lets
the studio say "3 of 12 pieces measured" instead, which is true and is also the
nudge to go and measure the other nine. (A note so nobody adds it twice: each
piece's cost already includes `packagingPerUnitCents`, so a five-piece scoop
carries five lots of it — deliberately, because it errs towards a higher
suggestion. The per-order mailer is **not** added; it is charged once per posted
order and never inside a unit cost.)

**The basket line became a discriminated union**, and a widened type is not an
acceptable simplification of it. `BasketLine = ProductBasketLine |
ScoopBasketLine`, each carrying the other's discriminant as `never`, narrowed
only through `isScoopLine` / `isProductLine`. One widened type with an optional
`scoop_tier_id` would still carry `product_id: string`, so a scoop line would
have to put *something* there — and every candidate is either a real id that
checkout would price and decrement, or an empty string that reads as a product
to every `if (line.product_id)` in the codebase. The union puts `order_items`'
own CHECK in front of the compiler: `CartView` cannot post a basket without
deciding, per line, which body it is building. Three details that look
accidental and are not: **both** guards are exported, because `!isScoopLine(x)`
does not narrow inside a `.filter()` callback; `NewBasketLine` is spelled out
member by member rather than as `Omit<BasketLine, "key">`, because `Omit` over a
union collapses it to the shared keys and throws every discriminant away; and
the storage key is **still** `bamstudio.cart.v1`, because bumping it would have
been the easy way to avoid thinking about old baskets and would have silently
emptied the basket of every shopper mid-purchase at the moment of deploy. A
stored line carrying **both** ids is dropped rather than repaired into one or
the other, which would be a guess at what somebody meant.

**A scoop has to survive a trip through Stripe, and that needed a marker.** When
the database is unreachable at checkout no order is staged and the webhook
rebuilds the whole order from the Stripe session, resolving each line to a
product row **by slug** — and `scoop_tiers.slug` and `products.slug` are
separate unique indexes on separate tables, so nothing stops a tier called
`mixed-scoop` and a charm called `mixed-scoop` existing side by side. A rebuild
with no marker would find the charm, write its `product_id` onto the line, and
then take that charm off the shelf for a scoop nobody has drawn. `SCOOP_METADATA`
in `lib/scoop-line.ts` is what lets the rebuild tell the two kinds of line apart
**before** it looks anything up, and it carries the tier's **id**, not its slug,
because the id is what `order_items.scoop_tier_id` needs and a slug can be
renamed between the session being created and a delayed payment clearing days
later.

**The order cannot be marked posted until its scoops are recorded**, enforced in
`app/admin/actions.ts` rather than in the schema — deliberately, and `0007` says
why: it is a rule about a status *transition*, so it needs both the old status
and the new one, and a trigger enforcing it would also block every hand repair
the studio has to be able to make from the Supabase table editor. What is at
stake is not tidiness: recording the pack is the only moment a scoop's stock
comes off and the only moment its cost is stamped, so a parcel posted before
that leaves the shelf counts overstated for ever, the margin unknowable and the
pieces unrecorded — and by then the bag is sealed and in the post. The guard is
scoped to orders that are **not already** posted, because the same form is how a
wrong tracking number is corrected, and a failed read **refuses**: "we could not
check" is not "there is nothing to check".

**Three decisions were left open on purpose, and the copy says nothing in either
direction on all three.** Whether a scoop may contain duplicates; how the video
is promised; whether a change of mind on a scoop is accepted.
`app/legal/refunds/page.tsx` carries two drafted paragraphs in a comment — (a)
accept, matching stock designs, and (b) decline — for the owner to choose
between. (b) is permitted, because change-of-mind refunds are a goodwill policy
rather than an ACL entitlement, but it must be stated **before** purchase to be
relied on, and if she picks it the same sentence belongs on the tier page. Until
she picks, silence favours the customer, which is the safe direction to be wrong
in. `scoop_packs.video_url` is nullable for the same reason: a `not null` there
would decide the video question for her, and would make every order that arrived
at midnight unpostable until she had filmed it. **Do not close any of the three
by guessing.** They are recorded in §0 as items O and P.

**Everything scoop-shaped on the shopfront is conditional on a sellable tier**,
which is what lets the feature ship before the owner has created one. Nothing is
seeded and `getScoopTiers()` carries no sample tier, so `/scoop`, the home
highlight card, the FAQ answer and the sitemap entries are all absent until a
tier is active, priced and fillable. `/scoop` is deliberately **not** in
`STATIC_PATHS`: unlike `/shop` or `/faq` it can legitimately have nothing to
show, and a sitemap entry is a claim that a URL is worth crawling. The refunds
page is the exception and is stated **unconditionally** — a policy is read after
the sale as often as before it, and gating it on `getScoopTiers()` would delete
the terms that applied to a customer's order the moment the tier they bought
from was retired, which is exactly when they would come looking.

**What was run, and this is the first round since 12 that can say so.**
`./scripts/verify-sql.sh` — **126/126** against a real local PostgreSQL 16 from
an empty database. `node scripts/check-scoop.mjs` — **34 assertions**.
`node scripts/check-webhook.mjs` — **91 assertions across 12 scenarios**, with
five deliberate mutations of the routes each proved to fail it.
`node scripts/check-costing.mjs`. `npx tsc --noEmit`, `npm run lint` and
`npm run build`, all clean. **What was not run:** anything against the live
project — `0007` is not applied there (§0 item J) — and no browser has opened
`/scoop` or the pack panel. The studio screens and the tier pages are
reviewed-by-reading, which is precisely the position round 12's worst defect was
found from.


## 6. Open items

### Left behind by round 15 — read `next.config.ts` before proposing any of it

- **The CSP has never been loaded by a browser.** It is enforced, not
  report-only, and was derived from a grep of `.next/static/chunks` after a
  build. That is good evidence and it is not a test. Load the shop, the cart, a
  product page carrying a photograph (the Supabase storage origin, `img-src`)
  and `/admin`, and read the console.
- **`script-src 'unsafe-inline'` is a known compromise, not a to-do.** Removing
  it needs a per-request nonce in `proxy.ts` and forces dynamic rendering on
  every page — a real cost on one always-on 512 MB machine, and a broken shop if
  half-done. If it is ever taken on, it is a project, and checkout is what
  breaks first.
- **`preload` on HSTS waits for the custom domain.** One word plus a submission
  at hstspreload.org, once `bamstudioshop.com` is live and settled on https. Not
  before: preloading is a one-way door.
- **The basket limits exist in three places** — `components/cart/limits.ts` and
  four literals across two Zod schemas (`app/api/checkout/route.ts`,
  `app/api/shipping/quote/route.ts`). Nothing enforces that they agree. They
  belong in `lib/config.ts`, imported by all three. The file that holds them
  says so itself.
- **`0005_sale_integrity.sql`'s three behaviours are unexercised end to end.**
  `verify.sql` asserts them against throwaway rows inside a rolled-back
  transaction, which proves the schema and the grants — not that the webhook
  calls any of it correctly. What is still owed: an oversell that accumulates on
  `products.oversold_units`; a redelivered Stripe event that does **not** send a
  second confirmation; and a payment landing on a cancelled order that writes
  exactly one `payment_incidents` row and appears on `/admin`.
- ~~**The webhook harness has three more behaviours to cover** and still is not
  in the repo (`/tmp/webhook-harness/`).~~ **Rebuilt in round 17** as
  `scripts/check-webhook.mjs` with its fakes in `scripts/webhook-harness/` —
  91 assertions across 12 scenarios, run, and five mutations proved to fail it.
  **What is still owed is narrower and named** (§4): the delayed-payment,
  expired-session and paid-while-cancelled branches were in the lost 43-scenario
  harness and are not in this one. Add them back before anything touches the
  builder payload.
- **`0006_enquiries.sql` is unexercised end to end too.** The case that matters
  is the one that used to lose the message: post a contact enquiry with the mail
  provider deliberately unconfigured and confirm the row lands anyway. Then a
  repeated sign-up (idempotent), a mixed-case address (stored lower-cased) and
  an unsubscribe surviving a later sign-up.
- **`newsletter_signups` is not a newsletter.** No mailout, no welcome email, no
  unsubscribe link. The table records that somebody asked. Building it or
  removing the form are both honest; the current state is honest only for as
  long as no copy on the site claims otherwise.

### Postage — wired in round 10, and what is left of it

`lib/shipping/` is built, verified against the live carrier API (§5 round 9) and
**connected** (§5 round 10): `quoteBasket()` prices the basket in checkout, in
`POST /api/shipping/quote` and in the cart, and the flat rate is gone from the
code entirely. What remains:

1. **The L2 cache tier** is a marked seam in `lib/shipping/cache.ts`, not an
   implementation. Read the three numbered warnings in that file first; the
   important one is that **a fallback price must never be persisted**, or a
   two-second outage becomes six hours of deliberately-inflated quotes.
2. **Every physical constant in `lib/shipping/dimensions.ts` is an estimate.**
   The owner's three weighings, below, are the highest-value input there is.
3. **`AUSPOST_API_KEY` is not set yet.** Without it every quote comes from the
   pessimistic fallback table and the shop still works, so this is accuracy,
   not function.

**The schema trap here is closed, and this is what it was**, because the shape
recurs. `0002_shipping.sql` declared `letter_eligible boolean not null default
true` while `lib/shipping/weights.ts` documents the opposite contract — "absent
means false", an unmeasured product is quoted as a parcel — and
`lib/shipping/select.ts` only counts a line as letter-eligible when the value is
exactly `true`. The two disagreed **in the expensive direction**: a product row
typed into the Supabase table editor arrived claiming Large Letter eligibility,
$3.40 untracked and uninsured against about $10.20 tracked, and the undercharge
is paid by the studio on every order until someone reconciles a postage bill.
`0004_letter_eligible_default.sql` sets the default to `false` and clears
accidental `true`s once, and `verify.sql` asserts both the declared default and
the behaviour it produces. The copy of `0002` in this repo now also reads
`default false`. **`letter_eligible` is not a measurement, it is a judgement**
— flat enough, robust enough, not something a sorting machine would crush — and
a default is a judgement nobody made.

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

Built in round 11 (§5), deployed, and driven against the live database in round
12. Verified by execution: the SQL (50 assertions, each one tested by breaking
it), the costing chain (against the workbook's own cached values), the
authorisation layering (a real built server, four scenarios — signed out,
customer, packing, owner — over pages *and* server actions POSTed directly,
including replaying an owner's captured server-action request byte-for-byte as a
customer and watching it refused), every screen rendered in a real Chromium, and
then all nine screens opened as the owner against real Supabase.

**Still not verified: the shape of anything that comes back from an embedded
join.** The rig used for the round-11 work answers `/auth/v1/user` and
`/rest/v1/staff` truthfully and returns fixtures for everything else — it does
not parse PostgREST syntax — so nothing in it was evidence that a `select`
string with an embedded join is correct. Against the real project they now run
without error, which proves the syntax parses **and nothing more**, because
every table behind them is empty. The three in `app/admin/data.ts`:

* `product_filament(grams, colours(id, name, hex))` — a two-level embed
* `order_items(id)` used for a count, and the full line embed on `getOrder`
* `order_items(...) → orders!inner(status)` in `getOpenDemand`, which filters a
  child by a parent column

**The cheapest way to close all three at once: record one market sale** on
Orders → *Record a sale*, for a product that has at least one filament colour
and a print time filled in, then open that order, Inventory and Reports and
check the numbers against what was typed in. Cancel it afterwards. Until that
has happened, do not trust a number on Inventory or Reports.

**What the studio has to work with today, read off the live database in round
12:** 44 products (not the 56 an earlier count claimed), every one still at the
seed price of **$9.00**, **0 of 44 with a filament recipe**, and print times
effectively all missing — so the studio says "Not measured" everywhere, which is
correct and useless. `/admin/inventory/measure` (§5 round 13) is the screen for
entering the two inputs that light the rest of it up. Do **not** copy prices out
of the workbook's Suggested price column: Settings C19 holds the text `1.6%`, so
that column is `#VALUE!` on every row.

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

Enabling Large Letter is a per-row tick in the Supabase table editor, with no
deploy. The half that used to have to ship with it is already done:
`transitLabel(methodId, tracked)` takes tracking as a **required argument** since
round 10 and no longer hardcodes "· tracked", and the cart passes
`quoteBasket()`'s own `tracked` boolean. **Never pass that argument a literal** —
that is the hardcode again, just moved. Since `0004`, the schema default is
`false` too, so nothing becomes letter-eligible by accident while the decision
is open.

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
| **The newsletter keeps addresses but sends nothing** | `0006_enquiries.sql` added `newsletter_signups`, so an address is now recorded rather than only forwarded — but there is still no audience, no welcome email and no unsubscribe link, and `unsubscribed_at` is set by hand. It is **not a subscription**, and the footer copy must never promise a newsletter, a welcome email or an unsubscribe link until one exists. The same migration added `contact_enquiries`; **no screen reads either table**, so `/admin/enquiries` is owed before storage is worth anything to her |
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
- ~~Nothing writes `orders.tracking_number`, and there is no admin surface.~~
  **Closed by the staff area** (§5 round 11). `setOrderStatus` in
  `app/admin/actions.ts` writes both the status and the tracking number from
  `/admin/orders/[id]`, so the `confirmed → printing → packed → shipped`
  progression `/track` shows customers now advances from a screen rather than
  from a hand edit in the Supabase table editor. What is still manual: a
  `cancelled` order that is paid anyway is logged and **refunded by hand**.
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
- ~~`@stripe/stripe-js` is a dependency no file imports.~~ **Removed from
  `package.json` in round 13.** Checkout is redirect-based — the server creates
  a Checkout Session and the browser goes to Stripe's hosted page — so no
  publishable key and no client library are needed. `npm run build` has **not**
  been re-run from here since the removal, and that is the check that shows
  nothing pulled it in transitively. (`public/vercel.svg` is a leftover of the
  same kind, unreferenced by any component, and is still there.)
- ~~`getStripe()`'s error message still names Vercel.~~ **Fixed in the code.**
  `lib/stripe.ts` now says to add it to `.env.local` locally and to set it with
  `fly secrets set` on the server, naming it a runtime secret and never a build
  arg. Recorded here only because `CLAUDE.md` carried this as a known-stale
  string for a while and someone may remember it that way.

### Settled — the Supabase JWT secret has been rotated

**Closed. Do not raise it again.** An anon key and a `service_role` key were
exposed in chat during round 10, and the `service_role` key bypasses row-level
security entirely — it can read every order, every address and every profile in
the project. The owner rotated the JWT secret and updated the keys, confirmed
**26 August 2026**; rotating that secret invalidates every key signed with the
old one, which is what closes a leak of this kind.

The Stripe live key that was exposed in the same way **has been rolled** — also
owner-confirmed. Test keys are in use everywhere today.

Recorded rather than deleted because the procedure is the part worth keeping: the
new keys have to land in three places in one sitting — `.env.local`, the
`NEXT_PUBLIC_SUPABASE_ANON_KEY` **GitHub Actions Secret** (a build arg, so a
**redeploy**, not a restart), and `SUPABASE_SERVICE_ROLE_KEY` via `fly secrets
set` (restart only). Rotating without updating all three takes the shop down.

### The owner's own setup, as at 26 August 2026

Recorded because a new session will otherwise assume more exists than does.
None of it has been verified from here — it is what the owner reports.

| Thing | State |
|---|---|
| Domain | **`bamstudioshop.com` registered at Porkbun.** DNS still on Porkbun's parking wildcard (`*` CNAME → `uixie.porkbun.com`), **which must be deleted** — it shadows email records |
| GitHub | `https://github.com/nellyy2505/bamstudio-shop`, **public**, branch `master`, pushed |
| Supabase | **Applied and live.** `0001_init.sql`, `0002_shipping.sql`, `0003_admin.sql`, `seed.sql`, `storage.sql` and the claim statement have all been run; `verify.sql` returned **50 rows, all `t`** on 26 August, which was the whole file at the time. **Four migrations have not been run there yet** — `0004_letter_eligible_default.sql` (round 13), `0005_sale_integrity.sql` (round 15, the money one), `0006_enquiries.sql` (round 16) and `0007_lucky_scoop.sql` (round 17). **She no longer applies them by hand**: `scripts/migrate.sh` runs on every deploy through the `migrate` job, applies whatever is missing oldest-first, and stops the rollout if `verify.sql` goes red afterwards. `verify.sql` is **126** rows once all four are in |
| Fly | **Created and deployed.** Live at `bamstudio-shop.fly.dev` |
| Stripe | **Test** keys in use. The live key exposed in chat has been rolled. The **production** webhook secret has not been confirmed against Fly |
| Supabase keys | **JWT secret rotated, 26 August** — settled, see above |
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
- **Parts of the Fly deployment.** The deploy itself is no longer hypothetical
  — the shop is live at `bamstudio-shop.fly.dev` and was driven in a browser in
  round 12. What has still never been observed from here: a rolling release, the
  health check firing over time, and **`Fly-Client-IP` actually arriving on a
  request**. Fly's own docs recommend that header without promising the proxy
  overwrites a client-supplied one — if that promise turns out to be false, the
  limiter is back to a speed bump and the fix is a real store, not a different
  header.

### Only the owner can do these

**`git push origin master`** — the three round-12 commits are local only, and
nothing in them is live until she pushes · **weigh three items and give the real
numbers** (the backlog item above — one name charm, one clicker keychain, one pet
bowl, in the mailer actually used: grams and thickness in mm) · **fill in the
catalogue**: real prices for 44 products still sitting at the seed's $9.00, and
a print time and filament grams for each, on `/admin/inventory/measure` ·
**decide Large Letter vs tracked parcel** (the pending decision above) ·
**delete Porkbun's `*` parking CNAME** · `AUSPOST_API_KEY` from
developers.auspost.com.au (free, self-serve, instant — a **Fly secret**, never a
build arg; without it postage falls back to the pessimistic table and still
works) · **get `0004`, `0005`, `0006` and `0007` onto the Supabase project** —
one **Actions → Run migrations** run with `0001 0002 0003` in the "already run
by hand" box, and every push after that applies whatever is missing by itself;
`verify.sql` then prints **126** rows all `t` · **confirm the
production `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` and
`NEXT_PUBLIC_SUPPORT_EMAIL` on Fly and place one test order** ·
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

That block is the original nine, and it is now several rounds behind. On the
owner's machine and at `github.com/nellyy2505/bamstudio-shop`, on `master`:

```
10a683f  Print the studio's page title once            ← round 12, NOT PUSHED
7c049aa  Give an invitation somewhere to be accepted   ← round 12, NOT PUSHED
1a4e0d0  Stop the studio printing numbers it has not measured
                                                       ← round 12, NOT PUSHED
6cfdafb  A way into the studio that is not typing the URL   (pushed, deployed)
9098449  The staff area                                     (pushed, deployed)
36a33d5  Round 9's postage engine
d3f2946 … 8131290  Round 10, ten commits
896c08d  The round-8 hosting migration
```

**The three round-12 commits are made locally and not pushed** — the device
shell has no network and cannot reach the Windows credential store, so only the
owner can push them. Everything at or below `6cfdafb` is live.

Round 11 added `app/admin/` (nine screens), `app/admin/actions.ts`,
`lib/auth/staff.ts`, `lib/costing.ts`, `scripts/check-costing.mjs`,
`supabase/migrations/0003_admin.sql` and `supabase/storage.sql`, and took
`verify.sql` from 29 assertions to 50. Round 12 added
`app/(admin-join)/admin/join/` and changed `proxy.ts`, `app/admin/data.ts`,
`app/admin/actions.ts` and `app/admin/layout.tsx`. Rounds 13–15 — in the working
tree, and this document cannot see which of them are committed — changed
`scripts/verify-sql.sh`, `supabase/verify.sql` (now **126**), `package.json`,
`app/signup/**`, `app/login/page.tsx` and `app/auth/callback/route.ts`, and
added `supabase/migrations/0004_letter_eligible_default.sql` and
`app/admin/inventory/measure/` (round 13); reworked
`app/admin/inventory/measure/` into a page plus `ExtraColours.tsx` and added
`metadata.title` to the admin pages (round 14); and, in round 15, added
`supabase/migrations/0005_sale_integrity.sql` and changed `next.config.ts`,
`app/order/confirmed/page.tsx`, `app/api/checkout/route.ts`,
`app/api/webhooks/stripe/route.ts`, `app/admin/data.ts`, `app/admin/actions.ts`,
`components/cart/limits.ts` (new), `components/cart/CartProvider.tsx`,
`app/cart/CartView.tsx`, `app/product/[slug]/ProductBuy.tsx`,
`components/ui/index.tsx`, `components/layout/SearchBar.tsx`, `lib/queries.ts`,
`app/shop/SortSelect.tsx`, `app/track/TrackForm.tsx` and
`app/builder/BuilderClient.tsx`.

**Round 17 — Lucky Scoop — added** `supabase/migrations/0007_lucky_scoop.sql`,
`lib/scoop.ts`, `lib/scoop-line.ts`, `scripts/check-scoop.mjs`,
`scripts/check-webhook.mjs` with `scripts/webhook-harness/` (five fakes),
`app/scoop/page.tsx` and `app/scoop/[slug]/page.tsx`, `app/admin/scoops/`
(list, `new`, `[id]`, `ScoopTierForm.tsx`) and
`app/admin/orders/[id]/ScoopPackPanel.tsx`; and **changed** `supabase/verify.sql`
(86 → 126), `lib/queries.ts`, `lib/types.ts`, `app/admin/data.ts`,
`app/admin/actions.ts`, `app/admin/layout.tsx`, `app/admin/orders/[id]/page.tsx`,
`components/cart/CartProvider.tsx`, `app/cart/CartView.tsx`,
`app/api/checkout/route.ts`, `app/api/shipping/quote/route.ts`,
`app/api/webhooks/stripe/route.ts`, `app/page.tsx`, `app/sitemap.ts`,
`app/faq/page.tsx` and `app/legal/refunds/page.tsx`. **That file list was read
off the tree while other work was in flight; treat it as a map, not an
inventory.**

**Where those changes live is not the same answer everywhere, so check rather
than assume.** These docs have been written in more than one clone, and a commit
that exists in one has repeatedly not existed in another. **`git status` and
`git diff --stat` are the only trustworthy answer to "what is committed", and
this paragraph is the first thing in the file to go stale.**

Verified **by execution**, at the time each was run: `./scripts/verify-sql.sh`
**24/24**, then **29/29** (round 10), then **50/50** (round 11) against a real
PostgreSQL 16 from an empty database — including the anon-privilege denial on a
fresh database *and* on a simulated already-deployed one, and with each of the
50 confirmed to fail when the thing it asserts was broken; `verify.sql` re-run
against the **live** Supabase project on 26 August, 50 rows all `t`;
`node scripts/replay-checkout.mjs` **7/7** with the negative control; the
webhook behavioural harness **43/43**; an 80-page browser crawl across four
configuration states with zero failed assertions; the `safeNext`
re-verification, 41 payloads plus ~192,000 fuzz cases; `npx tsc --noEmit`,
`npm run lint` and `npm run build` all clean on the round-12 tree, with
`/admin/join` in the route table; and all nine studio screens opened in a real
browser against the live database. **The round-7 webhook harness lived in
`/tmp/webhook-harness/` and did not survive its session; round 17 rebuilt it
into the repo** as `scripts/check-webhook.mjs` — §4 says what the rebuild covers
and what it does not.

**Round 17 re-verified the tree, and this paragraph no longer says what it used
to.** `./scripts/verify-sql.sh` printed **126/126** against a real local
PostgreSQL 16 from an empty database; `node scripts/check-scoop.mjs` **34**;
`node scripts/check-webhook.mjs` **91 across 12 scenarios**, with five
deliberate mutations of the routes each proved to fail it;
`node scripts/check-costing.mjs`; and `npx tsc --noEmit`, `npm run lint` and
`npm run build` all clean. **The old sentence here — "neither 52/52 nor 86/86
has been observed anywhere" — is dead, and so is the instruction to distrust
every count above 50.** 52, 65 and 86 were each superseded before anyone ran
them; 126 is the first count after 50 that has printed. What is still owed is a
run against the **live** project, which is a different claim and is §0 item J.

**What rounds 13 through 16 never had, and round 17 does not retroactively give
them, is a browser.** No page has been opened under the CSP, and nothing in
Lucky Scoop — `/scoop`, a tier page, the studio's scoop screens or the pack
panel — has been rendered. Three things still make the build the first thing to
run rather than a formality: a dependency was removed from
`package.json` in round 13; `next.config.ts` gained a `headers()` function and a
`contentSecurityPolicy()` in round 15, and the build is what proves that config
still loads; and **the CSP is enforced, not report-only**, so a directive one
origin too narrow is a broken page rather than a console warning. **No browser
has ever loaded a page under that policy.** Load the shop, the cart, a product
with a photograph (Supabase storage origin, `img-src`) and `/admin`, and read the
console.

Round 9's own verification was **against the live Australia Post API** — the
quotes, the response shapes, the 200-vs-404 error behaviour, the postcode
invariance across eight destinations and the absence of cubic weighting were all
observed. `lib/shipping/` has since been exercised through the app — round 10
wired it into checkout, the cart and `POST /api/shipping/quote` — but no basket
has ever been priced by it in front of a paying customer.

Verified **by reasoning only**, and worth repeating because the distinction is
the most useful thing in this file: real Resend delivery, the Stripe
`product_data.metadata.slug` round trip, `after()` completing on the deployed
machine, grants on a hosted Supabase project applied outside the migration, and
the CSP against a real browser. **The shape of an embedded PostgREST join is no
longer on this list**: those three selects had parsed and returned `[]`, which
is a fact about the tables being empty and not about the queries, and round 14
put real rows behind all three and checked the costing chain by hand against the
live numbers. **The rule outlives the instance** — the next new embedded join
starts in exactly the same position, and an empty table will look identical to a
wrong foreign-key path from the calling code. What round 8 measured, against a real local build: the ~1.6 GB
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
- **The shop is deployed and the schema is applied**, but it has still never
  taken an order: the studio's own numbers come from empty tables, and no card
  has ever been charged through it. `bamstudioshop.com` **is** registered
  (Porkbun) and the shop still answers at `bamstudio-shop.fly.dev`; DNS still
  carries the parking wildcard that shadows email records, and the `.com.au`
  needs an *issued* ABN. Changing to the real domain later is a rebuild, not a
  setting (§5 round 8, §6, `SETUP.md` Step 5f).
- **The catalogue is empty of the numbers the studio runs on.** 44 products at
  the seed's $9.00, none with a filament recipe, print times effectively all
  missing. Every cost, margin, suggested price and the filament buy list say
  "Not measured", which is correct and useless (§6).
- The `"unknown"` email sentinel escapes the webhook into three readers that do
  not know about it (§6).
- **Lucky Scoop is built and the shop does not sell one.** `0007` is not applied
  to the live project, no tier exists, and a tier cannot be switched on without
  a price and a packed weight — both of which only the owner can supply, by
  pricing a bowl and putting a test pack on the scales. Every scoop surface is
  conditional on a sellable tier, so until then the shopfront correctly shows
  nothing. **"The feature is built" and "the shop sells scoops" are two
  different statements** (§0 items J and O), and three of its terms are still
  the owner's to decide (§0 item P).
- The legal pages have never been read by a lawyer, and the
  contract-formation clause in `app/legal/terms/page.tsx` was **rewritten**
  during this pass — it now keys on payment succeeding and the order number
  being allocated, because the old wording keyed on a confirmation email that
  no code ever sent, which meant no contract ever formed. It is the most
  load-bearing sentence on the site and it needs a professional eye.

Start at §0 and its open list, then §5 round 7 — the design rule it ends on is
the one thing in this file that will stop the same defect being written a third
time — then §5 rounds 11, 12 and 14, whose four traps are the ones this project
keeps walking into: a harness that passes for the wrong reason; static checks
that pass on a build that cannot compile; an empty table, which is a question
about the database and not about the query, and looks identical to a broken one;
and a screen that states as fact something that was only unmeasured. §5 round 15
adds the fifth, and it is the one the shop's customers would have felt: **a
plausible zero is a false statement someone eventually decides on.** "0 reviews"
under every product, a "Highest rated" sort over an all-zero column, a tracking
number promised for a parcel knowingly posted untracked — each was true-shaped,
each printed a fact the shop did not have, and six of them shipped. **§5 round
17 adds the sixth, and it is a rule about rules**: this shop now has two
opposite stock rules that are both correct, and which one applies depends on
whether the thing being sold can be made again. Overselling is right for a
printed charm and wrong for a scoop; a missing decrement is a defect on a charm
and the design on a scoop. **An agent that knows only the general rule will
"fix" the specific one** — so before changing anything that touches stock, cost
or availability, check which of the two you are holding. §6's admin section is
where the actual work is.
