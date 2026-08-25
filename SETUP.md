# Setup & deployment — what you need to do

Everything below is a task only you can do, because it needs accounts in your
name. Work top to bottom; each step says exactly where to click and what to
paste. Steps 1–4 build up your `.env.local`, which is what runs the shop on your
own computer. Step 5 deploys it, and the deployed shop gets its settings a
different way — the box below explains how, and it is the one thing here worth
reading twice.

Budget about 90 minutes for the first pass, plus a little longer for Step 5
now that the shop is deployed with Docker on Fly.io rather than on Vercel.

**What it costs.** Supabase, Resend, the Australia Post postage API and GitHub
Actions all have free tiers that comfortably cover a new shop, and Stripe only charges per sale (1.75% + $0.30
for Australian cards, plus GST on the fee). **Hosting is not free**: one 512 MB
Fly.io machine in Sydney is roughly **A$6 a month**. That is the deliberate
trade — see the box below.

> **Why not Vercel any more.** Vercel's Hobby plan forbids commercial use, and
> its own example of commercial usage is "any method of requesting or processing
> payment from visitors of the site" — which is precisely what this shop is for.
> The compliant option there is Pro at US$20 per developer per month. Fly.io in
> the `syd` region on a 512 MB machine is about A$6 a month, is the only managed
> option with a **Sydney** region, and keeps a **long-lived Node process**, which
> this app needs: the order-confirmation email is sent after the response has
> already gone back to Stripe, and the rate limiter that protects customer
> addresses lives in that process's memory.

### Where each setting ends up once you deploy

Read this once now; Step 5 depends on it and it is the single thing people get
wrong.

`.env.local` is for **running the shop on your own computer**. The deployed
shop never reads it — never reads any `.env` file at all. Configuration reaches
the live container as real environment variables, by two different routes:

| Kind | How it gets there | To change it |
|---|---|---|
| **Build args** — every `NEXT_PUBLIC_*` value | Baked into the code when the image is built | **Rebuild and redeploy.** A restart does nothing |
| **Fly secrets** — everything else | `fly secrets set NAME=value`, read at request time | Set it and restart. No rebuild |

**Never put a secret in a build arg.** Build args are written into the image's
history, so anyone who can pull the image can read them back.

The full table of which variable is which is in Step 5c, and `.env.example`
labels every line — with one exception: **`AUSPOST_API_KEY` is not in
`.env.example` yet**, so add that line to `.env.local` by hand (Step 3b).

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

> **Your database is still empty — none of this has been run yet.** There are
> now **two** migration files and they go in order.

1. In Supabase, open **SQL Editor → New query**.
2. Open `supabase/migrations/0001_init.sql` from this project, copy the whole
   file, paste it in, and click **Run**. It should say "Success".
3. New query again. Copy all of **`supabase/migrations/0002_shipping.sql`**,
   paste, **Run**. This adds the weight and size columns postage is priced
   from, the postage rate cache, and three columns on `orders` that record how
   a postage price was arrived at. Like the first file it is safe to re-run.
4. New query again. Copy all of `supabase/seed.sql`, paste, **Run**. This
   loads your 44 products and 6 colourway collections. No reviews —
   those only ever come from real customers.
5. Check **Table Editor → products** — you should see the catalogue, and each
   row now has `weight_grams`, `length_mm`, `width_mm`, `thickness_mm` and
   `letter_eligible`. Hover a column name to see what it is for. **Those
   numbers are estimates** — see "What only you can supply" for the three
   weighings that would replace the guesswork.
6. New query once more. Copy all of `supabase/verify.sql`, paste, **Run**.
   Every row must say `t`. It checks the things that otherwise fail silently
   in production — most importantly that the webhook is allowed to allocate
   order numbers and move stock. Without those grants, customers can pay and
   no order is ever recorded. The script writes two throwaway rows and rolls
   them back, so it is safe to re-run any time.

> The schema is `supabase/migrations/0001_init.sql` plus
> `supabase/migrations/0002_shipping.sql`, in that order. Both are safe to
> re-run: if you applied an earlier version, run it
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
  https://bamstudio-shop.fly.dev/auth/callback
  https://YOUR-DOMAIN.com/auth/callback
  ```
  The `fly.dev` one is the address your first deploy gets for free. Add the
  real domain line as well once you have bought one (Step 5f).

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
| Secret key (`sk_test_…`) | `STRIPE_SECRET_KEY` |

That is the only one. **You do not need the publishable key.** Checkout here is
redirect-based — the server creates a Stripe Checkout Session and sends the
customer to Stripe's own hosted payment page — so nothing in the browser ever
uses `pk_…`. `.env.example` used to list a `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
that no code in this project has ever read; it has been removed, so if you set
one from an earlier version you can delete it.

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

**Nothing is set up yet, and the plan is two free pieces:** Resend for
**sending** (3,000 emails a month, custom domains included on the free tier),
and **Porkbun's free email forwarding** for **receiving** — so a message to
`hello@bamstudioshop.com` lands in a mailbox you already read. Sending and
receiving really are two different services; Resend does not receive.

> ⚠️ **`EMAIL_FROM` cannot be a gmail.com address.** It has to be an address on
> a domain you have verified in Resend — `hello@bamstudioshop.com`, not
> `something@gmail.com`. Mail claiming to be from Gmail but sent by Resend fails
> Gmail's own checks and is rejected or binned. Forwarding *to* your Gmail is
> fine; sending *as* Gmail is not.

> ⚠️ **Delete Porkbun's `*` parking CNAME first** (Step 5f). A wildcard answers
> for every name you have not set explicitly, so it interferes with the mail
> records both Resend and the forwarding depend on.

1. Go to **<https://resend.com>** and sign up. The free tier is 3,000 emails a
   month, which is far more than a new shop sends.
2. **Domains → Add Domain**, enter `bamstudioshop.com`, and add the DNS records
   it shows you **at Porkbun**. Verification usually takes a few minutes.
3. **API Keys → Create API Key**. Copy it — it is shown once.

> You can test with Resend's shared sending domain, but order confirmations
> from an address you don't own land in spam folders. Verify your own domain
> before you take real orders.

### 3b. Set the two secrets — both, or neither

| Variable | Value |
|---|---|
| `RESEND_API_KEY` | The key from 3a. A secret — never `NEXT_PUBLIC_` |
| `EMAIL_FROM` | e.g. `Bam Studio <hello@yourdomain.com.au>`, on the verified domain |

Both go in `.env.local` for now. When you deploy, both are **Fly secrets**
(Step 5c) — so you can turn email on later without rebuilding anything.

> **Set both at once, or leave both unset.** There is nothing else to switch
> on. The shop works out for itself whether it can send — one check,
> `RESEND_API_KEY` and `EMAIL_FROM` both present — and every sentence on the
> site that mentions email is written from that same check. It cannot promise
> a mail it will not send, and it cannot deny sending one it does send.
>
> There **used** to be a third variable, `NEXT_PUBLIC_EMAIL_ENABLED`, that you
> had to keep in step with these two by hand. **It has been removed. Do not set
> it — nothing reads it.** If you have it in a `.env.local`, in a Fly secret or
> in an old hosting dashboard, delete it. Keeping one switch for what the shop *says*
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

## Step 3b — Australia Post postage key (free, five minutes, optional)

The shop is being moved off a flat $9.50 postage charge onto **real Australia
Post prices**, worked out from the weight of what is in the basket. The code
that does the pricing is written; it is not connected to checkout yet, so
nothing on the site changes the day you do this. Doing it now means the key is
already in place when it is.

1. Go to **<https://developers.auspost.com.au>** and register. It is free,
   self-serve and the key is issued immediately — there is no account manager
   and no contract.
2. Add it to `.env.local` on your own computer, as its own line:

   ```
   AUSPOST_API_KEY=your-key-here
   ```

   (`.env.example` does not list it yet. Add the line by hand.)
3. On the live shop it is a **Fly secret**, not a build arg — see Step 5c:

   ```bash
   fly secrets set AUSPOST_API_KEY='...' -a bamstudio-shop
   ```

**Without the key nothing breaks.** Postage falls back to a table of real
Australia Post rates that were read from the live service on 25 August 2026,
deliberately rounded up one price band. The shop keeps working and quotes
slightly dear rather than slightly cheap.

**What you should know about the two postage tiers**, because one of them is a
decision only you can make:

- **Parcel** — about **$10.20**, tracked, and the customer can watch it move.
- **Large Letter** — **$3.40** for anything under 125 g that fits 260 × 360 mm
  and is under 20 mm thick, but **untracked and uninsured**. If it goes missing
  there is nothing to look up and nothing to claim.

Right now **every product is set to go as a parcel**, which costs a little more
and never costs you a shortfall. Switching a product to Large Letter is a
checkbox on its row in the Supabase table editor — but it must not be done on
its own, because the site currently says "tracked" for every delivery method.
See "What only you can supply" below.

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

## Step 5 — Deploy to Fly.io

The shop runs as a Docker container on one Fly.io machine in Sydney (`syd`),
512 MB, always on. Everything below is already described by three files that are
committed in the repo, so there is very little to configure by hand:
`Dockerfile` (how the image is built), `fly.toml` (the app, the region, the
machine, the health check) and `.github/workflows/deploy.yml` (the automatic
deploy).

**Your first deploy will live at `https://bamstudio-shop.fly.dev`.** You do not
have a domain yet, and that is fine — Step 5f is how you move to a real one when
you do.

### 5a. Put the code on GitHub — already done

The repository exists: **<https://github.com/nellyy2505/bamstudio-shop>**,
branch **`master`**, which is the branch the deploy workflow watches. It is
**public**, so treat everything in it as readable by anyone — that is fine for
the code, and it is why no key of any kind lives in a file here.

For future commits:

```bash
cd bamstudio-shop
git status                      # look at this before every commit
git add <the files you changed> # NOT `git add -A` — see the warning below
git commit -m "what changed"
git push
```

> ⚠️ **Do not use `git add -A` in this project.** About ten files always show as
> modified because of invisible Windows line-ending differences, not because
> anything changed in them. `git add -A` sweeps all of that into your commit and
> makes it impossible to see what you actually did. Add files by name.

> `.env.local` is git-ignored, so your keys stay off GitHub. Check `git status`
> before pushing anyway.

### 5b. Create the Fly app

1. Install flyctl: <https://fly.io/docs/flyctl/install/>, then `fly auth signup`
   (or `fly auth login`). You will be asked for a card — Fly needs one even on
   small plans.
2. From inside the project folder:
   ```bash
   fly apps create bamstudio-shop
   ```
   **Do not run `fly launch`.** It would offer to write its own `fly.toml` and
   `Dockerfile` over the ones in this repo, which carry decisions you want kept
   (see 5g). `fly apps create` just registers the name.

   The name has to be globally unique on Fly. If `bamstudio-shop` is taken,
   pick another, and then change `app = "bamstudio-shop"` at the top of
   `fly.toml` to match — that file is the only place the name lives.

### 5c. Set the runtime secrets on Fly

These five are read fresh on every request, so they are **Fly secrets**, not
build args. Never pass one as a build arg: build args are recorded in the
image's history and can be read back by anyone who can pull the image.

```bash
fly secrets set -a bamstudio-shop \
  SUPABASE_SERVICE_ROLE_KEY='...' \
  STRIPE_SECRET_KEY='sk_test_...' \
  STRIPE_WEBHOOK_SECRET='whsec_...' \
  RESEND_API_KEY='re_...' \
  EMAIL_FROM='Bam Studio <hello@yourdomain.com>' \
  AUSPOST_API_KEY='...'
```

(Leave `RESEND_API_KEY` and `EMAIL_FROM` out entirely if you have not done Step
3 yet — both or neither, never one. You can add them later with the same
command and it only needs a restart. `AUSPOST_API_KEY` is the same: leave it
out and postage quotes from the built-in fallback rates.)

**The whole split, in one table.** This is the thing to get right:

| Variable | Kind | Where you set it | To change it |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Build arg | GitHub **Variable** (pinned in `fly.toml` as a fallback) | Rebuild + redeploy |
| `NEXT_PUBLIC_SUPABASE_URL` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build arg | GitHub **Secret** | Rebuild + redeploy |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `NEXT_PUBLIC_ABN` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `NEXT_PUBLIC_GST_REGISTERED` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `NEXT_PUBLIC_INSTAGRAM_URL` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `NEXT_PUBLIC_TIKTOK_URL` | Build arg | GitHub **Variable** | Rebuild + redeploy |
| `SUPABASE_SERVICE_ROLE_KEY` | **Fly secret** | `fly secrets set` | Restart only |
| `STRIPE_SECRET_KEY` | **Fly secret** | `fly secrets set` | Restart only |
| `STRIPE_WEBHOOK_SECRET` | **Fly secret** | `fly secrets set` | Restart only |
| `RESEND_API_KEY` | **Fly secret** | `fly secrets set` | Restart only |
| `EMAIL_FROM` | **Fly secret** | `fly secrets set` | Restart only |
| `AUSPOST_API_KEY` | **Fly secret** | `fly secrets set` | Restart only |

Two things that surprise people:

- **`NEXT_PUBLIC_SUPABASE_ANON_KEY` is a build arg but goes in GitHub
  *Secrets*.** It is a public value — the browser receives it either way — but
  it looks like a key, and GitHub masks Secrets in build logs. "Anything that
  looks like a key goes in Secrets" is an easier rule to follow than a
  case-by-case judgement.
- **A Fly secret named `NEXT_PUBLIC_ANYTHING` does nothing.** Those values were
  written into the JavaScript when the image was built. Setting one at runtime
  changes nothing a customer sees; only a rebuild does.

### 5d. Add the GitHub settings, and let it deploy itself

Deployment is automatic: **every push to `master` deploys**, and you can also
run it by hand from the repo's **Actions** tab (the workflow has a
`workflow_dispatch` trigger). Nothing is built on the GitHub runner — the
workflow runs `flyctl deploy --remote-only`, which hands the code to Fly's own
remote builder.

In your repo, go to **Settings → Secrets and variables → Actions** and add:

**Secrets tab**

| Name | Value |
|---|---|
| `FLY_API_TOKEN` | Run `fly tokens create deploy -a bamstudio-shop` and paste the output |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys |

**Variables tab**

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://bamstudio-shop.fly.dev` (or the real domain later) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Optional — but needed for the contact form to reach you |
| `NEXT_PUBLIC_ABN` | Optional — shown in the footer |
| `NEXT_PUBLIC_GST_REGISTERED` | Optional — `"true"` only once you actually register |
| `NEXT_PUBLIC_INSTAGRAM_URL` | Optional |
| `NEXT_PUBLIC_TIKTOK_URL` | Optional |

Only the first four (both Secrets, plus `NEXT_PUBLIC_SITE_URL` and
`NEXT_PUBLIC_SUPABASE_URL`) are required. The workflow checks them **by name**
before it builds anything and stops with a message naming whichever is missing,
rather than letting you find out thirty screens into a build log. The optional
ones each print a one-line note when blank.

Then push to `master` (or hit **Run workflow**). The first build takes a few
minutes; watch it in the Actions tab. When it finishes:

```bash
fly status -a bamstudio-shop      # one machine, in syd, started
fly logs -a bamstudio-shop        # what the server is saying
curl https://bamstudio-shop.fly.dev/api/health   # {"ok":true}
```

`/api/health` is a deliberately empty liveness endpoint — it touches no
database, no Stripe and no network — and Fly polls it every 15 seconds to
decide whether the machine is alive and whether a new deploy is allowed to take
over from the old one.

> **Deploying by hand instead.** You can run the same deploy from your own
> machine, but you must pass every build arg yourself, because they are not read
> from `.env.local`:
> ```bash
> fly deploy --remote-only \
>   --build-arg NEXT_PUBLIC_SITE_URL=https://bamstudio-shop.fly.dev \
>   --build-arg NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
>   --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
>   --build-arg NEXT_PUBLIC_SUPPORT_EMAIL=... \
>   --build-arg NEXT_PUBLIC_ABN=... \
>   --build-arg NEXT_PUBLIC_GST_REGISTERED=false \
>   --build-arg NEXT_PUBLIC_INSTAGRAM_URL=... \
>   --build-arg NEXT_PUBLIC_TIKTOK_URL=...
> ```
> Omit one and the shop builds successfully while pointing at nothing — for
> example, with no Supabase values it comes up serving the built-in sample
> catalogue and looking perfectly healthy. `NEXT_PUBLIC_SITE_URL` is the one
> exception: `fly.toml` pins it to the `fly.dev` address so a bare `fly deploy`
> cannot fail on it, and the build hard-stops if it is ever empty.
>
> `--remote-only` is not optional in spirit: `next build` peaks at about 1.6 GB
> of memory and cannot run on the 512 MB machine. Fly's remote builder does the
> build; the machine only ever runs the finished server, at about 150 MB.

### 5e. Point the webhook at production

1. Stripe → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://bamstudio-shop.fly.dev/api/webhooks/stripe`
   (or your real domain once you have one).
3. **Events to send** — select exactly these four:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
4. Add endpoint, then reveal the **Signing secret** (`whsec_…`).
5. Set it on Fly and restart:
   ```bash
   fly secrets set STRIPE_WEBHOOK_SECRET='whsec_...' -a bamstudio-shop
   ```
   Setting a secret restarts the machine by itself. **No rebuild is needed** —
   this one is read at request time.

### 5f. Your domain — registered, and one DNS record to delete first

**`bamstudioshop.com` is registered, at Porkbun.** Two things remain:

1. ⚠️ **Delete Porkbun's parking wildcard before anything else.** The domain
   still has a `*` CNAME pointing at `uixie.porkbun.com`, which is Porkbun's
   "for sale / parked" page. A wildcard answers for *every* name you have not
   set explicitly, so it **shadows your email records** — mail routing and
   verification records for Resend and for Porkbun's own forwarding will behave
   unpredictably while it exists. Porkbun → your domain → **DNS**, delete the
   `*` record. Do this before you set up email or attach the domain to Fly.
2. **Add the matching `.com.au` once your ABN has been *issued*.** auDA requires
   an **issued** ABN — a pending application does not qualify — so this one has
   to wait, and there is no way to hurry it. Australian registrars: VentraIP,
   Crazy Domains, Netregistry.

**Moving the shop to that domain is five jobs, and the first one is the one
people miss:**

1. **Change the `NEXT_PUBLIC_SITE_URL` GitHub Variable and redeploy.** This is a
   **rebuild**, not a setting you can flip. That value is baked into the code
   when the image is built — Stripe's success and cancel redirects, the `/track`
   link in confirmation emails and every canonical URL are built from it. There
   is no restart, no Fly secret and no dashboard toggle that changes it. Update
   the Variable, then push or run the workflow. Update the pinned value in
   `fly.toml` in the same commit so a manual `fly deploy` agrees with CI.
2. **Attach the domain to Fly:**
   ```bash
   fly certs add shop.yourdomain.com -a bamstudio-shop
   fly certs show shop.yourdomain.com -a bamstudio-shop   # tells you the DNS records
   ```
   Add the records it names at your registrar. The certificate issues by itself
   once DNS resolves.
3. **Update Stripe's webhook endpoint** to the new URL (Developers → Webhooks →
   your endpoint → edit). The signing secret does not change.
4. **Update Supabase**: Authentication → URL Configuration → **Site URL**, and
   add the new `/auth/callback` to the **Redirect URLs** allow-list. Also add
   the new origin to Google Cloud → Credentials → your OAuth client →
   **Authorised JavaScript origins**.
5. **Re-verify the sending domain in Resend** and update `EMAIL_FROM` to an
   address on it (`fly secrets set EMAIL_FROM=...`). An unverified sending
   domain is the usual cause of confirmation emails that are accepted and then
   never arrive.

### 5g. Two settings in `fly.toml` that must not be "optimised"

If someone later suggests saving money by letting the machine sleep, this is
why the answer is no. `fly.toml` sets `auto_stop_machines = "off"`,
`auto_start_machines = false` and `min_machines_running = 1`. **That is a
correctness setting, not a cost preference**, because two things this shop needs
live only in the running process's memory:

- **The order-confirmation email.** The Stripe webhook returns its `200` first
  and *then* sends the email, so at any moment there can be a send in flight
  that Fly's proxy cannot see — it counts inbound connections, not work
  happening inside the machine. A machine that stops mid-send charges a customer
  and never tells them.
- **The rate limiter.** `lib/rate-limit.ts` keeps its counters in memory, and it
  is the only thing standing in front of `/api/track`, which hands back a
  customer's postal address to anyone with an order number and the matching
  email. A machine that stops resets every counter, so someone who can provoke
  an idle stop gets their full guessing budget back, over and over.

"Suspend" is not a safer middle ground: it preserves memory but resumes with
sockets the outside world has already given up on, which breaks exactly the
in-flight email above.

The 512 MB size is also measured rather than guessed — the running server sits
around 150 MB. It is deliberately **not** big enough to build in, which is why
builds go to Fly's remote builder.

---

## Step 6 — Going live

Do these in order on launch day:

0. **Rotate the Supabase JWT secret** if you have not already — see the box at
   the top of "What only you can supply". The exposed anon key still works,
   which means the leaked `service_role` key very likely does too, and that key
   can read every customer's address. Nothing else on this list matters as much.
0b. **Check the database has both migrations applied** —
   `0001_init.sql` *and* `0002_shipping.sql`, then `seed.sql`, then
   `verify.sql` with every row printing `t` (Step 1c). The project is empty
   until you do.
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
3. **Set the real shop details** as GitHub **Variables**, then redeploy:
   `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_ABN` (once it is issued), and the
   social URLs. These are not cosmetic — pages check whether a mailbox or a
   handle exists before they offer it, so until one is set the shop tells
   customers there is currently no way to reach you. **All of these are build
   args, so each change needs a redeploy, not a restart.**
   Leave `NEXT_PUBLIC_GST_REGISTERED` as `false` — the shop deliberately shows
   no GST component while you're under the $75,000 threshold, because
   displaying GST you don't collect misrepresents the price. Set it to `true`
   only on the day you register.
4. **Name Fly.io as the hosting provider** on `/legal/privacy`. The page lists
   who customer data is shared with — Stripe, Supabase, Resend — and currently
   describes hosting generically as "the provider that serves these pages".
   That is now Fly.io, and a privacy policy is expected to name it. Edit
   `app/legal/privacy/page.tsx`.
5. **Turn email on**, if you skipped Step 3 — `RESEND_API_KEY` and
   `EMAIL_FROM` together as **Fly secrets**:
   ```bash
   fly secrets set RESEND_API_KEY='re_...' EMAIL_FROM='Bam Studio <hello@...>' -a bamstudio-shop
   ```
   That restarts the machine by itself; **no redeploy needed**, because these
   two are read at request time. Those two are the whole switch; there is no
   separate flag, and if an old `NEXT_PUBLIC_EMAIL_ENABLED` is still set
   anywhere, delete it. Then send yourself a contact-form message from the live
   site to confirm — that one also needs `NEXT_PUBLIC_SUPPORT_EMAIL` from step 3
   above, which *is* a rebuild.
5b. **Set `AUSPOST_API_KEY`** if you have it (Step 3b), and **delete Porkbun's
   `*` parking CNAME** before you set up email or attach the domain (Step 5f).
   Neither blocks a launch; both cause confusing failures later if skipped.
6. **Switch Stripe to live mode**: flip the dashboard toggle, set the live
   `sk_live_` key with `fly secrets set STRIPE_SECRET_KEY=...`, create a *new*
   live-mode webhook endpoint pointing at your live URL, and set its
   `STRIPE_WEBHOOK_SECRET` the same way. Test mode and live mode have
   completely separate keys and webhooks. Both are secrets, so this is a
   restart, not a rebuild.
7. **Place one real order yourself** with a real card and refund it, to prove
   the whole path works. Check the order row lands in Supabase with a real
   `order_number` and its line items — if `next_order_number()` cannot run, the
   webhook fails and no order is recorded, so this test is not optional. This is
   also the first time anything here has been proved end to end against real
   Stripe and real Resend accounts, so watch for the confirmation email actually
   arriving.
8. **Turn on the payment methods you advertise.** The footer and basket list
   `PAYMENT_BADGES` from `lib/config.ts` (cards only by default). If you enable
   PayPal, Apple Pay or Afterpay in the Stripe dashboard, add them there —
   and don't list one you haven't enabled.

---

## What only you can supply

### Do this first — an outstanding security job

> **Rotate your Supabase JWT secret.**
>
> A Supabase anon key and a `service_role` key of yours were exposed in a chat.
> The check that matters is simple: **the exposed anon key still works.** Keys
> are signed with the project's JWT secret, and rotating that secret is what
> makes every old key stop working — so if the old anon key still authenticates,
> the secret has not been rotated, and the `service_role` key that leaked
> alongside it is very likely still live.
>
> That one matters. `service_role` ignores every access rule in the database: it
> can read every order, every customer address and every profile, and change or
> delete any of it.
>
> In the Supabase dashboard, rotate the JWT secret, then update the new keys in
> **all three** places in one sitting — rotating without updating takes the shop
> offline:
>
> 1. `.env.local` on your computer (`NEXT_PUBLIC_SUPABASE_ANON_KEY` and
>    `SUPABASE_SERVICE_ROLE_KEY`);
> 2. GitHub → Settings → Secrets and variables → Actions → **Secrets** →
>    `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then **re-run the deploy** — that one is a
>    build arg, so a restart will not pick it up;
> 3. `fly secrets set SUPABASE_SERVICE_ROLE_KEY='...' -a bamstudio-shop`.
>
> Your Stripe live key was exposed the same way and **you have already rolled
> it** — nothing further is needed there. Test keys are what the shop is using
> today.

### The most useful ten minutes you can spend on postage

> **Weigh three items and write down the real numbers.**
>
> One **name charm**, one **clicker keychain**, one **pet bowl** — each one
> **inside the mailer you actually post it in** — and for each, two numbers:
>
> - its **weight in grams** (a kitchen scale is fine);
> - its **thickness in millimetres** at the thickest point (a ruler is fine).
>
> Every weight and size the shop currently uses to price postage is an
> **educated guess**. They were chosen to err on the expensive side, so you are
> never out of pocket — but they are guesses, and these three readings would
> replace the single largest source of error in the whole postage calculation.
> Australia Post prices a parcel on weight alone, and the 125 g / 20 mm line is
> what separates a **$3.40** letter from a **$10.20** parcel, so a few grams
> either way is real money on every small order.
>
> Send the six numbers to whoever is next working on the code. They go into
> `lib/shipping/dimensions.ts` and into each product's row in Supabase.

### A decision only you can make — tracked, or cheap

Small orders can go two ways, and the shop is currently taking the safe one.

| | **Parcel** (what happens today) | **Large Letter** |
|---|---|---|
| Price | about **$10.20** | **$3.40** |
| Tracking | Yes — the customer can follow it | **None** |
| Insurance | Yes | **None** |
| Fits | Anything | Under 125 g, 260 × 360 mm, under 20 mm thick |

Every product is set to "parcel" right now, so nothing is ever underpriced. If
you want small charm orders to go as letters, that is a checkbox per product
(`letter_eligible`) on its row in Supabase — **but do not tick it and leave it
there**. The site currently tells customers every delivery method is "tracked",
which stops being true the moment a letter goes out. Tell whoever is working on
the code, so the wording and the checkbox change together. It is written up in
`WORKLOG.md` §6 as a pending decision.

The trade is: a lost parcel can be traced and claimed; a lost letter is gone,
and you would be reprinting and reposting it at your own cost. On a $9 charm,
$3.40 versus $10.20 is the difference between postage being an afterthought and
postage costing more than the item.

---

Nothing in the rest of this section is a bug and none of it blocks the site from running — the shop
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
| **Hosting provider's name — it is now Fly.io** | `/legal/privacy`, "who we share information with" | Listed generically as "the provider that serves these pages". Accurate, but the privacy page names its other processors (Stripe, Supabase, Resend) and is expected to name this one too. **Edit `app/legal/privacy/page.tsx` to say Fly.io.** It used to be Vercel; do not let an old draft say so |
| **The domain, attached** — `bamstudioshop.com` **is registered** (Porkbun) | `NEXT_PUBLIC_SITE_URL`, Stripe's webhook URL, Supabase's Site URL and redirect list, the Resend sending domain | Bought, not yet pointed at anything, and **Porkbun's `*` parking CNAME is still there and must be deleted — it shadows email records**. The shop will first go live at `https://bamstudio-shop.fly.dev`. The `.com.au` needs an **issued** ABN (a pending application does not qualify). Step 5f is the move, and its first job is a **rebuild**, not a setting change |
| **Australia Post key** — `AUSPOST_API_KEY` | Postage pricing | Free and instant from developers.auspost.com.au (Step 3b). Without it postage is quoted from built-in rates read on 25 August 2026, rounded up one band — the shop works and charges slightly dear |
| **Three real weights** — one charm, one clicker, one bowl, each in its mailer | `lib/shipping/dimensions.ts`, and each product's row in Supabase | Every weight and size is an estimate today, erring expensive. See the box above — this is the highest-value thing on this page |
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
from your Fly secrets — `RESEND_API_KEY` + `EMAIL_FROM` is the whole switch, and
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

**I changed a `NEXT_PUBLIC_…` setting and the live site ignored it**
That is expected, and it is the single most common confusion here. Every
`NEXT_PUBLIC_*` value is written into the code when the image is built. Setting
one as a Fly secret, or restarting the machine, changes nothing. Change the
GitHub **Variable** (or the `--build-arg`) and **deploy again**. See the table
in Step 5c.

**The deploy failed with `NEXT_PUBLIC_SITE_URL is empty`**
The build stops on purpose rather than producing an image that would send
customers to the wrong place after paying. Set the `NEXT_PUBLIC_SITE_URL`
Variable in GitHub, or pass `--build-arg NEXT_PUBLIC_SITE_URL=…` to
`fly deploy`.

**The GitHub Action stopped straight away saying something is MISSING**
The workflow checks the required settings by name before it builds. Add
whichever one it named under **Settings → Secrets and variables → Actions**, in
the tab the message tells you, and re-run the workflow.

**Build fails on Fly but works locally**
Almost always a missing build arg. Compare the GitHub Variables and Secrets
against the table in Step 5c and against `.env.example`. Two other causes worth
knowing: the build needs outbound internet (it downloads the Poppins and Nunito
Sans fonts and self-hosts them), and it needs about 1.6 GB of memory — which is
why it runs on Fly's remote builder and never on the app machine.

**The site is up but shows only a handful of products**
The Supabase build args were missing or wrong when the image was built, so the
shop is serving its built-in sample catalogue. It is designed to do that rather
than fail, which is why it looks healthy. Fix
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` and **redeploy**.

**Postage looks like a round number, or higher than I expected**
Postage is quoted from Australia Post's live prices when `AUSPOST_API_KEY` is
set (Step 3b) and from a built-in table of real rates when it is not — and that
table deliberately quotes **one price band up**, so it is never short. Small
orders also all go as tracked parcels today rather than as $3.40 letters; see
the tracked-or-cheap decision in "What only you can supply". (Note that until
the postage work is finished in the code, checkout still charges the old flat
$9.50 / $14.50 regardless.)

**Fly says the machine is unhealthy, or the deploy will not roll over**
Check `fly logs -a bamstudio-shop`, then
`curl https://bamstudio-shop.fly.dev/api/health` — it should return
`{"ok":true}`. That endpoint touches nothing, so if it fails the process itself
is not serving. `fly status -a bamstudio-shop` shows the machine's state.
