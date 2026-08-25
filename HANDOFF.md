# Handoff prompt — Bam Studio shop

Paste the block below into a fresh Claude Cowork session with a high-capability
model. This file is disposable; delete it once the work in `WORKLOG.md` §0 is
finished.

---

You are the **orchestrator** for pre-launch remediation on the Bam Studio
online shop at `bamstudio-shop/`. A real customer will use this. Treat every
change as production work.

## How I want you to work

Your own context is the scarce resource. Spend it on judgement, not on reading.

- **Delegate all reading and implementation to subagents.** You should rarely
  open a large file yourself. Dispatch a subagent to investigate, and require
  it to report back compactly: findings, file:line references, and the diff it
  made — never a file dump.
- **Run independent work in parallel.** Send multiple subagent dispatches in a
  single message whenever the tasks touch disjoint files and share no state.
  The workstreams below are annotated with what is parallel-safe.
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
3. `WORKLOG.md` — start at **§0 "START HERE"**, the ranked defect list that is
   the actual job. §2 is the business rules, §4 is how to verify, §5 is five
   rounds of review history and worth skimming for what has already been tried.
4. `README.md` for architecture, `SETUP.md` for deployment.

Have a subagent produce a condensed brief of §0 and §4 rather than reading all
of `WORKLOG.md` into your own context.

## Check the ground truth before you start

**Another agent session has been editing this repository concurrently**, and
may still be. Run `git log --oneline -6` and `git status` first, and reconcile
against what the docs claim rather than assuming this file is current.

One artefact of that: commit `9d7552a` is messaged "Point the design reference
at the local files, not a dead link" but contains three files — the WORKLOG
edit *plus* an unrelated open-redirect fix that was in flight at the time.
(`8e09042` acknowledges and corrects this.) Don't trust a commit message here
as a complete description of its contents; check the stat.

If a second session is still active, agree file ownership with me before you
dispatch subagents — two agents editing the same file will clobber each other.

## Where the work actually stands

**§0.3 (open redirect) is DONE and verified.** `lib/safe-next.ts` now resolves
`next=` against a sentinel origin and compares `.origin` on *both* the input
and the resolved output. Both call sites (`app/auth/callback/route.ts`,
`app/login/page.tsx`) use it; no other copies remain. Verified empirically
against `/<TAB>//evil.com`, `//evil.com`, `/\evil.com`, `https://evil.com`,
`javascript:`, and `/..//evil.com` — that last one defeats the naive
origin-check fix, because it resolves same-origin but *normalises* to a
protocol-relative path, so the returned path must be re-checked too. Legit
paths including `/reset-password` (which gates the recovery cookie) still pass.
Committed as `8e09042`, and `WORKLOG.md` §0 item 3 is marked done.

Everything else in §0 is open: **items 1, 2, 4, 5, 6, 7, 8, 9, 10.** Items 1,
2 and 4 are the ones a customer or an attacker actually meets — start there.

## Decisions already taken — proceed on these unless you can show they're wrong

- **Email (§0.1): wire Resend *and* gate every claim.** Add `lib/email.ts`
  behind `RESEND_API_KEY`/`EMAIL_FROM` with a derived `SHOP.canSendEmail` flag.
  Every on-site statement that an email will be sent must be gated on that
  flag, so the shop is truthful when it is unconfigured and correct once keys
  land. Supabase Auth's own emails (signup confirmation, password reset) are
  real — those claims stay.
- **Independently of email, give the guest a path to their order number.**
  This is the actual fix for untrackability. `/order/confirmed` currently never
  selects `order_number`, and its guest read goes through the anon client where
  RLS is `auth.uid() = user_id`, so a guest can never see it. Add a
  `SECURITY DEFINER` lookup keyed on `stripe_session_id` (an unguessable secret
  the page already holds), called with the service role, and show the number
  with a link to `/track`. Email then becomes a convenience, not the only path.
- **§0.5 guard is scoped to production.** Refusing checkout when Supabase env
  is missing must NOT fire in dev, because the documented checkout verification
  flow depends on running with no database at all. Gate on
  `NODE_ENV === "production"` and document why in `WORKLOG.md` §4. An
  unconditional guard silently breaks the one test that has caught three
  regressions.
- **§0.6 ordering.** The legal pages' hardcoded `[HELLO@YOURDOMAIN]` should
  fall back to `/contact` — but that is only honest once the contact form
  actually delivers, so do §0.1 first.

The owner is setting up Supabase later today, so **everything must be
verifiable without a live database.** Do not write anything that assumes one.

## Suggested workstreams

Plan your own decomposition, but these are the natural seams. Items within a
group touch the same files and must be sequential; the groups are largely
parallel-safe.

- **A — webhook integrity (§0.4, §0.7, §0.8).** All in
  `app/api/webhooks/stripe/route.ts` plus the `stock_applied` backfill in
  `supabase/migrations/0001_init.sql`. §0.4: the staged-row SELECT at the top
  of `confirmOrder` discards its error, so a transient read failure falls
  through to the insert path, hits the unique constraint on
  `stripe_session_id`, and `23505` is swallowed with a **200** — which tells
  Stripe to stop retrying and strands a paid order as `pending` forever.
- **B — order lookup (§0.2).** `lookup_order` is granted to `anon` in
  `supabase/migrations/0001_init.sql`, so it is callable straight over
  PostgREST with the public key and the throttle in `app/api/track/route.ts` is
  decorative. It returns street address and phone. Revoke to `service_role`
  only, move `/api/track` to the admin client, keep a missing key
  indistinguishable from a miss, and add an assertion to `supabase/verify.sql`
  for the *absence* of the grant.
- **C — email + order number (§0.1, then §0.6).** The largest workstream.
- **D — truthful copy (§0.9, §0.10).** Untick marketing consent in
  `SignupForm`, make "Delete account" say what it does, stop logging PII in
  `api/contact`, and qualify "free shipping" as standard-post-only — the cart
  currently says "Free shipping unlocked" while Express is selected and still
  charges $14.50.
- **E — §0.5 checkout guard.** Small; sequence it after A to avoid conflicts.

A, B and D are parallel-safe with each other. C overlaps D on copy files —
sequence or partition carefully.

## Verification protocol — non-negotiable

`tsc`, `eslint`, `build` and every SQL check pass **right now** with launch
blockers live. Green checks measured what was being watched. So:

1. Static: `npx tsc --noEmit && npx eslint . && npm run build`.
2. **After anything touching checkout**, replay the payload the client actually
   builds. Copy the exact JSON shape from `CartView.checkout()` in
   `app/cart/CartView.tsx` — do not hand-write one — and POST it to
   `/api/checkout` with `STRIPE_SECRET_KEY=sk_test_dummy` in `.env.local`.
   **502 = validation passed and reached Stripe (success). 400/409 = rejected.**
   Cover all four personalised products (`custom-name-charm`,
   `alphabet-bag-charm-on-cord` builder; `custom-number-date-chain`,
   `personalised-bowl-with-pet-s-name` text), one ordinary product, and a mixed
   basket — **one bad line rejects the whole basket**, which is how two
   previous blockers hid. Script this so it is repeatable.
3. **SQL:** `supabase/verify.sql` against real Postgres 16 in Docker; every row
   must print `t`. Recipe is in `WORKLOG.md` §4.
4. For security fixes, prove the exploit fails *and* the legitimate path still
   works. Run the actual payload; do not reason about it.

## Rules that are not preferences

No licensed characters. The business is **not GST-registered** — no page may
show or claim GST. No invented reviews, ratings or stock. "2–4 business days"
is printing time, never delivery. Personalised items are non-returnable except
when faulty. Prices are always recomputed server-side. Australian English in
customer-facing copy.

Because this shop makes claims to customers, **a change that makes an on-site
statement untrue is as serious as a crash.**

## Finishing

Update `WORKLOG.md` §0 as items close (including correcting item 3, already
done), keep commits scoped with honest messages, and report to me what is
verified, what is assumed, and what still needs my accounts before launch.
