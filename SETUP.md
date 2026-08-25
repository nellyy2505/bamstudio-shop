# Setup & deployment — what you need to do

Everything below is a task only you can do, because it needs accounts in your
name. Work top to bottom; each step says exactly where to click and what to
paste into `.env.local`.

Budget about 90 minutes for the first pass. **Nothing here costs money** —
Supabase and Vercel both have free tiers, and Stripe only charges per sale
(1.75% + $0.30 for Australian cards, plus GST on the fee).

---

## Step 1 — Supabase (database + customer accounts)

### 1a. Create the project

1. Go to **<https://supabase.com>** → sign up (GitHub login is easiest).
2. **New project**. Name it `bamstudio-shop`.
3. **Database Password**: click Generate, then save it in your password
   manager. You will rarely need it, but it can't be recovered later.
4. **Region**: choose **Southeast Asia (Singapore)** or **Australia (Sydney)**
   if offered — closest to your customers.
5. Wait ~2 minutes for provisioning.

### 1b. Copy the three keys

Go to **Project Settings → API Keys** (and **Data API** for the URL):

| Supabase field | Goes into `.env.local` as |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` / publishable key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` / secret key | `SUPABASE_SERVICE_ROLE_KEY` |

> **The service_role key is a master key.** It ignores all security rules.
> Never put it in a file starting with `NEXT_PUBLIC_`, never paste it into a
> chat or a screenshot, and never commit it.

### 1c. Create the tables

1. In Supabase, open **SQL Editor → New query**.
2. Open `supabase/migrations/0001_init.sql` from this project, copy the whole
   file, paste it in, and click **Run**. It should say "Success".
3. New query again. Copy all of `supabase/seed.sql`, paste, **Run**. This
   loads your 44 products and 6 colourway collections. No reviews —
   those only ever come from real customers.
4. Check **Table Editor → products** — you should see the catalogue.
5. New query once more. Copy all of `supabase/verify.sql`, paste, **Run**.
   Every row must say `t`. It checks the things that otherwise fail silently
   in production — most importantly that the webhook is allowed to allocate
   order numbers and move stock. Without those grants, customers can pay and
   no order is ever recorded. The script writes two throwaway rows and rolls
   them back, so it is safe to re-run any time.

> The schema file is `supabase/migrations/0001_init.sql` — that one file **is**
> the schema. It is safe to re-run: if you applied an earlier version, run it
> again and it adds anything missing rather than starting over, leaving your
> data alone. It also revokes a grant that an earlier version handed out too
> widely, so re-running it on an existing database is not optional.

### 1d. Turn on Google sign-in

**In Google Cloud Console** (<https://console.cloud.google.com>):

1. Create a project (any name).
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**, then **Create**.
   - App name: `Bam Studio`. User support email: your email.
   - Developer contact: your email. Save and continue through the remaining
     screens; you do not need to add scopes.
   - While the app is in "Testing" only accounts you list can sign in, so hit
     **Publish app** when you're ready for real customers.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - **Authorised JavaScript origins**: add `http://localhost:3000` and later
     your live domain.
   - **Authorised redirect URIs**: paste the callback URL from Supabase —
     it looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
     (Find it in Supabase → Authentication → Providers → Google.)
   - Create, then copy the **Client ID** and **Client secret**.

**Back in Supabase** → **Authentication → Sign In / Providers → Google**:

- Toggle **Enable**, paste the Client ID and Client secret, **Save**.

### 1e. Set the auth URLs

Supabase → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` for now (change to your domain at
  launch).
- **Redirect URLs**: add all of these, one per line:
  ```
  http://localhost:3000/auth/callback
  https://YOUR-DOMAIN.com.au/auth/callback
  https://YOUR-VERCEL-PROJECT.vercel.app/auth/callback
  ```

> Email confirmation is on by default, so new sign-ups must click a link
> before they can sign in. Supabase's built-in email sender is rate-limited
> and fine for testing — for real volume, add a custom SMTP provider under
> **Authentication → Emails**.

---

## Step 2 — Stripe (payments)

### 2a. Account

1. Go to **<https://dashboard.stripe.com/register>** and sign up.
2. Choose **Australia** as the country and **AUD** as the currency —
   this cannot be changed later.
3. Stay in **Test mode** (the toggle at the top right) until you're ready to
   launch. Test mode uses fake cards and charges nothing.

### 2b. API keys

**Developers → API keys**:

| Stripe field | `.env.local` |
|---|---|
| Publishable key (`pk_test_…`) | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` |
| Secret key (`sk_test_…`) | `STRIPE_SECRET_KEY` |

### 2c. Webhook secret — local testing

The webhook is how paid orders get written into your database. Locally:

1. Install the Stripe CLI: <https://stripe.com/docs/stripe-cli>
   (on Windows: `scoop install stripe`, or download the .exe).
2. Run `stripe login`.
3. In a second terminal, with `npm run dev` running:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
4. It prints `whsec_…` — paste that as `STRIPE_WEBHOOK_SECRET` in
   `.env.local` and restart `npm run dev`.

### 2d. Business details before going live

Stripe will ask for these before it releases real money — do it early, as
verification can take a day:

- ABN (yours is still in progress — you'll need it here)
- Business bank account (the separate account you haven't opened yet)
- Photo ID
- A statement descriptor customers will see on their bank statement, e.g.
  `BAM STUDIO`

---

## Step 3 — Email (Resend)

The shop sends three kinds of email: the order confirmation a customer gets
after paying, contact-form enquiries forwarded to you, and a note when someone
asks to join the mailing list. Until this step is done **it sends none of
them** — and it knows that, so no page promises an email it can't send, and the
contact form tells the sender their message reached nobody. Nothing is broken
in the meantime; it is just quieter than you want.

Supabase's own sign-up and password-reset emails are separate and already work.

### 3a. Create the account and verify your domain

1. Go to **<https://resend.com>** and sign up. The free tier is 3,000 emails a
   month, which is far more than a new shop sends.
2. **Domains → Add Domain**, enter your domain, and add the DNS records it
   shows you at your registrar. Verification usually takes a few minutes.
3. **API Keys → Create API Key**. Copy it — it is shown once.

> You can test with Resend's shared sending domain, but order confirmations
> from an address you don't own land in spam folders. Verify your own domain
> before you take real orders.

### 3b. Set the two secrets — both, or neither

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | The key from 3a. A secret — never `NEXT_PUBLIC_` |
| `EMAIL_FROM` | e.g. `Bam Studio <hello@yourdomain.com.au>`, on the verified domain |

> **Set both at once, or leave both unset.** There is nothing else to switch
> on. The shop works out for itself whether it can send — one check,
> `RESEND_API_KEY` and `EMAIL_FROM` both present — and every sentence on the
> site that mentions email is written from that same check. It cannot promise
> a mail it will not send, and it cannot deny sending one it does send.
>
> There **used** to be a third variable, `NEXT_PUBLIC_EMAIL_ENABLED`, that you
> had to keep in step with these two by hand. **It has been removed. Do not set
> it — nothing reads it.** If you have it in a `.env.local` or in Vercel from
> an earlier version, delete it. Keeping one switch for what the shop *says*
> and another for what it *does* meant they could disagree, and both directions
> shipped a lie: the pages promising mail that never sent, and the terms and
> privacy policy denying order emails while the webhook was sending itemised
> ones.

### 3c. And `NEXT_PUBLIC_SUPPORT_EMAIL` — which is not optional

Set it in the same pass (it is also listed in Step 6 with the other shop
details). It is your studio mailbox, and the two secrets above are not enough
on their own:

| What sends | Needs |
|---|---|
| **Order confirmation** to the customer, from the Stripe webhook — itemised, with the order number | `RESEND_API_KEY` + `EMAIL_FROM`, and **nothing else**. Set those two and confirmations start going out |
| **Contact-form enquiries** and **newsletter sign-up notices**, forwarded to you | those two **and** `NEXT_PUBLIC_SUPPORT_EMAIL` — there is nowhere to forward them otherwise |

Nothing stores a contact enquiry or a sign-up, so the email *is* the delivery:
without a mailbox the shop will not offer your customer a form it cannot
deliver, and it says so on the page rather than swallowing their message. A faulty-goods claim is
the message you least want to lose, which is why it is written this way.

### 3d. Check it

With the dev server running, send yourself a message through `/contact`. It
should arrive at `NEXT_PUBLIC_SUPPORT_EMAIL`, and replying to it should reply
to you rather than to the shop. If the page instead says it could not send,
the terminal log names the reason — `not_configured` means `RESEND_API_KEY` or
`EMAIL_FROM` is missing, or the server was not restarted after you set them. If
the page shows contact details instead of a form at all, it is
`NEXT_PUBLIC_SUPPORT_EMAIL` that is missing.

---

## Step 4 — Run it locally

```bash
cd bamstudio-shop
cp .env.example .env.local
# paste in the values you collected above
npm install
npm run dev
```

Open <http://localhost:3000>. Then check:

- [ ] Products load on `/shop` (44 of them)
- [ ] Search suggests as you type
- [ ] `/builder` builds a name charm and adds it to the basket
- [ ] A pet-bowl style product asks for text before it can be added
- [ ] `/signup` creates an account and the confirmation email arrives
- [ ] Google sign-in works on `/login`
- [ ] Checkout redirects to Stripe. Pay with test card
      **4242 4242 4242 4242**, any future expiry, any CVC, any postcode
- [ ] After paying you land on the confirmation page, **it shows you an order
      number**, and a matching row appears in Supabase → Table Editor →
      `orders`
- [ ] That order number plus the email you used finds the order on `/track`
- [ ] If you did Step 3, the confirmation email arrives
- [ ] `/contact` delivers to your support mailbox and replying reaches you

If the order row fails to appear, the `stripe listen` terminal will show the
error. The order number is shown by the page whether or not email works — that
is deliberate, so a customer is never dependent on an email arriving.

---

## Step 5 — Deploy to Vercel

### 5a. Put the code on GitHub

```bash
cd bamstudio-shop
git add -A
git commit -m "Bam Studio shop"
```

Then create an empty repo at <https://github.com/new> (private is fine) and
follow the "push an existing repository" lines it gives you.

> `.env.local` is already git-ignored, so your keys stay off GitHub. Double
> check with `git status` before pushing.

### 5b. Import into Vercel

1. Go to **<https://vercel.com>** → sign up with GitHub.
2. **Add New → Project** → pick the repo → **Import**.
3. Framework Preset detects **Next.js**. Leave the build settings alone.
4. Before clicking Deploy, expand **Environment Variables** and add every key
   from `.env.local` **except** change:
   - `NEXT_PUBLIC_SITE_URL` → your Vercel URL (or custom domain once set)
5. **Deploy**. First build takes 2–3 minutes.

### 5c. Point the webhook at production

1. Stripe → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://YOUR-DOMAIN/api/webhooks/stripe`
3. **Events to send** — select exactly these four:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Add endpoint, then reveal the **Signing secret** (`whsec_…`).
5. In Vercel → Settings → Environment Variables, update
   `STRIPE_WEBHOOK_SECRET` with it, then **Redeploy**.

### 5d. Update the URLs you set earlier

Now that you have a live URL, go back and add it in three places:

- Supabase → Authentication → URL Configuration → **Site URL** and
  **Redirect URLs**
- Google Cloud → Credentials → your OAuth client → **Authorised JavaScript
  origins**
- Vercel → `NEXT_PUBLIC_SITE_URL`

### 5e. Custom domain (optional)

Vercel → **Settings → Domains → Add**. If you buy `bamstudio.com.au` from an
Australian registrar (VentraIP, Crazy Domains — a `.com.au` needs your ABN),
Vercel shows the exact DNS records to paste in. HTTPS is automatic.

---

## Step 6 — Going live

Do these in order on launch day:

1. **Fill in "My price"** in the workbook for every product, then run
   `node scripts/generate-seed.mjs` and re-run `supabase/seed.sql`.
   Until then the shop uses placeholder prices.
2. **Have a lawyer read the legal pages** at `/legal/privacy`, `/legal/terms`
   and `/legal/refunds`. They are drafts, and one clause in particular needs a
   professional eye: the **contract-formation sentence** in
   `app/legal/terms/page.tsx` under *Ordering*. It used to say a contract forms
   "when we send you an order confirmation email" — while the shop sent no
   email at all, which by its own words meant no contract ever formed. It now
   says the contract forms when your payment succeeds and the order is recorded
   under its order number. That is what the software actually does, but whether
   it is the wording you want is a legal question, not a technical one, and it
   is the most load-bearing sentence on the site.
3. **Set the real shop details** in Vercel: `NEXT_PUBLIC_SUPPORT_EMAIL`,
   `NEXT_PUBLIC_ABN` (once it clears), and the social URLs. These are not
   cosmetic — pages check whether a mailbox or a handle exists before they
   offer it, so until one is set the shop tells customers there is currently no
   way to reach you.
   Leave `NEXT_PUBLIC_GST_REGISTERED` as `false` — the shop deliberately shows
   no GST component while you're under the $75,000 threshold, because
   displaying GST you don't collect misrepresents the price. Set it to `true`
   only on the day you register.
4. **Turn email on**, if you skipped Step 3 — `RESEND_API_KEY` and
   `EMAIL_FROM` together in Vercel, then redeploy. Those two are the whole
   switch; there is no separate flag, and if an old `NEXT_PUBLIC_EMAIL_ENABLED`
   is still sitting in the Vercel variable list, delete it. Then send yourself
   a contact-form message from the live site to confirm — that one also needs
   `NEXT_PUBLIC_SUPPORT_EMAIL` from step 3 above.
5. **Switch Stripe to live mode**: flip the dashboard toggle, copy the live
   `sk_live_`/`pk_live_` keys into Vercel, create a *new* live-mode webhook
   endpoint, and update `STRIPE_WEBHOOK_SECRET`. Test mode and live mode have
   completely separate keys and webhooks.
6. **Place one real order yourself** with a real card and refund it, to prove
   the whole path works. Check the order row lands in Supabase with a real
   `order_number` and its line items — if `next_order_number()` cannot run, the
   webhook fails and no order is recorded, so this test is not optional.
7. **Turn on the payment methods you advertise.** The footer and basket list
   `PAYMENT_BADGES` from `lib/config.ts` (cards only by default). If you enable
   PayPal, Apple Pay or Afterpay in the Stripe dashboard, add them there —
   and don't list one you haven't enabled.

---

## What only you can supply

Nothing here is a bug and nothing here blocks the site from running — the shop
is written to stay truthful while these are missing rather than to print a
placeholder or make a promise it can't keep. But each one is a real-world
detail no one else can invent, and the shop is quieter, vaguer or less useful
until you fill it in.

### Real-world details the shop is currently working around

| What | Where it goes | What happens until then |
|---|---|---|
| **Registered business name** | `/legal/terms`, `/legal/privacy`, `/legal/refunds` | The terms say "a sole trader based in Sydney, Australia, trading as Bam Studio" — true, but a customer cannot see who they contracted with |
| **Business postal address** | `/legal/terms` contact section, `/legal/privacy` | Omitted entirely. Australian Consumer Law expects a customer to be able to find you |
| **Return address** | Given in your reply to a return request; `/legal/refunds` explains this | Refunds policy deliberately does **not** publish one and tells customers to wait for your reply. Fine as a policy, but you must actually have an address ready when the first return comes |
| **Support mailbox** — `NEXT_PUBLIC_SUPPORT_EMAIL` | Footer, contact page, legal pages, order pages, account settings | **The largest single gap.** Without it the shop has no mailbox to name, so it tells customers there is currently no way to reach it, contact-form enquiries have nowhere to go, and returns and faults have no starting point |
| **ABN** — `NEXT_PUBLIC_ABN` | Footer, legal pages, and Stripe's own verification | Hidden wherever it would appear. Stripe will not release money without it |
| **Hosting provider's name** | `/legal/privacy`, "who we share information with" | Listed generically as "the provider that serves these pages". Accurate, but naming Vercel is clearer and is what a privacy policy is expected to do |
| **Social handles** (optional) — `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_TIKTOK_URL` | Footer, contact, about, and every "message us" fallback | No links shown. They also act as a second channel: with a handle set, pages can still offer a way to reach you even before the mailbox exists |
| **Email keys** — `RESEND_API_KEY`, `EMAIL_FROM` (both, or neither) | Step 3 | No email of any kind is sent, and no page claims one is coming. Customers still get their order number on screen and can still track an order — that path deliberately does not depend on email |
| **Market dates** | About page | `[MARKET NAME AND DATE]` placeholder — the one bracketed placeholder left in the site |

### Business and account items

| What | Why | Where it shows up |
|---|---|---|
| **Business bank account** | Stripe pays out to it | Stripe payouts; the separate account you haven't opened yet |
| **Photo ID** | Stripe identity verification | Stripe onboarding, before live mode |
| **Real prices** | "My price" is empty in the workbook | Placeholder prices from `PRICE_BY_CATEGORY`. Fill the column, re-run `node scripts/generate-seed.mjs`, re-run `supabase/seed.sql` |
| **Product photography** | You don't have photos yet | The shop uses illustrated artwork; swap `components/ProductArt.tsx` usage for `next/image` when you have shots |
| **Ready-to-ship stock counts** | Nothing is printed ahead | `stock_on_hand` is 0 everywhere, so everything reads "printed to order". Set real counts once you print ahead |
| **Ratings and reviews** | Nothing has sold online yet | Every product ships with 0 reviews and no rating. They appear only as real customers write them — **nothing is invented**, deliberately: the ACCC treats fabricated reviews as misleading conduct |

### Legal review — please do not skip this one

The three pages under `/legal/` are drafts written to be honest about what the
software does. They have **not** been read by a lawyer, and one clause needs
that more than the rest:

> **The contract-formation sentence** in `app/legal/terms/page.tsx`, under
> *Ordering*. It used to say a contract forms "when we send you an order
> confirmation email" — while the shop sent no email at all, so by its own
> terms no contract ever formed with anyone. It now says the contract forms
> when your payment succeeds and the order is recorded under its order number,
> which is what the code genuinely does. Whether that is the wording you want
> is a legal question.

Also worth a professional eye: the refunds policy's treatment of personalised
items as non-returnable except when faulty, and the privacy policy's list of
who your customers' data is shared with.

## Troubleshooting

**Products don't load / the shop shows the same few items**
Supabase env vars are missing or wrong, so the fallback catalogue is showing.
Check `NEXT_PUBLIC_SUPABASE_URL` and restart the dev server.

**Google sign-in returns "redirect_uri_mismatch"**
The URI in Google Cloud must exactly match the one Supabase shows, including
`https://` and no trailing slash.

**Paid an order but nothing appears in `orders`**
The webhook isn't reaching you. Locally, `stripe listen` must be running. In
production, check Stripe → Webhooks → your endpoint → recent deliveries for
the error. A 400 means `STRIPE_WEBHOOK_SECRET` doesn't match.

**"Payments are not configured yet" at checkout**
`STRIPE_SECRET_KEY` is missing in that environment.

**The shop says there is "no way to reach us" / no contact address**
`NEXT_PUBLIC_SUPPORT_EMAIL` is unset and no social handle is set either. The
pages check before they offer a channel, on purpose — they will not print an
address that does not exist. Set one and redeploy.

**The contact form says it could not send my message**
Email is not configured, or there is no support mailbox to send to. Both are
needed: `RESEND_API_KEY` + `EMAIL_FROM` (so it *can* send) and
`NEXT_PUBLIC_SUPPORT_EMAIL` (so there is somewhere to send to). The server log
names the reason; `not_configured` means one of those is missing or the server
was not restarted after you set it.

**Pages promise a confirmation email but none arrives**
The shop no longer has a way to promise mail it cannot send — the sentence and
the sender read the same two variables — so this is a *delivery* problem, not a
configuration one. Check Resend → Emails for the attempt, and check that
`EMAIL_FROM`'s domain is verified; an unverified sending domain is the usual
cause of a mail that was accepted and then never arrived. The server log
records the failure reason (`provider_error` with a status, `timeout`,
`network_error`) without the recipient's address.

**I set `NEXT_PUBLIC_EMAIL_ENABLED` and nothing changed**
That variable was removed. Nothing reads it. Delete it from `.env.local` and
from Vercel — `RESEND_API_KEY` + `EMAIL_FROM` is the whole switch, and
`NEXT_PUBLIC_SUPPORT_EMAIL` is what the forms need on top.

**An order was paid but I cancelled it first — where did the money go**
It is still with you, and **you have to refund it by hand in Stripe.** If a
payment lands (or finally settles) on an order whose status has already been
set to `cancelled`, the shop deliberately does nothing to it: it is not
numbered, its stock is not moved, and no confirmation is emailed, because
undoing a cancellation someone made on purpose is worse than the alternative.
The webhook logs an error naming the order and the Stripe session so you can
find both. Every other status — `printing`, `packed`, `shipped`, `delivered` —
is still repaired normally by a late delivery.

**Build fails on Vercel but works locally**
Almost always a missing environment variable. Compare Vercel's list against
`.env.example`.
