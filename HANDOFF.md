# Handoff prompt — Bam Studio shop

Paste the block below into a fresh Claude Cowork session with a high-capability
model.

**Status of this file: §0 is done, so its original job is over.** It has been
rewritten rather than deleted — deleting it is the owner's call, not an
agent's. What is below now describes the shop as it actually stands after the
remediation pass, and what is left. If you are picking this up cold, this file
plus `WORKLOG.md` §0 is enough to start.

---

You are the **orchestrator** for pre-launch work on the Bam Studio online shop
at `bamstudio-shop/`. A real customer will use this. Treat every change as
production work.

The ten launch blockers in `WORKLOG.md` §0 have all been addressed. **That is
not the same as finished** — two are closed only for the claims they made, and
§0 marks which fixes were verified by *running* them and which were verified by
reading. What remains is listed under "Where the work stands" below.

## How I want you to work

Your own context is the scarce resource. Spend it on judgement, not on reading.

- **Delegate all reading and implementation to subagents.** You should rarely
  open a large file yourself. Dispatch a subagent to investigate, and require
  it to report back compactly: findings, file:line references, and the diff it
  made — never a file dump.
- **Run independent work in parallel.** Send multiple subagent dispatches in a
  single message whenever the tasks touch disjoint files and share no state —
  and check that they really are disjoint before you do. Most of the remaining
  work ("Where to start", below) is small and sequential; the trap here has
  always been two agents in one file, not too little parallelism.
- **Keep the chat for orchestration only**: planning, reconciling subagent
  reports, verification decisions, and reporting to me. If you find yourself
  reading source to answer a question, that was a subagent's job.
- **Plan before dispatching.** Write the plan out, name the files each
  workstream will touch, and confirm nothing overlaps. Overlapping subagents
  editing the same file will clobber each other.
- **Verify centrally.** Subagents implement; *you* decide whether it worked,
  using the verification protocol below. Do not accept a subagent's "done" as
  evidence — a subagent reporting green while the feature is broken is the
  exact failure mode this project has already hit three times.
- **Report to me at each checkpoint** with what changed, what you verified and
  how, and what you could not verify. Ask before anything irreversible.

## Read these first, in this order

1. `CLAUDE.md` — architecture, commands, hard business rules, verification
   protocol. It imports `AGENTS.md`.
2. `AGENTS.md` — **this is Next.js 16 and it has real breaking changes vs. your
   training data**: `middleware` is renamed `proxy` (see `proxy.ts`), and
   `params`/`searchParams` are Promises. Read the matching guide under
   `node_modules/next/dist/docs/` before writing code.
3. `WORKLOG.md` — start at **§0**, now a status table for the ten blockers plus
   an explicit split between what was verified by execution and what was only
   reasoned about. §2 is the business rules, **§4 is how to verify and is now
   two scripts plus a webhook harness that is not in the repo**, §5 is seven
   rounds of review history — **read round 7**, where the round-6 email fix
   turned out to reproduce the defect class it was closing — and §6 is the open
   list with the top follow-up named at the front.
4. `README.md` for architecture, `SETUP.md` for what the owner still has to
   supply.

Have a subagent produce a condensed brief of §0, §4 and §6 rather than reading
all of `WORKLOG.md` into your own context.

## Check the ground truth before you start

Run `git status` and `git diff --stat` first and reconcile against what the
docs claim, rather than assuming any of them is current. The remediation pass
left a large working tree that may or may not be committed by the time you
read this.

Two habits this project earned the hard way:

- **Don't trust a commit message as a complete description of its contents.**
  Earlier in this repo's history a commit messaged as a documentation tweak
  also carried an unrelated security fix that was in flight at the time. Check
  the stat.
- **If a second session is active, agree file ownership with me before you
  dispatch subagents.** Two agents editing the same file clobber each other,
  and it has happened here.

## Where the work stands

**All ten §0 blockers have been worked.** `WORKLOG.md` §0 is the status table
and is the source of truth; this is the orientation.

What genuinely changed, in one line each:

- **Email exists** (`lib/email.ts`, Resend over `fetch`, no npm dependency,
  never throws, never logs PII), and every claim about it is gated on
  **`isEmailConfigured()`** — the same `RESEND_API_KEY && EMAIL_FROM` check the
  sender itself makes, so a claim and the capability cannot disagree. The
  webhook sends a real itemised order confirmation, once, anchored on the
  order-number compare-and-set.
- **The claim/capability split that gated it before is gone.**
  `SHOP.canSendEmail` and `NEXT_PUBLIC_EMAIL_ENABLED` have been removed; nothing
  reads the variable. Two switches for one fact shipped four false statements —
  see "Decisions already taken" below, and read that before you touch any page
  that mentions email.
- **`lib/contact.ts` exists** and holds the six shared predicates the pages used
  to copy-paste. This was the top follow-up in the previous version of this
  file; the predicate half is done.
- **A guest can see their own order number** on `/order/confirmed`, read
  through a `SECURITY DEFINER` function keyed on the Stripe session id. This,
  not the email, is the actual fix for untrackable orders — email is now a
  convenience.
- **`lookup_order` is `service_role` only**, with an explicit `revoke` so the
  migration closes the hole on already-deployed databases, and `/api/track`
  allow-lists its response (the customer's phone number no longer crosses the
  wire).
- **The webhook no longer strands paid orders**, no longer double-inserts
  items, no longer loses the variant on a repair, and no longer burns an order
  number per duplicate delivery.
- **The copy is truthful**: no hardcoded `[HELLO@YOURDOMAIN]`, consent
  unticked, "free shipping" qualified as standard post only, "Delete account"
  describing what it actually does.

### What is still not built — do not read the ticks as "done"

1. **Real account deletion.** §0.9 fixed the *claim* only. Actual deletion
   needs a server-side admin route holding the service-role key (the browser
   client uses the anon key and is refused), **re-authentication** before it
   fires, and a guard for in-flight orders. Decide the retention story too —
   the privacy page says order and payment records are kept for tax purposes,
   so "delete" means the account and profile, not the orders.
2. **A newsletter subscriber list.** There is no table, no audience, no
   unsubscribe. `/api/newsletter` forwards a *notification* to the studio and
   the owner adds people by hand. Nothing on the site may promise a newsletter,
   a welcome email or an unsubscribe link until one exists.
3. **`lib/rate-limit.ts` is now load-bearing and is still in-memory.** It was a
   speed bump while `lookup_order` was callable over PostgREST with the public
   key. Closing that door made this throttle the **only** thing in front of
   `/api/track`, which returns a postal address for an order number plus the
   matching email — and order numbers are a sequence plus four hex characters.
   `clientKey()` trusts `x-forwarded-for`. Move it to Vercel KV or Upstash
   before launch; the call sites don't change.
4. **`public.handle_new_user()` keeps its default `PUBLIC EXECUTE`.** Not
   exploitable (trigger-only) but inconsistent with every other function in the
   schema.
5. **The `reviews` table is world-readable, including `user_id` and
   `author_name`.** Empty today, a real disclosure the day reviews ship.
6. **The `"unknown"` email sentinel escapes the webhook.** `orders.email` is
   `NOT NULL`, so the Stripe-rebuild path writes the literal string `"unknown"`
   when Stripe gave no address. The webhook itself reads it correctly, through
   `hasCustomerEmail()` — but `/track`, the account order pages and
   `lib/queries.ts` all read the column with no idea the sentinel exists.
7. **Nothing writes `orders.tracking_number`, and there is no admin surface at
   all.** The `confirmed → printing → packed → shipped` progression the shop
   shows customers on `/track` is, today, **a manual edit in the Supabase table
   editor**. Worth deciding before launch whether that is acceptable or whether
   an owner view is the next feature.
8. **`verify.sql`'s backfill assertions test a hand-copied duplicate** of the
   migration's `WHERE` clause rather than the real `UPDATE`. Editing the
   migration leaves them green while they test the old logic — the exact class
   of silent drift the checkout replay harness was just fixed for.

### The top follow-up — half done, and the remaining half named

The previous version of this file asked for the copy-pasted "can the customer
reach us" predicates to be moved into `lib/contact.ts`. **That is done.**
`hasStudioMailbox`, `hasSocialAccount`, `canReachStudio`,
`formsReachStudio(canSendEmail)`, `sendsOrderConfirmation(canSendEmail)` and
`socialLinks` now have one definition each, imported by fifteen files. Doing it
is what surfaced the privacy defect: the old single `FORM_DELIVERS` test was
being used for two different questions.

**What is still duplicated is the JSX**, not the logic. The "reach us" fallback
chain — real mailbox → social handles → a plain statement that no contact
address has been published — is written out six times:

- `Reach` in `app/legal/terms`, `app/legal/privacy`, `app/legal/refunds` and
  `app/account/orders/[id]` (four near-identical copies, each with its own
  `SocialLinks` and `NO_CHANNEL`);
- `HowToAsk` in `app/account/settings/DeleteAccountCard.tsx`;
- `emailChangeHint` in `app/account/settings/ProfileCard.tsx`.

(`ReachUsCard` in `app/contact/page.tsx` is a seventh, but it is a card rather
than a sentence and may honestly stay its own thing.)

**Wants a `components/contact/Reach.tsx`.** A `.ts` module cannot hold markup,
which is why the predicates could move and this could not; a component can.
Each copy words its fallback slightly differently, so the component needs to
take the wording as props rather than flatten it. Same argument as before: what
this chain decides is whether a page tells a charged customer to "get in touch",
so a drift between copies is a false claim.

## Decisions already taken and now implemented — don't relitigate them

- **Email has ONE switch, and the second one was a defect.**
  `isEmailConfigured()` in `lib/email.ts` — `RESEND_API_KEY && EMAIL_FROM`, the
  same expression `sendEmail` checks — is the single source of truth.
  `SHOP.canSendEmail` and `NEXT_PUBLIC_EMAIL_ENABLED` **have been removed**;
  nothing reads the variable, and `lib/config.ts` carries a comment at the spot
  saying why. This reverses an earlier decision recorded in this same file, so
  here is the evidence: a public claim flag beside a private capability meant
  the two could disagree, and both disagreeing states shipped. In the launch
  configuration the terms, the privacy policy and the account settings page
  each stated the shop sends no order emails while the webhook was sending an
  itemised one, and Resend was disclosed as a data processor only when the
  support mailbox was *also* set — so in realistic partial configurations
  customer names, addresses, order contents and totals went to a US processor
  the privacy policy did not name. **Do not reintroduce a public mirror of a
  server fact.**
- **The capability is threaded as a prop, not imported.**
  `isEmailConfigured()` throws in the browser rather than answering `false` (a
  hand-rolled stand-in for `server-only`, which is not a dependency here). A
  server component calls it; a client component takes a `canSendEmail` boolean
  prop. `app/account/settings/page.tsx` is the one threading site.
- **The order confirmation and the forms have different conditions, and that is
  the point.** `sendsOrderConfirmation(canSendEmail)` is the secrets **alone**;
  `formsReachStudio(canSendEmail)` additionally needs
  `NEXT_PUBLIC_SUPPORT_EMAIL`, because the form and the newsletter deliver *by
  emailing* the mailbox. Anding them into one test is the mistake that produced
  the false statements above. Both live in `lib/contact.ts`. Import them.
- **`cancelled` is the only terminal order status, and a cancelled order that
  is paid anyway is refunded by hand.** The webhook will not number it, move
  its stock or email its customer, and returns 200 — no retry can make it
  eligible. Later fulfilment states are still repairable. The error log names
  the order and the session so the owner can find the payment.
- **The order number reaches the guest independently of email.** Keep it that
  way. If email breaks, an order must still be trackable.
- **The §0.5 checkout guard is scoped to `NODE_ENV === "production"`, and this
  is load-bearing.** The only end-to-end verification this project has runs the
  app with *no database at all*; an unconditional guard turns all seven replay
  cases into a 503 that never reaches the validation under test, and the run
  goes quiet rather than red. That has been done and re-fixed **twice**
  (`WORKLOG.md` §5 rounds 3 and 4). Round 4's rule stands: a guard may reject a
  query *error*, never the *absence* of a database. `WORKLOG.md` §4 has the
  full reasoning and so does a comment at the guard. **Do not tidy it away.**
- **Recovered data is left null rather than guessed.** On the webhook's rebuild
  path, a variant segment that cannot be placed unambiguously against the
  product's own colour and attachment lists is written as `null`, and the raw
  string survives in `variant_label`. A wrong printed charm costs a reprint and
  a customer; a null costs someone reading one line.
- **`short_name` is not unique — the slug is the key.** Checkout stamps
  `metadata: { slug }` on each Stripe line and the webhook prefers it, with a
  name fallback only for sessions created before that existed.

## Where to start

Pick one, in roughly this order of value:

1. **The rate limiter** — Vercel KV or Upstash. It is the only remaining
   *security* item that is fully in your hands, and it is now the only thing in
   front of a customer's postal address.
2. **The `"unknown"` email sentinel**, wherever it escapes the webhook —
   `/track`, the account order pages, `lib/queries.ts`. Small, and it is a
   truthy string sitting in a column three readers treat as an address.
3. **`components/contact/Reach.tsx`** — the JSX half of the deduplication
   above. Mechanical, and it protects the thing the last two rounds were about.
4. **Real account deletion** — the largest genuinely-missing feature, and the
   one the site currently apologises for.
5. **A subscriber list, or remove the newsletter form.** Either is honest;
   what is not honest is a form that looks like a subscription and isn't.
6. **Make `verify.sql`'s backfill assertions run the migration's own `UPDATE`**
   instead of a hand-copied `WHERE` clause, so editing the migration cannot
   leave them green.
7. **Then the round-5 leftovers** that were never blocking: uncapped "Only N
   ready to ship", no quantity cap in the cart, empty `next.config.ts` with no
   CSP, inert `revalidate`, the recovery cookie keyed on `next` rather than the
   flow.

The owner's own list — support mailbox, ABN, business name and address, real
prices, legal review — is in `SETUP.md` and is not yours to do.

## Verification protocol — non-negotiable

`tsc`, `eslint`, `build` and every SQL check passed while all ten launch
blockers were live. Green checks measure what is being watched. So:

1. Static: `npx tsc --noEmit && npx eslint . && npm run build`.
2. **After anything touching checkout:**

   ```bash
   printf 'STRIPE_SECRET_KEY=sk_test_dummy\n' > .env.local && npm run dev
   node scripts/replay-checkout.mjs      # second terminal
   ```

   This is now a script, so nobody has to reconstruct the payloads: it posts
   the exact JSON `CartView.checkout()` sends for all four personalised
   products (`custom-name-charm`, `alphabet-bag-charm-on-cord` builder;
   `custom-number-date-chain`, `personalised-bowl-with-pet-s-name` text), an
   ordinary product, a mixed basket, and a negative control.

   **502 = validation passed and reached Stripe. That is the pass.** 400/409 =
   rejected; 503 = misconfigured app. **One bad line rejects the whole
   basket**, which is how two previous blockers hid, so the mixed basket is not
   optional.

   **Case 7, the negative control, is what makes a green run mean anything** —
   text personalisation on an ordinary product, which must come back **400**.
   If it returns 502 the harness is not observing validation and every PASS
   above it is meaningless; the script says so. Treat a run where the negative
   control passed as no run at all.

   It honours `BASE_URL` and `DELAY_MS`, and **aborts on a 429** rather than
   reporting rate limiting as failures — two runs back to back will trip the
   route's 10-per-60s limit.

3. **SQL:**

   ```bash
   ./scripts/verify-sql.sh
   ```

   One command, self-bootstrapping, drives a locally installed PostgreSQL 16,
   applies the Supabase shims plus the migration plus the seed, runs
   `verify.sql`, prints the assertion table and **exits non-zero if any row is
   not `t`**. Docker remains the alternative and is in `WORKLOG.md` §4 — it is
   the older recipe, and Docker was unavailable when this was last verified,
   which is why the script exists.

   **The schema is `supabase/migrations/0001_init.sql`. There is no
   `supabase/schema.sql`** — the docs used to say there was, and it cost real
   time.

4. **After anything touching the Stripe webhook**, there is a behavioural
   harness of 43 scenarios — real route module, fake Supabase and Stripe,
   asserting on the calls made and the status returned. Last run **43/43**.
   **It lived in `/tmp/webhook-harness/` and does not survive the session.** If
   it is gone, rebuild it rather than assuming the webhook is covered;
   `CLAUDE.md` lists what it covers so a rebuild has a target. Neither
   `replay-checkout.mjs` nor `verify-sql.sh` touches this file, and it is the
   highest-consequence one in the project.
5. For security fixes, prove the exploit fails *and* the legitimate path still
   works. Run the actual payload; do not reason about it.
6. **Say which of the two you did.** `WORKLOG.md` §0 keeps an explicit split
   between what was verified by execution and what was only reasoned about, and
   it is the most useful thing in the file. Never let a "verified" in a report
   mean "I read it carefully".

## Rules that are not preferences

No licensed characters. The business is **not GST-registered** — no page may
show or claim GST. No invented reviews, ratings or stock. "2–4 business days"
is printing time, never delivery. Personalised items are non-returnable except
when faulty. Prices are always recomputed server-side. Australian English in
customer-facing copy.

Because this shop makes claims to customers, **a change that makes an on-site
statement untrue is as serious as a crash.**

## Finishing

Keep `WORKLOG.md` current — it is the source of truth for project state, and §0
and §6 are what the next session reads first. Keep commits scoped with honest
messages. Report to me what you **ran**, what you only **reasoned about**, and
what still needs my accounts before launch; those are three different things
and this project has been burned by treating them as one.
