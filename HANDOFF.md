# Handoff prompt — Bam Studio shop

Paste everything below the line into a fresh Claude Cowork session with a
high-capability model. It is written to be **self-contained**: a session that
reads only this file can start work safely, and everything it defers to is
named by file and section.

---

You are the **orchestrator** for pre-launch work on the Bam Studio online shop
at `bamstudio-shop/`. It is a real Australian sole trader's shop, it takes real
card payments, and a real customer will use it. Treat every change as
production work.

**The shop is deployed and has never taken an order.** Live at
`bamstudio-shop.fly.dev`; the Supabase schema is applied; there is a staff area
at `/admin` that the owner has used. Ten launch blockers were found and closed
across seven review rounds; hosting moved from Vercel to Fly.io (round 8);
postage was built against the live Australia Post API (round 9) and **wired into
checkout, the cart and `POST /api/shipping/quote`** (round 10); the staff area
was built (round 11) and then driven against the live database, which found
three defects and one hole (round 12); round 13 replaced the migration list in
the SQL harness with a glob, added `0004_letter_eligible_default.sql`, took
`verify.sql` to 52 assertions, removed `@stripe/stripe-js`, carried `next=`
through sign-up, and added `/admin/inventory/measure`; round 14 recorded the
first real sale in the studio — which finally exercised the three embedded joins
with rows in them — cut the measure screen's markup, and gave seven admin pages
their own `metadata.title`; and **round 15** was the security and truthfulness
sweep: response headers and a CSP in `next.config.ts`, a throttle on
`/order/confirmed`, **six untrue customer-facing statements removed**, and
`0005_sale_integrity.sql` for the money-integrity defects; and **round 16**,
which made a customer's contact-form message a **row before it is an email**
(`0006_enquiries.sql` — `contact_enquiries` and `newsletter_signups`), taking
`verify.sql` to **86** assertions. `WORKLOG.md` is the source of truth for all
of it — start at **§0**, which opens with the current open list.

**Settled, so do not re-raise:** the **Supabase JWT secret has been rotated**
(owner-confirmed, 26 August 2026) and the round-10 key leak is closed; the deploy
and the SQL steps (`0003_admin.sql`, `storage.sql`, the claim statement that
makes the owner `owner` in `public.staff`) are done and `verify.sql` **has been
run against production** — 50 rows all `t` on 26 August, which was the whole file
at the time. The three embedded-resource joins in `app/admin/data.ts` were
verified with real rows in round 14, and the costing chain was checked by hand
against live numbers, so "those queries have only ever returned `[]`" is no
longer true. The CSP's `script-src 'unsafe-inline'` and HSTS's missing `preload`
are recorded decisions, not oversights — see `next.config.ts` and `CLAUDE.md`.

## How I want you to work

Your own context is the scarce resource. Spend it on judgement, not on reading.

- **Delegate all reading and implementation to subagents.** You should rarely
  open a large file yourself. Dispatch a subagent to investigate, and require it
  to report back compactly: findings, `file:line` references, and the diff it
  made — never a file dump.
- **Run independent work in parallel.** Send several dispatches in one message
  when the tasks touch disjoint files and share no state — and check that they
  really are disjoint first. Two agents in one file clobber each other, and it
  has happened here.
- **Plan before dispatching.** Write the plan out, name the files each
  workstream will touch, and confirm nothing overlaps.
- **Keep the chat for orchestration only**: planning, reconciling reports,
  verification decisions, reporting to me. If you are reading source to answer a
  question, that was a subagent's job.
- **Verify centrally, and never trust a subagent's "done".** Subagents
  implement; *you* decide whether it worked, by running the harnesses below. A
  subagent reporting green while the feature is broken is the exact failure mode
  this project has already hit three times.
- **Report at each checkpoint**: what changed, what you *ran*, what you only
  *reasoned about*, and what you could not verify. Those are three different
  things and this project has been burned by treating them as one. Ask before
  anything irreversible.

## Read these first, in this order

1. `CLAUDE.md` — architecture, commands, hard business rules, the verification
   protocol, and the environment traps. It imports `AGENTS.md`.
2. `AGENTS.md` — **this is Next.js 16 and it has real breaking changes against
   your training data**: `middleware` is renamed `proxy` (see `proxy.ts`), and
   `params`/`searchParams` are Promises that must be awaited. Read the matching
   guide under `node_modules/next/dist/docs/` before writing code.
3. `WORKLOG.md` — **§0** (blocker status plus the current open list), **§4**
   (how to verify), **§5 round 7** (where a fix reproduced the defect class it
   was closing — the design rule at the end of it is the most valuable paragraph
   in the repo), **§5 rounds 11 and 12** (the staff area, and what looking at the
   deployed studio found), **§6** (open items, the backlog and the pending owner
   decision).
4. `README.md` for architecture, `SETUP.md` for what the owner must supply.

Have a subagent produce a condensed brief of §0, §4, §5 rounds 11–13 and §6
rather than reading all of `WORKLOG.md` into your own context.

## Traps in this environment — read before your first command

Every one of these has already cost someone time.

- **The device bridge VM has no network access.** `git push`, `fly`, `curl` to
  the internet and anything else needing egress **must be run by the owner**.
  Never report a push or a deploy as done because a command exited.
- **`git` on the mounted Windows folder cannot delete its own lock files.**
  Clear them by moving them aside — `mv .git/index.lock /tmp/`, and the same for
  any other `.git/**/*.lock` — not with `rm`.
- **Nine files show as permanently modified and it is pure CRLF line-ending
  noise** (`git diff --ignore-all-space` is empty). **Never `git add -A`.** Stage
  by name, or the diff becomes unreviewable and the real change is invisible
  inside it.
- **A Next build cannot complete on the device shell.** Each call is a fresh
  ~45s shell and anything left running is killed between calls — `nohup`,
  `setsid` and `disown` all die. What works, and what round 12 did: `tar` the
  source (excluding `node_modules`, `.next`, `.git`, `.env*`), stage that one
  file, then `npm ci` and `npm run build` in a cloud container with dummy
  `NEXT_PUBLIC_*` values. **Never stage `.env.local`.**
- **Turbopack constant-folds `process.env.NODE_ENV === "production"`
  comparisons in a production build** — measured in this repo, where it silently
  made a guard unconditional. Write environment guards as **`!== "development"`**.
  `siteUrl()` in `lib/stripe.ts` carries the note at the line. The exception is
  `app/api/checkout/route.ts:275`, which is scoped `=== "production"`
  deliberately: there the fold lands on the value the guard wants in each mode
  (on in production, off in development, which the replay harness needs). Leave
  that line alone.
- **`NEXT_PUBLIC_SITE_URL` is constant-folded into the server bundle.** Booting
  the built server with a different value still emits the built one; booting it
  with the variable removed does not throw. **Changing the shop's domain is a
  rebuild, not a secret and a restart.**
- **`scripts/generate-seed.mjs` text-parses `BUILDER_PRICING` out of
  `lib/config.ts` with a brace-naive regex**, and now also carries a
  hand-transcribed copy of the shipping category defaults from
  `lib/shipping/dimensions.ts`. Nothing enforces that either stays in step.
- **The workbook `../Documents/3D_Planner.xlsx` is not in the sandbox**, so the
  seed **cannot** be regenerated here. `lib/fallback-data.ts` and
  `supabase/seed.sql` were **patched in place** in round 9, and a real
  regenerate from the workbook is owed.

## Check the ground truth before you start

Run `git status` and `git diff --stat` and reconcile them against what the docs
claim, rather than assuming any document is current.

**Expect the clones to disagree.** These docs have been written in more than one
checkout, and a commit that exists in one has repeatedly not existed in another.
**`git status` is the only trustworthy answer to "what is committed."** What the
owner's machine reports: `896c08d` (hosting), `36a33d5` (the postage engine),
`d3f2946`…`8131290` (round 10), `9098449` and `6cfdafb` (the staff area, pushed
and deployed), and then three round-12 commits that are **committed locally and
not pushed** — `1a4e0d0` *Stop the studio printing numbers it has not measured*,
`7c049aa` *Give an invitation somewhere to be accepted*, `10a683f` *Print the
studio's page title once*. **Only the owner can push**: the device shell has no
network and cannot reach the Windows credential store.

**That list is a snapshot from round 12 and rounds 13, 14 and 15 have landed
since**, so treat it as history rather than as the current tip. Run `git log
origin/master..master --oneline` yourself; this paragraph is the first thing in
the file to go stale, and it has.

Two habits this project earned the hard way:

- **Don't trust a commit message as a complete description of its contents.**
  Earlier in this repo a commit messaged as a docs tweak also carried an
  unrelated security fix that happened to be in flight. Check the stat.
- **If a second session is active, agree file ownership with me before
  dispatching.**

## Where the work stands

### Done, and verified by running it

- **The ten §0 blockers are closed** (two for the *claims* they made only).
  `WORKLOG.md` §0 is the status table and separates what was verified by
  execution from what was verified by reading.
- **Email exists** (`lib/email.ts`, Resend over `fetch`, no npm client, never
  throws, never logs PII). **`isEmailConfigured()` is the single source of truth**
  for "the shop can send email" — the same `RESEND_API_KEY && EMAIL_FROM` check
  the sender itself makes.
- **A guest sees their order number without any email**, via a `SECURITY DEFINER`
  function keyed on the Stripe session id. That, not email, is the fix for
  untrackable orders.
- **`lookup_order` is `service_role` only**, with an explicit `revoke` so the
  migration closes the hole on already-deployed databases.
- **The hosting move to Fly.io is complete, and deployed** — `Dockerfile`,
  `fly.toml`, `.dockerignore`, `.github/workflows/deploy.yml`, the new
  dependency-free `/api/health`, and fixes to three defects that only existed
  off Vercel: `siteUrl()` silently returning localhost (a customer would have
  been charged and then redirected to their own machine), `clientKey()` reading
  the **first** `x-forwarded-for` value (forgeable on Fly, whose proxy *appends*),
  and health checks that would have run through `proxy.ts` into Supabase auth
  every few seconds. The shop answers at `bamstudio-shop.fly.dev`. Still never
  observed from here: a rolling release, and `Fly-Client-IP` actually arriving on
  a request.
- **The schema is applied on the live project and `verify.sql` returned 50 rows
  all `t`** on 26 August, after `0003_admin.sql`, `storage.sql` and the claim
  statement. **Three migrations are not yet run there** —
  `0004_letter_eligible_default.sql`, `0005_sale_integrity.sql` and
  `0006_enquiries.sql` — and `verify.sql` is now **86 assertions**, counted off
  the file this round (22 `insert into _checks` statements, 64 `union all`
  branches, 86 rows in the final select, which agrees with the file's own
  header). 24 → 29 → 50 → 52 → 65 → 86. **86/86 has never been observed from any
  session**; every count after 50 is read, not run.
- **The staff area is live and has been used.** All nine screens opened as the
  owner against real Supabase in round 12; everything renders, nothing 500s.
  What that did *not* prove is anything about the three embedded-resource
  selects in `app/admin/data.ts`: every table behind them is empty, so they had
  only ever returned `[]`. **A query that runs is not a query that is right** —
  an empty table is a question about the database, not about the query, and the
  two look identical from here. **Round 14 closed that**: a real sale was
  recorded against a measured product, all three selects returned real rows, and
  the costing chain was checked by hand against the live numbers. Keep the rule;
  the instance is settled.

### Postage — built, verified against the live carrier API, and wired

`lib/shipping/` quotes real Australia Post postage, and `quoteBasket()` prices
every basket in checkout, in the cart and in `POST /api/shipping/quote`.
`shippingCost()` was **deleted**, not deprecated. `isFreeShipping(subtotal,
methodId)` decides who pays; `quoteBasket()` decides how much; never merge them.

What is known, so nobody researches it twice:

- **Domestic parcel price does not vary by destination postcode** (verified
  across eight). Postcodes affect service *availability* only, so **quoting
  needs no customer address** — which removes the "Stripe collects the address
  after the price is fixed" problem entirely.
- **No cubic weighting.** Dimensions decide validity and Large Letter
  eligibility; weight decides price.
- **Large Letter** ≤125 g / ≤260 × 360 mm / ≤20 mm is **$3.40** but **untracked
  and uninsured**; a parcel is about **$10.20**. Live quotes: 1 charm $3.40, 4
  charms $3.40, 12 charms $11.70, 1 pet bowl $10.20.
- **`transitLabel(methodId, tracked)` takes tracking as a required argument.**
  It used to hardcode "· tracked", which was true only while everything shipped
  as a parcel — and `letter_eligible` is a checkbox in the Supabase table editor,
  so one tick with no deploy would have armed the lie. Pass `quoteBasket()`'s own
  `tracked`; **never a literal**. A page with no basket to ask uses
  `transitRangeLabel()` and makes no tracking claim.
- Prices are **GST-inclusive retail**; the shop is not GST-registered, so the
  total passes through and **no GST component may ever be shown**.
- **Label printing and tracking APIs are not available to this business.** The
  Shipping & Tracking API needs an eParcel or StarTrack contract (2,000+ parcels
  a year, a credit account wanting $1,000+ a month, an issued ABN). MyPost
  Business is free and needs no ABN but is **portal-only — no API**. At this
  scale labels are printed by hand in the portal; the automation path when
  volume arrives is a third-party platform (Starshipit, Shippit), not Australia
  Post's own API. **Do not re-research this.**
- Every physical constant in `lib/shipping/dimensions.ts` is an **estimate**,
  rounded toward the shop paying. Three real weighings are on the owner's list.

### The staff area — and the one rule an agent breaks from memory

`/admin` is nine screens, built in round 11 and used by the owner against the
live database. Read `CLAUDE.md`'s *The staff area* before touching it. The rule:
**`requireStaff(capability)` is the first statement of every page, route handler
and server action under `/admin`.** It cannot be hoisted into `proxy.ts` (anon
client only, so it cannot read `public.staff`) or into a layout (not a security
boundary for a route handler, and a server action is a public endpoint with a
generated id).

**There is exactly ONE documented exception: `acceptInvitation` in
`app/admin/actions.ts`.** It is the action that makes somebody staff, so
requiring staff would be circular and no invitation could ever be accepted. It
does its own equivalent check in `resolveJoin()` — signed in, a token that hashes
to a live invitation, and **the signed-in email equal to the invited email**.
"Fixing" it by adding `requireStaff()` breaks every invitation. Do not add a
second exception without the same treatment, and do not move
`app/(admin-join)/admin/join/` under `app/admin/` — the route group is what keeps
the page out of the layout that would bounce an invited person.

### Still not built — do not read ticks as "done"

1. **The rate limiter is still one process's memory.** Round 8 fixed *which IP
   it reads*, not durability; round 15 added the missing throttle on
   `/order/confirmed` — coverage, not durability. It is still the only thing in
   front of `/api/track`, which returns a postal address for an order number
   plus the matching email — and order numbers are a sequence plus four hex
   characters. Upstash/Redis; the call sites do not change. It is also, with the
   `after()` email task, why `fly.toml` cannot scale to zero.
2. **Real account deletion.** The claim was fixed, not the capability. Needs a
   server-side admin route, re-authentication, and an in-flight-order guard.
3. **A newsletter that sends anything.** `0006_enquiries.sql` added the
   `newsletter_signups` table, so addresses are now kept — but there is no
   audience, no welcome email and no unsubscribe link, and `unsubscribed_at`
   is set by hand. Likewise `contact_enquiries` stores messages that **no
   screen can read**: `/admin/enquiries` is owed, roughly a page, a detail
   view and one server action.
5. **The `"unknown"` email sentinel escapes the webhook** into `/track`, the
   account order pages and `lib/queries.ts`, which read the column as an address.
6. **`components/contact/Reach.tsx`** — the "can the customer reach us" fallback
   chain is still written out six times in JSX. The predicates were deduplicated
   into `lib/contact.ts`; the markup was not.
7. **The 43-scenario webhook harness is not in the repo.** It scored 7/26 against
   the old code, which is what made it meaningful. Rebuild it **before** the
   builder payload changes, not after.
8. **The builder rework** — per-keycap and per-key-holder colours, no cord,
   optional charm, numbers/star/heart/paw. Not started.
9. **`app/admin/layout.tsx` hardcodes "Bam Studio"** where `app/layout.tsx` uses
   `SHOP.name` from `lib/config.ts`. Same value today, two sources tomorrow.
10. **The basket limits are in three places.** `components/cart/limits.ts` says
   so itself: 20 per line and 40 lines are transcribed there from four literals
   in two Zod schemas (`app/api/checkout/route.ts`,
   `app/api/shipping/quote/route.ts`), and nothing makes the copies agree. They
   belong in `lib/config.ts`, imported by all three. The round that found the
   defect did not own `lib/config.ts`, which is why they are not there yet.
11. **The CSP still carries `script-src 'unsafe-inline'`.** Documented and
   deliberate — dropping it needs a nonce in `proxy.ts` and forces dynamic
   rendering on every page. Read the comment in `next.config.ts` before
   proposing it as a quick win; it is neither quick nor free, and getting it
   wrong breaks checkout.

## What to do first

Roughly this order of value:

1. **Re-verify the tree as it stands, then report the real numbers.**
   `npx tsc --noEmit`, `npm run lint`, **`npm run build`**, then
   `./scripts/verify-sql.sh`, which should apply **six** migrations and print
   **86** assertions. Rounds 13 through 16 have each landed without a single
   harness run from the session that wrote them, and 86/86 has never been
   observed anywhere. A dependency (`@stripe/stripe-js`) was removed from
   `package.json` in round 13 and only the build shows nothing pulled it in
   transitively. `next.config.ts` gained a `headers()` function and a CSP in
   round 15 — the build is also what proves that config still loads. **Say what
   you ran and what it printed, not that it "should" pass.**
2. **Exercise `0005_sale_integrity.sql`'s three new behaviours against real
   rows**, the way round 14 finally exercised the embedded joins. Specifically:
   sell more of a product than `stock_on_hand` holds and confirm
   `decrement_stock` returns the shortfall and `products.oversold_units`
   accumulates it; confirm a second delivery of the same Stripe event does not
   send a second confirmation email (`orders.confirmation_email_sent_at`); and
   confirm a payment landing on a cancelled order writes exactly one
   `payment_incidents` row and appears on `/admin`. Each of these is currently
   believed-correct-by-reading. `verify.sql` asserts them against synthetic rows
   it rolls back, which is a different thing from the webhook doing it.
3. **Exercise `0006_enquiries.sql` the same way.** Post a contact enquiry with
   the mail provider deliberately unconfigured and confirm the row lands anyway
   — that is the entire point of the migration, and it is the case that used to
   lose the message. Then confirm a repeated newsletter sign-up is idempotent,
   that a mixed-case address is stored lower-cased, and that an unsubscribe
   survives a later sign-up.
4. **Verify the CSP against a real browser, on a real page.** The policy was
   derived from a grep of `.next/static/chunks` and is *enforced*, not
   report-only, so a directive that is one origin too narrow is a broken page
   rather than a console warning. Load the shop, the cart, a product with a
   photograph (Supabase storage origin, `img-src`) and `/admin`, and read the
   console. This has not been done.
5. **Move the basket limits into `lib/config.ts`** and import them from
   `components/cart/limits.ts` and both Zod route schemas. Three transcribed
   copies of 20 and 40 is a defect waiting for someone to change one of them.
6. **The rate limiter** — still the only remaining *security* item fully in your
   hands, and still one process's memory.
7. **The `"unknown"` sentinel**, wherever it escapes the webhook.
8. **`components/contact/Reach.tsx`** — mechanical, and it protects the thing
   two whole review rounds were about.
9. **Real account deletion.** Separately: `newsletter_signups` now records who
   asked, which is not the same as a newsletter — there is still no mailout, no
   welcome email and no unsubscribe link, and no copy on the site may claim
   otherwise until there is. Building the list or removing the form are both
   honest; a form that looks like a subscription and isn't, is not.
10. **Make `verify.sql`'s backfill assertions run the migration's own `UPDATE`**
   rather than a hand-copied `WHERE` clause.
11. **Rebuild the webhook harness** before anything touches the builder payload.
   It scored 7/26 against the old code, which is what made it meaningful, and it
   now has three new behaviours to cover.

**Waiting on the owner, and blocking nothing you can do yourself:** `git push
origin master` — check `git log origin/master..master` rather than trusting a
count written here, which has gone stale before; running
`0004_letter_eligible_default.sql`, then `0005_sale_integrity.sql`, then
`0006_enquiries.sql` on the live project (after which `verify.sql` is 86 rows); and the catalogue data — 44
products still at the seed's $9.00, none with a filament recipe.

## Verification protocol — non-negotiable

`tsc`, `eslint`, `build` and every SQL check passed while all ten launch
blockers were live. Green checks measure what is being watched.

1. **Static:** `npx tsc --noEmit && npm run lint && npm run build`. **The build
   is not optional.** `tsc` and `eslint` both passed on a round-11 tree that
   could not compile — one `export const` in a `"use server"` file, where every
   export must be an async function, made Turbopack report the module as having
   no exports and took eleven pages down. Only `next build` sees the
   server-action boundary, and only it proves a route group resolves to the URL
   you expect, which is what `/admin/join` depends on.

   **And open the page.** Round 12's worst defect — a product page printing
   *Suggested $0.50 · Profit $8.73 · Actual margin 97%* on a piece with no print
   time and no filament, under a panel correctly saying there was no cost — was
   invisible to the typecheck, the lint, the build and all 50 SQL assertions.

2. **After anything touching checkout — the replay harness:**

   ```bash
   printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev
   node scripts/replay-checkout.mjs      # second terminal
   ```

   It posts the exact JSON `CartView.checkout()` sends — key order and
   omitted-vs-null included — for seven cases: all four personalised products
   (`custom-name-charm` and `alphabet-bag-charm-on-cord` in builder mode,
   `custom-number-date-chain` and `personalised-bowl-with-pet-s-name` in text
   mode), an ordinary product, a five-line mixed basket, and a negative control.

   **502 = validation passed and it reached Stripe. That is the pass.** 400/409
   = rejected. 503 = misconfigured app. **One bad line rejects the whole
   basket**, which is how two blockers hid, so never drop the mixed basket.

   **Case 7, the negative control, is the only reason a green run means
   anything**: free-text personalisation on an ordinary product, which must come
   back **400**. If it returns 502 the harness is not observing validation and
   every PASS above it is worthless — the script says so. A run where the
   negative control passed is not a run.

   It honours `BASE_URL` and `DELAY_MS` and **aborts on a 429**; the route allows
   10 requests per 60 s, so back-to-back runs will trip it.

3. **SQL:**

   ```bash
   ./scripts/verify-sql.sh
   ```

   Self-bootstrapping: drives a locally installed PostgreSQL 16, `initdb`s a
   disposable cluster outside the repo, applies the Supabase stand-ins
   (`anon`/`authenticated`/`service_role`, Supabase's default table privileges,
   `auth.users`, `auth.uid()`, and `pgcrypto` in an `extensions` schema), then
   **every file in `supabase/migrations/`** in `LC_ALL=C` filename order, the
   seed and `verify.sql`, and exits non-zero if any row is not `t`. It prints
   `applied N migration(s)`; a drop in that number between runs is the signature
   of a migration silently going missing.

   **`verify.sql` is one table of 86 rows and every one must be `t`. Count the
   rows as well as the ticks** — 24 → 29 → 50 → 52 → 65 → 86 as the schema grew, so a
   shorter table is an older copy of the file, which is a green result that never
   looked at part of the schema. A table that is short and a run that *aborts*
   are different failures: an unapplied migration does not shorten the table, it
   raises at the first assertion naming an object that is not there.

   ⚠️ **Two properties of the harness are load-bearing.** It must keep granting
   Supabase's **default privileges** — hosted Supabase grants every new `public`
   table to `anon` as it is created, and without that block every "anon cannot
   read X" assertion passes whether or not the revoke exists. And it must keep
   installing `pgcrypto` into an **`extensions`** schema, not `public` — with it
   in `public` the harness printed 29/29 while `0001_init.sql` could not be
   applied to a real Supabase project at all. **Prove an assertion bites before
   believing it.**

   **The schema is the six files in `supabase/migrations/`, plus
   `supabase/storage.sql` run by hand. There is no `supabase/schema.sql`** — the
   docs used to say there was, and it cost real time. `storage.sql` is
   deliberately outside the harness: vanilla PostgreSQL has no `storage` schema,
   and a guard would turn "not tested" into something that looks tested.

4. **After anything touching the Stripe webhook** — the highest-consequence file
   in the project, and neither script above touches it — there is a behavioural
   harness of **43 scenarios**: the real route module against a fake Supabase and
   a fake Stripe, asserting on the calls made and the status returned. Last run
   43/43. **It lived in `/tmp/webhook-harness/` and does not survive a session.**
   If it is gone, rebuild it rather than assuming the webhook is covered;
   `CLAUDE.md` lists what it covers so a rebuild has a target.

5. **For security fixes, prove the exploit fails *and* the legitimate path still
   works.** Run the actual payload; do not reason about it.

6. **Say which of the two you did.** Never let "verified" in a report mean "I
   read it carefully".

## Hard business rules — not preferences

Breaking one is a real-world problem, not a bug. `WORKLOG.md` §2 has the table.

- **No licensed characters, ever.** `LICENSED_SKUS` in
  `scripts/generate-seed.mjs` filters them.
- **The business is NOT GST-registered** (under the $75k threshold). No page may
  show or claim GST. `SHOP.gstRegistered` gates every GST surface, and Australia
  Post's GST-inclusive postage prices pass through as totals.
- **No invented reviews, ratings or stock.** The ACCC treats fabricated reviews
  as misleading conduct. The seed emits `rating 0`, `review_count 0`,
  `stock_on_hand 0`.
- **"2–4 business days" is printing time, never delivery** (`PRINT_LEAD_TIME`).
- **Personalised items are non-returnable** except when faulty.
- **Prices are always recomputed server-side.** The client says which product and
  how many, never what it costs — and never how heavy it is.
- **Australian English** in all customer-facing copy.
- **No sample data, ever, and no plausible-looking zero.** A shop that has taken
  no orders reports that it has taken no orders; Reports renders an empty state
  rather than a chart of zeros; a piece nobody has measured says "not measured"
  rather than a price worked out from the cost of its packaging. This is an
  explicit instruction from the owner, and three round-12 defects were breaches
  of it. **Nulls stay null** through the costing chain.

Because the shop makes claims to customers, **a change that makes an on-site
statement untrue is as serious as a crash.** Roughly forty places once promised
an email no code sent; the *fix* then shipped its own false statements because
it had two switches for one fact.

## Decisions already taken — don't relitigate them

- **Email has ONE switch.** `isEmailConfigured()` in `lib/email.ts`.
  `SHOP.canSendEmail` and `NEXT_PUBLIC_EMAIL_ENABLED` were removed. **Do not
  reintroduce a public mirror of a server fact** — that mirror is what let the
  terms, the privacy policy and account settings each say the shop sends no
  order emails while the webhook was sending itemised ones.
- **The capability is threaded as a prop, not imported.** `isEmailConfigured()`
  throws in the browser rather than answering `false`; a server component calls
  it, a client component takes a `canSendEmail` prop.
  `app/account/settings/page.tsx` is the one threading site. `isPacConfigured()`
  in `lib/shipping/client.ts` follows the same pattern for `AUSPOST_API_KEY`.
- **`sendsOrderConfirmation` is the secrets alone; `formsReachStudio`
  additionally needs `NEXT_PUBLIC_SUPPORT_EMAIL`.** Anding them into one test is
  the defect that produced the false statements. Both live in `lib/contact.ts`.
- **`quoteBasket()` is the only postage entry point**, it never throws, and it
  never returns zero for a non-empty basket. Everything in `lib/shipping/` rounds
  toward the shop paying — including the fallback table, which deliberately
  returns the band *above* the one a basket falls in.
- **`cancelled` is the only terminal order status**, and a cancelled order paid
  anyway is refunded by hand. The webhook returns 200 and logs at error level.
- **The §0.5 checkout guard is scoped to `NODE_ENV === "production"` and that is
  load-bearing.** The replay harness runs the app with *no database at all*; an
  unconditional guard turns all seven cases into a 503 that never reaches the
  validation under test. Round 4's rule: **a guard may reject a query error,
  never the absence of a database.** It has been broken and re-fixed twice.
- **Recovered data is left null rather than guessed** on the webhook's rebuild
  path. **`short_name` is not unique — the slug is the key.**
- **`fly.toml`'s always-on settings are correctness, not cost.** `after()` sends
  the confirmation email after the response is flushed, and the rate limiter is
  an in-process `Map`. Scaling to zero requires fixing both first.
- **A role is `public.staff`, never a column on `profiles`.** `0001_init.sql`
  grants each account UPDATE on all columns of its own profile row and RLS cannot
  restrict a policy to a subset of columns, so a role there is self-assignable
  with the public key. The table has RLS on, no policy, and explicit revokes.
- **`lib/costing.ts` stays a line-by-line transcription of the workbook.**
  Round 12's guard against pricing an unmeasured piece went into `costProduct()`
  in `app/admin/data.ts`, the studio's own composition layer, so the sheet and
  the shop still agree line for line. `scripts/check-costing.mjs` is what proves
  they do.
- **The Finance sheet stays in the workbook**, by the owner's decision — the loan
  account, tax and the split are a monthly sit-down with judgement in them, not a
  dashboard tile. Recorded so nobody helpfully builds it.

## Where every credential lives — names and locations only

**No value of any of these appears in any file in this repo, and none may be
written into one.** This is the map, not the keys.

| Name | Kind | Where it lives |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build arg (public) | GitHub Actions **Variable**; `.env.local` locally |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build arg (public, but key-shaped) | GitHub Actions **Secret**; `.env.local` locally |
| `NEXT_PUBLIC_SITE_URL` | Build arg | GitHub Actions **Variable**, pinned as a fallback in `fly.toml` |
| `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_ABN`, `NEXT_PUBLIC_GST_REGISTERED`, `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_TIKTOK_URL` | Build args | GitHub Actions **Variables** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Runtime secret** | `fly secrets set`; `.env.local` locally |
| `STRIPE_SECRET_KEY` | **Runtime secret** | `fly secrets set`; `.env.local` locally |
| `STRIPE_WEBHOOK_SECRET` | **Runtime secret** | `fly secrets set`; `stripe listen` gives the local one |
| `RESEND_API_KEY`, `EMAIL_FROM` | **Runtime secrets** | `fly secrets set` — both or neither |
| `AUSPOST_API_KEY` | **Runtime secret** | `fly secrets set`; free and instant from developers.auspost.com.au. Listed in `.env.example`; **not set anywhere yet** |
| `FLY_API_TOKEN` | CI credential | GitHub Actions **Secret** |

Rules that go with the table: **never move a secret into a build arg** (build
args are recorded in image history and readable by anyone who can pull the
image); **never tell the owner to set a `NEXT_PUBLIC_*` value as a Fly secret**
(it does nothing — those are baked in at build time); and `fly secrets list`
prints names only, which is the only listing that should ever appear in a report.

## The owner's outstanding steps — not yours to do

Chase these; do not attempt them.

1. **`git push origin master`** — commits are made locally and not pushed, and
   nothing in them is live until she pushes. The device shell has no network and
   no access to the Windows credential store, so this cannot be done for her.
   **Read `git log origin/master..master --oneline` for the current list**; the
   count written into these docs has gone stale more than once, and rounds 13,
   14 and 15 have landed since it last said "three".
2. **Run `0004_letter_eligible_default.sql`, then `0005_sale_integrity.sql`,
   then `0006_enquiries.sql`**, in that order, in the Supabase SQL editor, then
   re-run `verify.sql`, which should print **86** rows all `t`. The other SQL
   steps are already done. `0005` is the money one: it makes a lost confirmation
   email recoverable on a Stripe redelivery, makes an oversell visible instead of
   silently clamped at zero, and gives her a list of payments that owe a refund
   on `/admin`. `0006` is the one that stops a contact-form message being lost
   when the mail provider is unset or fails.
3. **Fill in the catalogue.** 44 products, all still at the seed price of $9.00,
   **0 of 44 with a filament recipe**, and print times effectively all missing —
   so every cost, margin and suggested price in the studio reads "Not measured".
   `/admin/inventory/measure` is the screen for the print-time-and-grams half.
4. **Weigh three items and give the real numbers** — one name charm, one clicker
   keychain, one pet bowl, each in the mailer actually used: grams, and thickness
   in mm. Every weight and dimension in `lib/shipping/dimensions.ts` and in the
   seed is an estimate. Highest-value input to postage accuracy there is.
5. **Decide: Large Letter or tracked parcel** for small orders — $3.40 untracked
   and uninsured versus about $10.20 tracked. It is now a per-row tick in
   Supabase and nothing else; `transitLabel()` already takes the real answer.
6. **Confirm the production secrets on Fly and place one test order.**
   `STRIPE_WEBHOOK_SECRET` (production, not the local `stripe listen` one),
   `RESEND_API_KEY`, `EMAIL_FROM` and `NEXT_PUBLIC_SUPPORT_EMAIL`. Nothing here
   has ever been through a real Stripe session or put a message in a mailbox.
7. **Delete Porkbun's `*` parking CNAME** on `bamstudioshop.com` (currently
   pointing at `uixie.porkbun.com`) — it shadows email records.
8. **Get `AUSPOST_API_KEY`** (free, self-serve, instant) and set it as a Fly
   secret. Without it postage falls back to a pessimistic table and still works.
9. **Set up email**: Resend free tier for sending, Porkbun forwarding for
   receiving. **`EMAIL_FROM` cannot be a gmail.com address.**
10. ABN, registered business name, business postal address, return address, a
   support mailbox, real prices, product photography, and **a lawyer's read of
   the three `/legal/*` drafts** — especially the contract-formation clause in
   `app/legal/terms/page.tsx`. Also **name Fly.io as the hosting provider** on
   `/legal/privacy`, which still describes hosting generically.

`SETUP.md` is her runbook for all of it and is written for a non-developer.
Keep it that way.

## Finishing

Keep `WORKLOG.md` current — it is the source of truth for project state, and §0
and §6 are what the next session reads first. Keep commits scoped, with honest
messages, and staged **by name** (never `git add -A`). Report what you **ran**,
what you only **reasoned about**, and what still needs the owner's accounts.
