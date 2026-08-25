# Work log — Bam Studio shop

Everything a new session needs to pick this up: what was built, what was found
wrong and fixed, what is deliberately still open, and how to verify any of it.

Last updated: 25 August 2026. Branch: `master`, tree clean at `314ba58`.

---

## 1. What this is

The online shop for Bam Studio, a pre-revenue Australian sole trader selling
3D-printed fidget clickers, charms and a build-your-own name charm. Catalogue
and costing live in `../Documents/3D_Planner.xlsx`.

**Stack:** Next.js 16 (App Router, React 19, TypeScript), Tailwind v4,
Supabase (Postgres + Auth incl. Google), Stripe Checkout, deployed to Vercel.
All money is integer cents (AUD).

**Design source:** the approved UI canvas at
<https://claude.ai/code/artifact/0d026b4a-db61-4a2a-b054-4ea8588ff261>
(working files in `../shop-design/v2/`). Style: Etsy-like, Poppins + Nunito
Sans, illustrated product art standing in for photos.

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

## 4. How to verify — do this, don't trust the diff

Three times in this work a *fix* introduced a regression. Two were caught only
because the real payloads were replayed. The lesson, concretely:

**Test the payload the client actually builds, not one you write by hand.**
Both checkout blockers in round 2 passed hand-written API tests and were still
completely broken, because `CartView` sent a different shape.

```bash
# 1. Static checks
npx tsc --noEmit && npx eslint . && npm run build

# 2. Run it with a dummy Stripe key so validation runs but no charge can occur
printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev

# 3. Replay real client payloads against /api/checkout.
#    HTTP 502 = validation PASSED and it reached Stripe (success).
#    HTTP 400/409 = validation rejected it.
#    Copy the exact JSON shape from CartView.checkout().
```

Always check all four personalised products plus an ordinary one plus a mixed
basket — a validation failure on one line rejects the **whole basket**.

**The SQL is testable too.** `supabase/verify.sql` asserts the guarantees that
otherwise only fail in production. Run it in the Supabase SQL editor after
setup; every row must print `t`. To exercise it locally:

```bash
docker run -d --rm --name pg -e POSTGRES_PASSWORD=test postgres:16-alpine
# create schema auth, auth.users, auth.uid(), and the service_role/anon/
# authenticated roles first, then pipe schema.sql, seed.sql, verify.sql via
# docker exec -i pg psql -U postgres
```

That is how the `service_role` grant was confirmed — the one where, if it is
missing, customers pay and **no order is ever recorded**.

---

## 5. Review history

Four review rounds. Each was an independent full-codebase pass, then fixes,
then re-verification.

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

## 6. Open items

### Deliberately not done — decide before launch

| Item | Detail |
|---|---|
| **Contact form and newsletter only log** | `app/api/contact/route.ts`, `app/api/newsletter/route.ts`. Enquiries reach nobody. Needs Resend (free tier 3,000/month). TODOs are in place |
| **Saved addresses don't prefill checkout** | Stripe collects the address fresh. The copy is honest about this. Real prefill needs a Stripe Customer with `shipping`, passed as `customer` on the session. TODO in `app/account/addresses/page.tsx` |
| **Account deletion is a support request** | The button asks the customer to email. Real deletion needs a server-side admin route. TODO in `DeleteAccountCard.tsx` |
| **No review UI** | The insert policy was withdrawn. The migration records the shape of a correct one (requires a delivered order, forces `verified`) for when reviews ship |
| **Promotion codes disabled** | `allow_promotion_codes: false`. Orders have no discount column, so a promo would leave subtotal/shipping/total inconsistent |

### Known limitations

- **Sign-up enumeration is closed only while email confirmation is ON** in
  Supabase (it is by default). With it off, a new sign-up gets a session and
  redirects while an existing address lands on the confirm screen — still
  distinguishable. Don't switch confirmation off without revisiting this.
- **Rate limiting is in-memory, per instance** (`lib/rate-limit.ts`). A speed
  bump, not a guarantee — several serverless instances multiply the allowance.
  Move to Vercel KV or Upstash if the shop gets attention. The call sites
  don't change.
- **`order_items.colour` is polymorphic**: a product colour for ordinary
  lines, a colourway name for builder lines. Nothing breaks (`reorderLines`
  skips personalised products) but it is worth knowing.
- **`/search?q=` truncates a long query to 64 chars in SQL while
  `/api/search/suggest` rejects it with 400.** Same paste, two behaviours.
  Cosmetic.
- **Basket lines saved by an older build** carry a key without the
  personalisation segment, so an identical new line won't merge with them.
  Self-healing; affects nobody but a developer mid-iteration.

### Only the owner can do these

ABN (Stripe needs it to release money) · business bank account · real prices
("My price" is empty in the workbook, so the shop shows placeholders from
`PRICE_BY_CATEGORY`) · product photography · legal review of the three
`/legal/*` drafts · Sydney market dates · deciding whether to enable PayPal /
Apple Pay / Afterpay in Stripe and adding them to `PAYMENT_BADGES`.

## 7. State at last commit

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

`npx tsc --noEmit`, `npx eslint .` and `npm run build` all clean. 31 routes.
Schema, seed and `verify.sql` all exercised against PostgreSQL 16.

**A fourth verification pass was still running when this log was written.**
Check its findings before treating the list above as closed — the last two
rounds each surfaced something real, and one of them was a launch blocker.
