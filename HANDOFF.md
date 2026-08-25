# Handoff prompt — Bam Studio shop

Paste everything below the line into a fresh Claude Cowork session with a
high-capability model. It is written to be **self-contained**: a session that
reads only this file can start work safely, and everything it defers to is
named by file and section.

---

> ⚠️ **This file is stale as of round 10 (25 August 2026). Read `WORKLOG.md` §0
> and §5 round 10 before believing anything below.** In particular: the round-9
> postage work **is** committed (`36a33d5`, unpushed, not "not committed
> anywhere"); `scripts/verify-sql.sh` **does** apply `0002_shipping.sql` and the
> harness runs **29/29**; `quoteBasket()` **is** wired into checkout, the cart
> and `POST /api/shipping/quote`; `shippingCost()` has been **deleted**; and
> `transitLabel()` now takes `tracked` as a required argument. Nine files show
> as CRLF-modified, not ten. The rest of this file — how to work, the
> verification protocol, the hard business rules, the traps, and the owner's
> outstanding steps — still stands.

You are the **orchestrator** for pre-launch work on the Bam Studio online shop
at `bamstudio-shop/`. It is a real Australian sole trader's shop, it takes real
card payments, and a real customer will use it. Treat every change as
production work.

The shop is **built and never deployed**. Ten launch blockers were found and
closed across seven review rounds; the hosting then moved from Vercel to Fly.io
(round 8); and postage was rebuilt against the live Australia Post API (round 9)
but **deliberately left unwired**. `WORKLOG.md` is the source of truth for all
of it — start at **§0**, which now opens with the current open list.

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
   in the repo), **§5 rounds 8 and 9** (hosting, and postage), **§6** (open
   items, the backlog and the pending owner decision).
4. `README.md` for architecture, `SETUP.md` for what the owner must supply.

Have a subagent produce a condensed brief of §0, §4, §5 round 9 and §6 rather
than reading all of `WORKLOG.md` into your own context.

## Traps in this environment — read before your first command

Every one of these has already cost someone time.

- **The device bridge VM has no network access.** `git push`, `fly`, `curl` to
  the internet and anything else needing egress **must be run by the owner**.
  Never report a push or a deploy as done because a command exited.
- **`git` on the mounted Windows folder cannot delete its own lock files.**
  Clear them by moving them aside — `mv .git/index.lock /tmp/`, and the same for
  any other `.git/**/*.lock` — not with `rm`.
- **Ten files show as permanently modified and it is pure CRLF line-ending
  noise. Never `git add -A`.** Stage by name, or the diff becomes unreviewable
  and the real change is invisible inside it.
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

**Expect the clones to disagree.** The hosting move is reported as commit
`896c08d`, pushed to `master` at `github.com/nellyy2505/bamstudio-shop`. That
commit does **not** exist in the sandbox checkout these docs were written in,
where every round-8 and round-9 file is untracked or modified in the working
tree. Both can be true — they are different clones — so **`git status` is the
only trustworthy answer to "what is committed"**, and the round-9 postage work
is not committed anywhere as far as anything here can tell.

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
- **The hosting move to Fly.io is complete in the code** — `Dockerfile`,
  `fly.toml`, `.dockerignore`, `.github/workflows/deploy.yml`, the new
  dependency-free `/api/health`, and fixes to three defects that only existed
  off Vercel: `siteUrl()` silently returning localhost (a customer would have
  been charged and then redirected to their own machine), `clientKey()` reading
  the **first** `x-forwarded-for` value (forgeable on Fly, whose proxy *appends*),
  and health checks that would have run through `proxy.ts` into Supabase auth
  every few seconds.

### Built, verified against the live carrier API, and NOT wired up

`lib/shipping/` — seven modules that quote real Australia Post postage.
**Nothing imports them.** `app/api/checkout/route.ts:499` still calls the
flat-rate `shippingCost()`. This is the top piece of work.

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
- **`transitLabel()` in `lib/config.ts` hardcodes "· tracked"** — true only
  while everything ships as a parcel. **It must be fixed in the same change that
  ever enables Large Letter**, or the site tells customers untracked mail is
  tracked. `quoteBasket` returns a `tracked` boolean per quote; read that.
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

### Still not built — do not read ticks as "done"

1. **Postage wiring** — `quoteBasket` into checkout (replacing `shippingCost()`
   at `app/api/checkout/route.ts:499`), a `POST /api/shipping/quote` route, the
   cart UI and copy, and the three order provenance columns `0002` added.
2. **`scripts/verify-sql.sh` applies only `0001_init.sql`**, while `verify.sql`
   is now **29 assertions** written against `0002_shipping.sql`. **The SQL
   harness cannot pass as it stands** and 29/29 has never been observed.
3. **The rate limiter is still one process's memory.** Round 8 fixed *which IP
   it reads*, not durability. It is the only thing in front of `/api/track`,
   which returns a postal address for an order number plus the matching email —
   and order numbers are a sequence plus four hex characters. Upstash/Redis; the
   call sites do not change.
4. **Real account deletion.** The claim was fixed, not the capability. Needs a
   server-side admin route, re-authentication, and an in-flight-order guard.
5. **A newsletter subscriber list.** No table, no audience, no unsubscribe.
6. **The `"unknown"` email sentinel escapes the webhook** into `/track`, the
   account order pages and `lib/queries.ts`, which read the column as an address.
7. **Nothing writes `orders.tracking_number`, and there is no admin surface.**
   The status progression customers are shown advances only by a hand edit in
   the Supabase table editor.
8. **`components/contact/Reach.tsx`** — the "can the customer reach us" fallback
   chain is still written out six times in JSX. The predicates were deduplicated
   into `lib/contact.ts`; the markup was not.
9. **`0002_shipping.sql` declares `letter_eligible … default true`** while
   `lib/shipping/weights.ts` treats an absent flag as **false** and the seed
   writes `false` for all 44 rows. A new row added in the table editor therefore
   arrives letter-eligible — the wrong way round. Nothing is wrong today.

## What to do first

Roughly this order of value:

1. **Fix `scripts/verify-sql.sh` to apply `0002_shipping.sql`**, then run it and
   report the real number. Everything else you do to the schema is unverifiable
   until this works, and it is a two-line change.
2. **Wire `quoteBasket()` into checkout**, plus `POST /api/shipping/quote` and
   the cart. Both surfaces must call `quoteBasket` and nothing else — two code
   paths computing postage is how the price a customer agreed to and the price
   Stripe charges come to differ for some baskets and not others. Leave the
   free-shipping threshold where it is: `quoteBasket` answers what the post
   office charges, `shippingCost()`/`SHIPPING.freeThreshold` decides who pays it.
3. **The rate limiter** — the only remaining *security* item fully in your hands.
4. **The `"unknown"` sentinel**, wherever it escapes the webhook.
5. **`components/contact/Reach.tsx`** — mechanical, and it protects the thing
   two whole review rounds were about.
6. **Real account deletion**, then a subscriber list or the removal of the
   newsletter form. Either is honest; a form that looks like a subscription and
   isn't, is not.
7. **Make `verify.sql`'s backfill assertions run the migration's own `UPDATE`**
   rather than a hand-copied `WHERE` clause.

## Verification protocol — non-negotiable

`tsc`, `eslint`, `build` and every SQL check passed while all ten launch
blockers were live. Green checks measure what is being watched.

1. **Static:** `npx tsc --noEmit && npx eslint . && npm run build`. Round 9
   added five non-optional fields to `Product` in `lib/types.ts` and the
   typecheck has **not** been re-run since; do it first.

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
   (`anon`/`authenticated`/`service_role`, `auth.users`, `auth.uid()`,
   `pgcrypto`), then the migration, the seed and `verify.sql`, and exits
   non-zero if any row is not `t`.

   ⚠️ **It applies `0001_init.sql` only and `verify.sql` now needs
   `0002_shipping.sql` too — fix that before quoting any result.** Docker is the
   older alternative and is in `WORKLOG.md` §4.

   **The schema is `supabase/migrations/0001_init.sql` plus
   `0002_shipping.sql`. There is no `supabase/schema.sql`** — the docs used to
   say there was, and it cost real time.

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
| `AUSPOST_API_KEY` | **Runtime secret** (new) | `fly secrets set`; free and instant from developers.auspost.com.au. **Not in `.env.example` yet** |
| `FLY_API_TOKEN` | CI credential | GitHub Actions **Secret** |

Rules that go with the table: **never move a secret into a build arg** (build
args are recorded in image history and readable by anyone who can pull the
image); **never tell the owner to set a `NEXT_PUBLIC_*` value as a Fly secret**
(it does nothing — those are baked in at build time); and `fly secrets list`
prints names only, which is the only listing that should ever appear in a report.

## The owner's outstanding steps — not yours to do

Chase these; do not attempt them.

1. ⚠️ **Rotate the Supabase JWT secret.** An anon key and a `service_role` key
   were exposed in chat. **The exposed anon key still authenticates**, which
   means the secret has not been rotated and the leaked `service_role` key — which
   bypasses row-level security entirely and can read every customer address — is
   very likely still live. Rotating means updating three places in one sitting:
   `.env.local`, the GitHub Actions Secret (**then redeploy** — it is a build
   arg), and `fly secrets set`. The exposed Stripe **live** key has already been
   rolled; test keys are in use.
2. **Weigh three items and give the real numbers** — one name charm, one clicker
   keychain, one pet bowl, each in the mailer actually used: grams, and thickness
   in mm. Every weight and dimension in `lib/shipping/dimensions.ts` and in the
   seed is an estimate. Highest-value input to postage accuracy there is.
3. **Decide: Large Letter or tracked parcel** for small orders — $3.40 untracked
   and uninsured versus about $10.20 tracked. Enabling it is a per-row toggle in
   Supabase **plus** the `transitLabel()` fix, together.
4. **Run the migrations.** The Supabase project exists and **the database is
   still empty**: `0001_init.sql`, then `0002_shipping.sql`, then `seed.sql`,
   then `verify.sql` with every row printing `t`.
5. **Create the Fly app** — it does not exist yet, and nothing has ever been
   deployed. First deploy lands at `bamstudio-shop.fly.dev`.
6. **Delete Porkbun's `*` parking CNAME** on `bamstudioshop.com` (currently
   pointing at `uixie.porkbun.com`) — it shadows email records.
7. **Get `AUSPOST_API_KEY`** (free, self-serve, instant) and set it as a Fly
   secret. Without it postage falls back to a pessimistic table and still works.
8. **Set up email**: Resend free tier for sending, Porkbun forwarding for
   receiving. **`EMAIL_FROM` cannot be a gmail.com address.**
9. ABN, registered business name, business postal address, return address, a
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
