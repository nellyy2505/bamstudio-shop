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

> The schema file is safe to re-run. If you applied an earlier version, run it
> again — it adds anything missing rather than starting over, and leaves your
> data alone.

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

## Step 3 — Run it locally

```bash
cd bamstudio-shop
cp .env.example .env.local
# paste in the six values you collected above
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
- [ ] After paying you land on the confirmation page **and** a row appears in
      Supabase → Table Editor → `orders`

If the last one fails, the `stripe listen` terminal will show the error.

---

## Step 4 — Deploy to Vercel

### 4a. Put the code on GitHub

```bash
cd bamstudio-shop
git add -A
git commit -m "Bam Studio shop"
```

Then create an empty repo at <https://github.com/new> (private is fine) and
follow the "push an existing repository" lines it gives you.

> `.env.local` is already git-ignored, so your keys stay off GitHub. Double
> check with `git status` before pushing.

### 4b. Import into Vercel

1. Go to **<https://vercel.com>** → sign up with GitHub.
2. **Add New → Project** → pick the repo → **Import**.
3. Framework Preset detects **Next.js**. Leave the build settings alone.
4. Before clicking Deploy, expand **Environment Variables** and add every key
   from `.env.local` **except** change:
   - `NEXT_PUBLIC_SITE_URL` → your Vercel URL (or custom domain once set)
5. **Deploy**. First build takes 2–3 minutes.

### 4c. Point the webhook at production

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

### 4d. Update the URLs you set earlier

Now that you have a live URL, go back and add it in three places:

- Supabase → Authentication → URL Configuration → **Site URL** and
  **Redirect URLs**
- Google Cloud → Credentials → your OAuth client → **Authorised JavaScript
  origins**
- Vercel → `NEXT_PUBLIC_SITE_URL`

### 4e. Custom domain (optional)

Vercel → **Settings → Domains → Add**. If you buy `bamstudio.com.au` from an
Australian registrar (VentraIP, Crazy Domains — a `.com.au` needs your ABN),
Vercel shows the exact DNS records to paste in. HTTPS is automatic.

---

## Step 5 — Going live

Do these in order on launch day:

1. **Fill in "My price"** in the workbook for every product, then run
   `node scripts/generate-seed.mjs` and re-run `supabase/seed.sql`.
   Until then the shop uses placeholder prices.
2. **Read the legal pages** at `/legal/privacy`, `/legal/terms` and
   `/legal/refunds`. They are drafts with bracketed gaps — fill them in, and
   have someone check them.
3. **Set the real shop details** in Vercel: `NEXT_PUBLIC_SUPPORT_EMAIL`,
   `NEXT_PUBLIC_ABN` (once it clears), and the social URLs.
   Leave `NEXT_PUBLIC_GST_REGISTERED` as `false` — the shop deliberately shows
   no GST component while you're under the $75,000 threshold, because
   displaying GST you don't collect misrepresents the price. Set it to `true`
   only on the day you register.
4. **Wire up transactional email.** Right now the contact form and newsletter
   only log to the server. Sign up for <https://resend.com> (free tier: 3,000
   emails/month), then implement the TODOs in `app/api/contact/route.ts` and
   `app/api/newsletter/route.ts`.
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

## Things I could not do for you

| Item | Why | Where it shows up |
|---|---|---|
| Product photography | You don't have photos yet | The shop uses illustrated artwork; replace `components/ProductArt.tsx` usage with `next/image` when you have shots |
| Ratings and reviews | Nothing has sold online yet | Every product ships with 0 reviews and no star rating — they appear as real customers write them. Nothing is invented |
| Ready-to-ship stock | Nothing is printed ahead | `stock_on_hand` is 0 everywhere, so products read "printed to order". Set real counts once you print stock in advance |
| ABN | Application still in progress | Footer, legal pages, Stripe verification |
| Real prices | "My price" is empty in the workbook | Placeholder prices from `PRICE_BY_CATEGORY` |
| Business bank account | Not opened yet | Stripe payouts |
| Email sending | Needs an account in your name | Contact form + newsletter only log |
| Market dates | Not decided | `[MARKET NAME AND DATE]` placeholder on the About page |
| Legal review | Not advice I can give | The three `/legal/*` drafts |

---

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

**Build fails on Vercel but works locally**
Almost always a missing environment variable. Compare Vercel's list against
`.env.example`.
