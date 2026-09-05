# Setup & deployment — what you need to do

Everything below is a task only you can do, because it needs accounts in your
name. Work top to bottom; each step says exactly where to click and what to
paste. Steps 1–4 build up your `.env.local`, which is what runs the shop on your
own computer. Step 5 deploys it, and the deployed shop gets its settings a
different way — the box below explains how, and it is the one thing here worth
reading twice.

> **Most of this is already done — read it as a reference, not as a list to
> work through.** As at 5 September 2026: Supabase is set up and **all seven
> migrations, `0001` to `0007`, are applied**; the Fly app exists; **the shop is
> deployed and live at `https://bamstudio-shop.fly.dev`**, carrying the work up
> to and including round 18; and the JWT secret has been rotated. **Nothing is
> sitting unpushed on your computer and there is no SQL left for you to paste.**
> Each step below says at its top whether it is done. **The steps still waiting
> on you are gathered under "What only you can supply"**, and the shortest
> version of them is: fill in the catalogue, settle the postage decision, and
> move the shop onto `bamstudioshop.com` — which is Step 5f, and which is worth
> doing now rather than later.

Budget about 90 minutes for a first pass if you are setting this up from
scratch again; far less to check the parts that are already done.

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
labels every line, `AUSPOST_API_KEY` included.

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

> **This step has changed, and it is the change you asked for.** You no longer
> paste SQL into the Supabase editor. The database updates itself when you
> deploy, and the deploy stops if the database did not end up the way the code
> expects.
>
> Steps 1–5 below were done by hand, before that existed. Steps 6 onward are how
> it works from now on.

**What is already in your database, done by hand:**

1. ~~`supabase/migrations/0001_init.sql`~~ Done.
2. ~~`supabase/migrations/0002_shipping.sql`~~ Done — the weight and size columns
   postage is priced from, the postage rate cache, and three columns on `orders`
   that record how a postage price was arrived at.
3. ~~`supabase/migrations/0003_admin.sql`~~ Done — the studio itself: who may get
   behind the shopfront, the colour list, filament stock, the costing settings
   and the accessories.
4. ~~`supabase/seed.sql`~~ Done — your 44 products and 6 colourway collections.
   No reviews; those only ever come from real customers.
5. ~~`supabase/storage.sql`~~ Done — the `product-photos` bucket the Products
   screen uploads into. (Deliberately a separate file from the migrations,
   because it needs Supabase's Storage feature and cannot be tested anywhere
   else. It is **not** part of the automatic system below; it is a one-off and
   it has been done.)

> ✅ **`0004`, `0005`, `0006` and `0007` have since been run, and all seven
> migrations are applied to your live database.** They went through the
> automatic system described below: the backup gate stopped the first attempt
> exactly as it is designed to, the backup was taken, the gate was ticked, the
> four hand-run numbers were baselined, and the run finished green. **There is
> nothing left for you to do in this step.**
>
> `0007` is **Lucky Scoop** — the scoop tiers, the pool of designs each one
> draws from, and the record of what actually went into each scoop. There is a
> plain-language section on using it further down, under **The studio —
> `/admin`**.
>
> Everything from here to the end of Step 1c is kept as **reference**: how the
> system works, what that one run did, and what happens when a new migration
> file appears. You do not work through it again.

---

#### 6. Add the one new setting — ✅ done

`SUPABASE_DB_URL` is set. This is written out because it is the one secret you
would have to replace by hand if you ever reset your database password.

**Settings → Secrets and variables → Actions → Secrets tab → New repository
secret.**

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | See below |

To get the value: Supabase dashboard → your project → **Connect** (button at the
top) → **Session pooler** → copy the URI. It looks like

```
postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with your database password — Project Settings →
Database → **Reset database password** if you do not have it written down.

Three things that will otherwise waste an afternoon:

- ⚠️ **Session pooler, not "Direct connection."** The direct address answers on
  IPv6 only, and GitHub's machines are IPv4 only. A direct URL works from your
  own computer and then fails in GitHub with "network unreachable", which looks
  like a broken secret and is not.
- ⚠️ **If your password contains any of `: / ? # [ ] @`, reset it to one
  without them.** Those characters mean something inside a web address, and the
  connection fails looking like a wrong password.
- ⚠️ **It is a Secret, not a Variable.** Variables are shown in plain text in the
  GitHub interface. This value is full read-and-write access to every order,
  every customer address and every payment record you hold — it is the single
  most dangerous string in this project.

#### 7. Take a backup — ✅ done before that run, and the rule has not gone away

**There is no undo.** Nothing in this repo can reverse a migration; the only way
back is a backup taken before it ran. The system knows this and **refused its
first run** until it was told a backup had been taken. That is what happened
here, and it worked as intended. The gate is only ever ticked once; the habit is
not a one-off — take a fresh backup before any run you would not want to repeat
with no way back.

In the Supabase dashboard, your project:

- **On a paid plan (Pro and up):** **Database → Backups → Point in Time.**
  Check PITR is switched on and note the time right now — that is the moment you
  can rewind to. Or **Database → Backups → Scheduled backups** and check today's
  is listed.
- **On the free plan there are no automatic backups at all.** Take one yourself.
  Either **Database → Backups** and download the latest daily file, or, from
  your own computer:

  ```bash
  supabase db dump --db-url "$SUPABASE_DB_URL" -f backup-before-migration.sql
  ```

  Keep that file somewhere that is **not** this project folder.

This is worth doing properly once. **Turning on Point-in-Time Recovery is the
single best thing you can do for this shop's data**, and it is the difference
between "we lost an hour" and "we lost the orders."

#### 8. The first run — ✅ done, and this is what it did

**This has happened and must not be repeated.** It is written out in full
because it is the only run that was ever different from every run since, and
because the tables below are the settings the boxes must **never** be given
again.

Go to the repo's **Actions** tab → **Run migrations** (in the left-hand list) →
**Run workflow**. You get three boxes:

| Box | What to put in it, this once |
|---|---|
| **Just tell me what would happen** | ✅ tick it, for a first go |
| **I have taken a backup** | leave blank on the dry run |
| **numbers already run by hand** | `0001 0002 0003 0004` |

Run it. It changes nothing and prints what it *would* do. Read that.

Then run it again, this time:

| Box | Value |
|---|---|
| **Just tell me what would happen** | ⬜ untick |
| **I have taken a backup** | ✅ tick — you did, at step 7 |
| **numbers already run by hand** | `0001 0002 0003 0004` |

That tells your database "you have already had those four, do not run them
again", then runs `0005`, `0006` and `0007`, then checks all 126
assertions and goes red if any of them fails. **Green means done.**

> **Four numbers, and why exactly these four.** `0001` to `0004` are the ones
> you pasted into the SQL editor by hand — they are the struck-through list at
> the top of this step. Naming a migration here tells your database it already
> has that change, so it is never applied again. Name one that never actually
> ran and its change is lost for good; leave out one that did run and it is
> applied a second time. `0005`, `0006` and `0007` are **not** in the list,
> because they have never been run — they are what this first run applies.

> **A red ✗ here is not always a breakage — read the panel, not the cross.**
> This is the thing that caught you out on the first real run: the backup gate
> did its job, changed nothing, and still showed a red ✗ that looked exactly
> like a broken migration.
>
> Every run now puts a panel at the **top of the run page, above the log**, and
> it is one of two things:
>
> | What you see | What it means |
> |---|---|
> | ⏸️ **Action needed — nothing in your database was changed** | Nothing is wrong. It is waiting on something only you can give it — tick the backup box, add the secret. It names the one step. Do it, run again, it goes green. |
> | ❌ **Migration failed** | Something is genuinely wrong: a migration file is misnamed, the database could not be reached, or one of the 126 checks came back false. The panel says whether your database had already been changed before it stopped. |
>
> Both are red and both stop the deploy, and that is deliberate. A green tick
> next to "nothing was migrated" is how a database and the code that reads it
> quietly drift apart — so the run stays red until the database and the code
> agree. Green here only ever means *both* halves are done.
>
> There is a coloured banner in the run's header saying the same thing in one
> line: blue for "action needed", red for "failed".

**`0001 0002 0003 0004` goes in that box exactly once, ever — and that once has
now happened.** Your database keeps its own list of what it has had. **From here
on you leave all three boxes empty.** Typing those numbers in again would tell
your database it had already received a migration it has not, and that
migration's change would be lost for good.

#### 9. From now on — you do nothing

Every push to `master` runs the migrations first and only deploys the code if
they worked. Adding a new migration is: put a new file in
`supabase/migrations/`, named `0008_something.sql` (**digits, then an
underscore** — a name like `0008b_fix.sql` is silently ignored by the tool, so
`scripts/migrate.sh` checks the names and refuses to run rather than let that
happen), push it, and that is the whole procedure.

You can still open **Actions → Run migrations** any time — to do a dry run, or
to fix the database without deploying code.

#### What replaced the old checklist

| You used to | Now |
|---|---|
| Paste each migration into the SQL editor, in the right order | Push. `scripts/migrate.sh` applies whatever is missing, oldest first |
| Remember which ones you had already run | The database keeps the list, in `supabase_migrations.schema_migrations` |
| Remember to re-run `verify.sql` afterwards | It runs automatically, every time, and a red assertion stops the deploy |
| Squint at 126 rows looking for an `f` | It names the failing ones and fails the run |

`supabase/verify.sql` is still exactly what it was and you can still paste it
into the SQL editor whenever you want reassurance. **Every row must say `t`, and
there should be 126 of them** — count the rows as well as the ticks, because a
shorter table means an older copy of the file, which is a pass that never looked
at part of your database. It writes a few throwaway rows and rolls them back, so
it is safe to run against the live shop any time.

#### Checking a migration before it touches anything real

If you ever want to be sure before you push — on your own computer, no cloud,
nothing at risk:

```bash
./scripts/verify-sql.sh --rehearse
```

That builds a throwaway PostgreSQL database on your machine, makes it look like
your live one, and then runs **the same script GitHub runs**, so you watch the
real thing happen somewhere it cannot hurt. It needs the Supabase CLI
(`npm install -g supabase`) and a local PostgreSQL — see just below for which.

#### Which PostgreSQL the checks run against, and why it matters

**PostgreSQL 17, because that is what your Supabase database runs.** Every run
of `scripts/migrate.sh` prints the live server's version; on 27 August 2026 it
printed `PostgreSQL 17.6`.

That sounds obvious and it was wrong until now. `scripts/verify-sql.sh` stood up
PostgreSQL **16** and refused to run against anything else, so all 126
assertions had only ever been proved on a version your shop does not use. Nobody
chose that — 16 was what happened to be installed the day it was written. It is
the same shape of mistake this project has now made three times: a stand-in that
does not reproduce the real platform, printing green about a database the schema
never ships to.

So the version is no longer buried in the script:

```bash
./scripts/verify-sql.sh                  # PostgreSQL 17 — what you actually run
./scripts/verify-sql.sh --pg-version 16  # the old target, for comparison
./scripts/verify-sql.sh --both           # 16 then 17, back to back
```

Every run **prints the version it is testing against, in its first line and its
last**, and says whether that is the one production uses. If you ask for a
version that is not installed it stops and tells you how to install it — it will
never quietly test a different one, because quietly testing a different one is
what went wrong.

Installing 17 on Ubuntu needs PostgreSQL's own package repository; Ubuntu's own
stops at 16. `./scripts/verify-sql.sh` prints the exact commands if it cannot
find it. On a Mac: `brew install postgresql@17`.

**When 17 was first run, on 27 August 2026, nothing behaved differently.** All
126 assertions returned `t` on both 16 and 17, in the same order with the same
labels; the seven migrations, the seed and `verify.sql` produced identical
output on both; and the two things most likely to differ between versions — the
search index column and the way search results are ranked — produced identical
results down to the byte. Nothing needed fixing. The harness targets 17 anyway,
because matching your database is not something you only bother with once a
difference has already cost you an afternoon.

If `migrate.sh` ever prints a major version other than 17 against your live
database — Supabase upgrading you to 18, say — that is the moment to change
`PROD_PG_MAJOR` at the top of `scripts/verify-sql.sh` to match. It is one line,
and it is the only place that fact is written down.

Check **Table Editor → products** whenever you like: each row has
`weight_grams`, `length_mm`, `width_mm`, `thickness_mm` and `letter_eligible`.
Hover a column name to see what it is for. **Those numbers are estimates** — see
"What only you can supply" for the three weighings that would replace the
guesswork.

> **Never edit a migration file that has already run.** If `0005` is wrong, the
> fix is a new `0008`, not a change to `0005`. Once a file has been applied, the
> repo and the live database agree about it; editing it makes them disagree with
> no way to tell which is right, and that is a worse problem than the one being
> fixed. Every file in `supabase/migrations/` says this at the top, in its own
> words.

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
  https://bamstudioshop.com/auth/callback
  ```
  The `fly.dev` one is the address your first deploy gets for free, and it is
  what the shop answers on today. The third line is your own domain, and it does
  nothing until you do Step 5f — add it in that step, matching whichever
  hostname you chose there (`www.` as well, if you attach `www` to Fly rather
  than forwarding it).

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

**This used to be because nothing stored a message, so the email *was* the
delivery. That has not been true since `0006_enquiries.sql`, which is now
applied — and the reason to set this has changed rather than gone away.** A
contact-form message is written into your database **first** and the email is a
notification about a row that already exists; a newsletter sign-up is the same.
A mail provider having a bad afternoon now costs you a prompt instead of costing
your customer their message. **Studio → Enquiries** (`/admin/enquiries`) is
where you read them: every message, filtered by topic or by whether you have
dealt with it, and every address given to hear about new drops. It is a reading
screen only — you answer from your own mail client, so the reply is somewhere
you can see it went.

**What still does not happen without a mailbox is that anybody tells you.**
Nothing pushes. A message that is findable by whoever next thinks to open a
studio screen is not the same as a message you were told about, and the topics
on that form include faulty goods and a parcel that has not arrived — the ones
where a week of silence is the damage. That is the surviving argument for
`NEXT_PUBLIC_SUPPORT_EMAIL`, and it is enough on its own.

**And note the order it actually bites in.** The form is only shown when the
shop can send *and* has a mailbox to send to, so until you have done Step 3 and
set this variable, `/contact` shows your contact details instead of a box —
which means no enquiry can be typed, and `/admin/enquiries` is empty because
nothing has been sent, not because anything is broken.

### 3d. Check it

With the dev server running, send yourself a message through `/contact`. It
should arrive at `NEXT_PUBLIC_SUPPORT_EMAIL`, and replying to it should reply
to you rather than to the shop. **It should also be sitting in Studio →
Enquiries**, whether or not the mail turned up — that is the half that does not
depend on a mail provider. If the page instead says it could not send,
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

> ✅ **Everything is pushed and everything is deployed.** The three fixes from
> 26 August that used to sit here unpushed — the studio printing a price for a
> piece nobody had measured, the inventory screen saying the shelf covered the
> queue, the doubled page title — plus the page that makes staff invitations
> work, went up long ago, and the rounds since have gone up with them. The live
> shop at `https://bamstudio-shop.fly.dev` is serving round 18's code.
>
> Nothing is waiting on a push. The habit that goes with that is unchanged:
> **a push to `master` is what deploys**, so `git status` before you commit and
> `git log origin/master..master --oneline` if you ever want to know what your
> computer is holding that GitHub is not.

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

> ⚠️ **Do not use `git add -A` in this project.** Nine files always show as
> modified because of invisible Windows line-ending differences, not because
> anything changed in them. `git add -A` sweeps all of that into your commit and
> makes it impossible to see what you actually did. Add files by name.

> `.env.local` is git-ignored, so your keys stay off GitHub. Check `git status`
> before pushing anyway.

### 5b. Create the Fly app — already done

> ✅ **`bamstudio-shop` exists on Fly and the shop is deployed.** It answers at
> **<https://bamstudio-shop.fly.dev>**. Keep the rest of this step for reference —
> it is what you would do if the app ever had to be recreated.

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
| `SENTRY_DSN` | **Fly secret** | `fly secrets set` | Restart only |
| `UPSTASH_REDIS_REST_URL` | **Fly secret** | `fly secrets set` | Restart only |
| `UPSTASH_REDIS_REST_TOKEN` | **Fly secret** | `fly secrets set` | Restart only |

**The last three are optional, free, and do nothing at all until you set them.**
`SENTRY_DSN` sends failures somewhere a person is told about instead of leaving
them in the log stream (sentry.io, free tier). The two `UPSTASH_` values move
the rate limiter's counters — the thing standing in front of `/api/track`, which
hands back a customer's postal address for an order number and matching email —
out of one machine's memory and into a shared store, so a restart, a deploy or a
second machine no longer hands somebody a fresh guessing budget
(console.upstash.com, free tier, pick an `ap-southeast` region so it is next
door to the Sydney machine). **Both `UPSTASH_` values or neither** — one without
the other reads as neither. `.env.example` explains each in full. Nothing breaks
while they are unset; the shop simply behaves the way it always has.

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
| `SUPABASE_DB_URL` | Supabase → **Connect** → **Session pooler** → the URI, with your database password pasted in. This is what lets the deploy update your database's tables before the new code goes live. Full instructions — including why it must be the pooler and not "Direct connection" — are in **Step 1c** above. |

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

Only the first five (all three Secrets, plus `NEXT_PUBLIC_SITE_URL` and
`NEXT_PUBLIC_SUPABASE_URL`) are required. The workflow checks them **by name**
before it builds anything and stops with a message naming whichever is missing,
rather than letting you find out thirty screens into a build log. The optional
ones each print a one-line note when blank.

> ✅ **`NEXT_PUBLIC_SITE_URL` is correct — it holds
> `https://bamstudio-shop.fly.dev`.** This was an open worry for a while,
> because the notes at the top of `.github/workflows/deploy.yml` say
> `https://bamstudioshop.com` and that domain is still parked. It has now been
> **measured rather than guessed**: the live `robots.txt` builds its `Sitemap:`
> line from this exact value, and it reads
> `https://bamstudio-shop.fly.dev/sitemap.xml`. The Variable holds the
> `fly.dev` address, so a paying customer comes back to the shop and the
> `/track` links point at the shop.
>
> Keep the reason it mattered, because it comes back the day you change it. This
> value is **baked into the browser bundle when the image is built**, and it is
> the address Stripe sends a paying customer back to. Set it to a domain that
> does not serve the shop and **a customer who pays lands on a domain-for-sale
> page**. Until Step 5f is done it stays `https://bamstudio-shop.fly.dev`; when
> you do Step 5f, changing it is job 1 and it is a rebuild.
>
> **Checking it yourself takes one line**, and does not need the GitHub
> settings page: open `https://bamstudio-shop.fly.dev/robots.txt` and read the
> `Sitemap:` line. Whatever address it names is what the running build has.

**What the deploy does now, and in what order.** Every push to `master` runs two
jobs. The first updates the database and checks it; the second builds and
deploys the code, and **only starts if the first one went green**. If a
migration fails, nothing is deployed and the shop keeps serving the version it
was already serving. See Step 1c for the database half.

Then push to `master` (or hit **Run workflow**). The first build takes a few
minutes; watch it in the Actions tab. When it finishes:

```bash
fly status -a bamstudio-shop      # the machines, their region and their state
fly logs -a bamstudio-shop        # what the server is saying
curl https://bamstudio-shop.fly.dev/api/health   # {"ok":true,"uptimeSeconds":…}
```

> **Read how many machines that lists, rather than assuming one.** `fly.toml`
> asks for a floor of one always-on machine, not a ceiling of one — and
> sampling `/api/health` on the live app has returned **two** clearly different
> uptimes, which means two machines are answering. That is not a fault and
> nothing about it is urgent, but it does change one thing: the rate limiter
> keeps its counters in each machine's own memory, so two machines means the
> allowance in front of `/api/track` is being handed out twice over. Setting the
> two `UPSTASH_` secrets in Step 5c fixes that properly. `fly status` and
> `fly machines list -a bamstudio-shop`, run from your own terminal, are what
> settle how many there actually are.

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

> ⚠️ **Type the `fly.dev` address, not `bamstudioshop.com`.** This is the one
> step in this runbook where using your own domain "a bit early" is worse than
> not having one. `bamstudioshop.com` is registered but **parked** — it does not
> answer for the shop, and until you have done Step 5f the shop's address is
> baked into the built image as `https://bamstudio-shop.fly.dev`. Point the
> webhook at the parked domain and Stripe will happily take the customer's
> money, then deliver the confirmation to a host that is not your shop: the
> payment succeeds, **no order is ever recorded**, no order number is allocated,
> no stock moves and nobody is emailed. You would find out from the customer.
>
> **The domain moves in this order, and not another:** rebuild with the new
> `NEXT_PUBLIC_SITE_URL` and attach the domain to Fly (Step 5f, jobs 1 and 2)
> — *then* come back here and edit this endpoint's URL (Step 5f, job 3). Never
> the other way round. The signing secret does not change when you edit the URL,
> so there is nothing to re-set on Fly afterwards.

1. Stripe → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: **`https://bamstudio-shop.fly.dev/api/webhooks/stripe`** —
   exactly this, today. See the warning above before substituting anything else.
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

#### When can you move? Now — and now is the best time you will get

You asked when the shop can move to `bamstudioshop.com`. **The answer is now,
and "now" is not merely allowed, it is the safest moment there will ever be.**

Two of the five jobs below reach into other people's systems: **Stripe's webhook
endpoint** (job 3) and **Supabase's auth URLs** (job 4). Those two are the
plumbing that turns a payment into a recorded order, and a sign-in into an
account. Do them clumsily today and the cost is your own afternoon — there is no
real customer to inconvenience, no real order to lose and no real money in
flight. Do them clumsily in three months and the cost lands on somebody who has
just paid you: a card charged, a confirmation posted to a host that is not your
shop, and **no order recorded at all**.

**You have no real customers and no real orders yet. That is the argument for
going now, not for waiting.** Nothing is burned by moving either: the
`bamstudio-shop.fly.dev` address keeps working afterwards, so the old webhook
and the old sign-in URLs stay valid while you check the new ones.

#### Decide this first: the apex, `www`, or a subdomain

This step used to show `shop.yourdomain.com` in its commands, as an example
nobody had chosen. **Choose the hostname before you start, because job 1 bakes
it into the build** — changing your mind later is another rebuild, another edit
at Stripe and another edit at Supabase, all over again.

| Choice | What a customer types | What you add at Porkbun |
|---|---|---|
| **Apex** — `bamstudioshop.com` | the domain, nothing in front | **A and AAAA records** pointing at the app's own addresses — or Porkbun's `ALIAS — CNAME flattening` record, which it supports on the root |
| **`www`** — `www.bamstudioshop.com` | the domain with `www.` in front | a plain **CNAME**, the ordinary case for a name below the root |
| **A subdomain** — `shop.bamstudioshop.com` | the domain with `shop.` in front | a plain **CNAME**, exactly as for `www` |

**For a shop, take the apex — `https://bamstudioshop.com` — and point `www` at
it.** It is the address people type, the address that fits on a market sign and
the address they will get right when they half-remember it. A `shop.` subdomain
is for a shop bolted onto a business that already lives at the apex, which is not
your situation: this *is* the business.

**Why the apex is more work than a subdomain, in one paragraph.** A CNAME says
"this name is really that other name", and the rules of DNS do not allow one at
the root of a domain, because the root has to carry other records (mail, for one)
that a CNAME would displace. So a subdomain gets a one-line CNAME to Fly, while
an apex needs the addresses themselves — **A** for IPv4 and **AAAA** for IPv6.
Fly documents A and AAAA as the recommended setup for a domain pointed straight
at an app, and CNAMEs as the good option for subdomains, warning off a CNAME at
the apex unless your registrar does flattening. Porkbun does do flattening: its
`ALIAS — CNAME flattening` record is exactly that, with a blank host field. Either
route works; the A/AAAA route is the one Fly's own instructions hand you.

**You do not have to look the addresses up.** `fly certs add` prints the records
to add, and `fly certs show` prints them again:

```bash
fly ips list -a bamstudio-shop                       # what addresses the app has
fly certs add bamstudioshop.com -a bamstudio-shop    # prints the DNS records to add
fly certs show bamstudioshop.com -a bamstudio-shop   # prints them again, plus status
```

If the app has no IPv4 or IPv6 address of its own, `fly ips allocate` is what
adds one. A **shared** IPv4 address and IPv6 addresses come with the app at no
charge; a **dedicated** IPv4 is US$2 a month, and you only need one if something
later requires an address nobody else answers on. Start without it.

**Making `www` work as well, without building anything.** Fly will happily issue
a certificate for `www.bamstudioshop.com` too (`fly certs add www.…`), and then
both addresses serve the same shop — which is fine, though it means the same
pages exist at two addresses and only `NEXT_PUBLIC_SITE_URL` says which one is
the real one. **Nothing in this shop's code redirects one hostname to another;
it never looks at which host it was asked on.** The tidier answer costs nothing
and is done at the registrar: Porkbun's free **URL forwarding**, with `www` as
the subdomain, `https://bamstudioshop.com` as the destination, and the **301
Permanent Redirect** option chosen rather than the default temporary one. Then
there is one address and `www` politely sends people to it. (Porkbun runs an
HTTPS forwarder, but check the forward actually works over `https://` once you
have set it — that is the part worth testing rather than assuming.)

**What this is based on**, so you or anyone after you can check it rather than
take it on trust — read at the start of September 2026:

- Fly's custom-domain instructions, including A/AAAA versus CNAME and the
  `fly certs` commands: <https://fly.io/docs/networking/custom-domain/>
- Fly's pricing for a dedicated IPv4: <https://fly.io/docs/about/pricing/>
- Porkbun's root-domain record, `ALIAS — CNAME flattening`:
  <https://kb.porkbun.com/article/85-how-to-connect-your-root-domain-when-your-web-host-wont-provide-an-ip-address>
- Porkbun's URL forwarding, including the 301 option:
  <https://kb.porkbun.com/article/39-how-to-set-up-url-forwarding>

**Moving the shop to that domain is five jobs. Do them in this order — the
order is the whole point, because jobs 1 and 2 are what make the domain answer
for the shop at all, and job 3 is what tells Stripe where to send the money's
paperwork. Job 3 before jobs 1 and 2 means Stripe posting confirmations at a
parked domain: cards charged, nothing recorded.**

1. **Change the `NEXT_PUBLIC_SITE_URL` GitHub Variable and redeploy.** This is a
   **rebuild**, not a setting you can flip. That value is baked into the code
   when the image is built — Stripe's success and cancel redirects, the `/track`
   link in confirmation emails and every canonical URL are built from it. There
   is no restart, no Fly secret and no dashboard toggle that changes it. Update
   the Variable, then push or run the workflow. Update the pinned value in
   `fly.toml` in the same commit so a manual `fly deploy` agrees with CI.
2. **Attach the domain to Fly** — using the hostname you settled on above, which
   for a shop is the apex:
   ```bash
   fly certs add bamstudioshop.com -a bamstudio-shop
   fly certs show bamstudioshop.com -a bamstudio-shop   # tells you the DNS records
   ```
   Add the records it names at your registrar. The certificate issues by itself
   once DNS resolves.
3. **Update Stripe's webhook endpoint** to the new URL (Developers → Webhooks →
   your endpoint → edit). The signing secret does not change, so nothing has to
   be re-set on Fly. **Only once jobs 1 and 2 are done and the new address
   actually serves the shop** — check it first with
   `curl https://bamstudioshop.com/api/health`, which must return `{"ok":true}`
   (with an `uptimeSeconds` alongside it). Until it does, leave the endpoint on
   `bamstudio-shop.fly.dev`.
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

## The studio — `/admin`

✅ **Set up and working.** Sign in on the shop with your own account and go to
**<https://bamstudio-shop.fly.dev/admin>**. You are already the owner: a single
statement run in the SQL editor put your account in the `staff` table, which is
the only way the first person ever gets in. There is no "sign up as staff" page,
by design.

Ten screens: **Overview**, **Orders** (including *Record a sale* for a market or
TikTok order you took in person), **Enquiries** (contact-form messages and
newsletter sign-ups), **Products**, **Lucky Scoop**, **Inventory** (the print
queue, the filament buy list, and *Measure the catalogue*), **Reports**,
**Colours**, **Settings** and **Studio access**.

Two of them print. **An order's page has a packing slip** — the piece of paper
that goes in the box, with the personalisation exactly as the customer typed it
and deliberately no prices on it, because a great many of these are gifts. And
**Orders → Pick list** is one sheet for every open order at once: plain pieces
pooled across orders so three of the same clicker in the same colour is one trip
to the drawer, personalised pieces never pooled, no customer names and no
addresses. Both are for reading off paper at the bench instead of copying a
screen by hand.

Three things worth knowing before you use it:

- **Nothing is invented.** A shop that has taken no orders says so, and a piece
  with no print time and no filament says "not measured" instead of showing a
  price. If a screen looks empty, that is the screen telling you the truth about
  the database, not a fault.
- **Inviting someone.** Studio access → invite by email address, choosing
  **Studio** (everything except inviting people) or **Packing** (orders only —
  no costs, no prices, no margins). They get a link; they must sign in with **the
  same address you invited**, and then the link makes them staff. An invitation
  can never grant Owner. If they have no account yet, the link takes them through
  creating one and brings them back.
- **Tracking numbers and order status** are typed on the order's own page in
  Orders. That is what moves a customer's `/track` page from *printing* to
  *packed* to *shipped* — it is no longer a hand edit in the Supabase tables.

- **The Overview tells you when money is owed back.** `0005_sale_integrity.sql`
  is applied, so this is live: a payment that
  cleared for an order you had already cancelled appears there as a refund owed,
  with the amount, and stays until you mark it done. It used to be one line in a
  server log. The same panel shows any order still waiting on its confirmation
  email, and anything you have sold more of than you had ready to ship.

### Lucky Scoop — how it works, start to finish

**`0007` is applied**, so the Lucky Scoop screens have their tables and the shop
will offer scoops as soon as you have a tier that can be sold. Until then
`/scoop` is a real page that says *the scoops aren't open yet* and explains how
one works, and no bowl, no home-page card and no sitemap entry appears. That is
correct rather than broken: there is nothing to sell yet.

**A scoop is the one thing you sell before you know what is in it.** Everything
else in the shop is printed after it is ordered, so its cost is known before the
sale. A scoop is the other way round: somebody buys "Pet scoop, five pieces",
and only later — when you draw the pieces out of the bowl and pack them — does
anyone know what went in. Everything below follows from that, and it is why the
scoop screens behave differently from the rest of the studio.

**1. Make a tier.** **Studio → Lucky Scoop → New tier.** A *tier* is the thing a
customer actually buys — not "a scoop" but "Pet scoop, five pieces, $X". You
give it:

- a **name** and a **web address** (the customer sees `…/scoop/pet-scoop`);
- a **theme** — pet, household, clickers & keyrings, or a mixed bowl. **The
  customer chooses the theme; the draw only decides which pieces come out of
  it.** That is deliberate: at the stall the colour board decides which category
  you get, but online, selling somebody pet things when they wanted clickers is
  not something "it's lucky" excuses. Keep the board in the video, where it is
  theatre and not a term of sale;
- **pieces in a scoop** — five is where you started;
- a **price**, a **packed weight** and a **packed thickness**.

**2. Fill its pool.** On the tier's page, tick the designs this scoop may draw
from. This is a list of actual products, not a category — on purpose. If it were
a category, then the day something large got filed under it, that thing would
quietly start turning up in scoops, and nobody would be told. The pool is also
what the customer sees: the tier's page lists every design in it, and that list
is the description of what they are buying. **The pool must hold at least as
many designs as the scoop promises pieces** — five pieces needs five designs at
minimum.

**3. Why it will not switch on.** A tier cannot be made active without **a
price** and **a packed weight**, and the database itself refuses it. That is not
an obstacle to work around:

- **No price** means nobody has priced it. The box is left blank rather than set
  to zero, because a zero would show a customer a free scoop. If you are not
  sure what to charge, the tier page shows a suggestion once every design in the
  pool has a measured cost — and says how many are still unmeasured until then.
  It will not guess from a half-measured pool.
- **No packed weight** means nobody has put a test pack on the scales. Postage
  is priced on weight, and a scoop has no product behind it to take a weight
  from, so the tier carries its own. **Give the heaviest pack you would
  plausibly send, not the average** — you wear the difference on any pack that
  comes out heavier, and that is the direction to be wrong in. This is also why
  scoops are for small things only: a bowl that could produce either a charm or
  a pet bowl has no honest weight. **A scoop always goes as a tracked parcel,
  never as a Large Letter** — a Large Letter is untracked and uninsured, and if a
  scoop goes missing there is no reprint, because the pieces that were in it were
  drawn from the bowl and are gone.
- **Too small a pool** means the pool holds fewer designs than the scoop
  promises pieces.

The screen tells you which of the three is stopping you.

**4. A low bowl does not take the tier off the shop, and that is your
correction.** This page used to say the opposite — that a tier stopped being
listed once its pool could not fill a scoop from stock on hand. **That was
wrong and it has been taken out**, on your own words: *you can just print it
after you scoop*. Everything else in the shop keeps selling when the shelf is
empty, because you print to order, and a scoop is no exception — if the bowl is
short you print the rest before you pack it. A gate on stock would have quietly
pulled a paid product off your shop because a shelf count dipped, which is a
problem you do not have.

What the studio still shows you is **how many scoops the bowl could fill without
printing anything first**. That is information — a low number is a nudge to
print — and it decides nothing.

What does still stop a tier being switched on is the truthfulness rule in point
3, and it is about the tier's own facts rather than the shelf: a price, a packed
weight, and a pool holding at least as many designs as the scoop promises pieces.
"Five drawn from these twelve" needs twelve designs listed. It does not need
twelve on the shelf this morning.

**5. Record what went in — and note that stock has not moved yet.** When a scoop
order comes in, the order's page in **Orders** has a **Lucky Scoop** panel with
one entry per scoop bought (two scoops on one line are two draws, two videos and
two bags). Draw the pieces, then record them: tick what went in and how many of
each, and add the video link and a note if you have them.

**Recording the pack is the moment everything happens.** It is when the pieces
come off your stock counts and when the scoop's cost is worked out from what
actually went in. Nothing came off the shelf at the sale, because at the sale
nobody knew what would be in it. Saving the panel twice cannot take the same
pieces off twice.

**6. You cannot mark the order posted until every scoop on it is recorded.** The
studio will refuse and name the scoop. This is a guard rather than red tape:
once the bag is sealed and in the post, nobody can go back and look, and an
order posted without its pack recorded leaves your stock counts wrong for ever
and its cost unknowable.

**What the pack panel is relaxed about, on purpose:** if a charm broke or the
last one had already gone and you put in something that was not on the list,
record what you **actually** posted. What was sent is a fact; the pool is a
policy. And the video link is optional — it is not required before you can post
the order, because whether every scoop is filmed is your decision, not the
software's.

**Three things only you can decide, and the shop deliberately says nothing about
any of them until you do:**

1. **May a scoop contain two of the same charm?** Nothing on the site says
   either way, and nothing in the studio stops you.
2. **How is the video promised?** Is "we film every scoop" a promise you are
   making, or just a thing you usually do? The site does not currently claim it,
   and the video field is optional so the software does not decide this for you.
3. **Is a change of mind on a scoop accepted?** The refunds page has **two
   paragraphs already drafted** for you, one accepting and one declining, sitting
   as a note in `app/legal/refunds/page.tsx`. Pick one and someone can drop it
   in. If you decline, it has to be said **before** people buy, so it also
   belongs on the tier's page. Until you pick, the page says nothing in either
   direction, which favours the customer — the safe way round.

None of these affects a customer's rights if a scoop turns up faulty, short, or
with a piece that was not on the bowl's list. Those are already covered.

Two things the studio still cannot do:

- **It cannot issue a refund.** It tells you one is owed and records that you
  have dealt with it; **the refund itself is done by hand in Stripe**, and that
  is on purpose — refunding is a conversation with a customer, not something
  software should decide alone.
- **It cannot un-sell an oversell.** Selling more than you had ready is allowed
  here, because you print to order and the payment has already gone through by
  the time stock moves. The count on the Overview is a "print this one first"
  note. Nothing clears it automatically — you clear it once the backlog is
  printed.

---

## Step 6 — Going live

Do these in order on launch day:

0. ~~Rotate the Supabase JWT secret.~~ ✅ **Done, 26 August.** Nothing further is
   needed there.
0b. ~~The one-time database setup.~~ ✅ **Done.** All seven migrations are
   applied and the **126** assertions pass. You never paste SQL into the
   Supabase editor again. What each one bought you: `0005` makes a lost
   confirmation email recoverable, makes an oversell visible instead of silently
   clamped, and gives you a list of payments that owe a refund; `0006` stops a
   customer's contact-form message from existing only inside an email that might
   not send, and **Studio → Enquiries** is where you read those messages; `0007`
   is Lucky Scoop. From here, migrations run themselves on every deploy and the
   deploy stops if the database is not what the code expects.
0c. ~~Push the commits sitting on your computer.~~ ✅ **Done.** Everything is
   pushed and deployed; a push to `master` is still what deploys.
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

### Done — the security job that used to sit at the top of this list

> ✅ **Your Supabase JWT secret has been rotated** (26 August 2026), so the anon
> key and `service_role` key that were once exposed in a chat no longer work.
> That closes it. Your Stripe live key was exposed the same way and you had
> already rolled it. Test keys are what the shop is using today.
>
> Kept here only so the procedure is written down if it is ever needed again:
> rotating the JWT secret in the Supabase dashboard invalidates **every** key
> signed with the old one, so the new keys have to go into **all three** places
> in one sitting or the shop goes offline — `.env.local` on your computer; the
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` **GitHub Actions Secret**, followed by a
> **re-run of the deploy**, because that one is baked in at build time and a
> restart will not pick it up; and
> `fly secrets set SUPABASE_SERVICE_ROLE_KEY='...' -a bamstudio-shop`.

### Do this first — the catalogue, and then the domain

> ~~`git push origin master`.~~ ✅ **Done — everything is pushed and deployed.**
> ~~The one-time database setup.~~ ✅ **Done — all seven migrations are applied
> and the 126 assertions pass.** Both of those sat at the top of this list for
> weeks; neither is waiting on you any more. What is left is below, in the order
> it is worth doing.
>
> 1. **Fill in the studio.** Your 44 products are all still priced at the seed's
>    $9.00, none of them has a filament recipe, and almost none has a print time
>    — so every cost, margin and suggested price in the studio says "Not
>    measured", which is correct and useless. **Studio → Inventory → Measure the
>    catalogue** is the screen built for exactly this: one row per product, a
>    print time, a colour and its grams, Save, next. Nothing else you do makes
>    the studio useful until this is in.
> 2. **Move the shop onto `bamstudioshop.com`** — Step 5f, which now says why
>    **now** is the right moment and which hostname to choose. The move touches
>    Stripe's webhook and Supabase's sign-in URLs, and doing that while there is
>    no real customer and no real order is strictly safer than doing it after.
>    Delete Porkbun's `*` parking record first; it is job zero for both this and
>    email.
> 3. **Turn email on** (Step 3) and set `NEXT_PUBLIC_SUPPORT_EMAIL` (Step 3c).
>    Until both are done the contact form is not offered at all, so a customer
>    with a faulty piece has no box to type into.
>
> Do not copy prices out of the workbook's *Suggested price* column: cell C19 on
> the Settings sheet holds the text `1.6%` rather than a number, so that column
> is an error on every row and Profit/unit reads 0. The shop works the same sum
> out correctly.

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

Every product is set to "parcel" right now, so nothing is ever underpriced, and
because `0004` is applied that is also what a brand-new product row starts as. If you want small charm orders to go as letters, that is a checkbox
per product (`letter_eligible`) on its row in Supabase, and **it no longer needs
a code change to go with it**: the site used to tell customers every delivery
method was "tracked" whatever was actually being sent, and that was fixed — the
wording now comes from the real quote, so a letter is described as a letter. Tick
it per product, and check the cart wording once on a small basket to see it for
yourself. It is written up in `WORKLOG.md` §6 as a pending decision because the
trade below is yours to make, not because anything is waiting on the code.

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
| **The domain, attached** — `bamstudioshop.com` **is registered** (Porkbun) | `NEXT_PUBLIC_SITE_URL`, Stripe's webhook URL, Supabase's Site URL and redirect list, the Resend sending domain | Still fully parked: the apex answers with Porkbun's parking addresses, `www` is a CNAME to `uixie.porkbun.com`, and **the `*` parking CNAME is still there and must be deleted first — it shadows email records**. The shop is live at `https://bamstudio-shop.fly.dev` meanwhile. **Step 5f is the move and it is worth doing now**, before there is a real customer to inconvenience — it says why, and which of apex / `www` / `shop.` to choose. Its first job is a **rebuild**, not a setting change. The `.com.au` needs an **issued** ABN (a pending application does not qualify) |
| **Australia Post key** — `AUSPOST_API_KEY` | Postage pricing | Free and instant from developers.auspost.com.au (Step 3b), and it is in `.env.example`. Without it postage is quoted from built-in rates read on 25 August 2026, rounded up one band — the shop works and charges slightly dear |
| **Three real weights** — one charm, one clicker, one bowl, each in its mailer | `lib/shipping/dimensions.ts`, and each product's row in Supabase | Every weight and size is an estimate today, erring expensive. See the box above — this is the highest-value thing on this page |
| **Social handles** (optional) — `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_TIKTOK_URL` | Footer, contact, about, and every "message us" fallback | No links shown. They also act as a second channel: with a handle set, pages can still offer a way to reach you even before the mailbox exists |
| **Email keys** — `RESEND_API_KEY`, `EMAIL_FROM` (both, or neither) | Step 3 | No email of any kind is sent, and no page claims one is coming. Customers still get their order number on screen and can still track an order — that path deliberately does not depend on email |
| **Market dates** | About page | `[MARKET NAME AND DATE]` placeholder — the one bracketed placeholder left in the site |
| **Real prices, print times and filament grams** | Studio → Products, and Studio → Inventory → *Measure the catalogue* | All 44 products still carry the seed's $9.00, **none has a filament recipe** and almost none has a print time, so every cost, margin, suggested price and the whole filament buy list read "Not measured". Nothing invents a number in their place — that is deliberate — but the studio cannot tell you anything useful until they are in |

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

### "There was an error when I pushed" — check whether it actually was one

Open the run in the **Actions** tab and look at the **panel at the top of the
page**, above the log.

- **⏸️ Action needed — nothing in your database was changed.** Not an error.
  The system stopped on purpose and is waiting for you. The panel names the one
  thing to do — usually ticking **I have taken a backup**. Do it, run again.
- **❌ Migration failed.** A real problem. The panel says what, and whether your
  database was changed before it stopped. Your shop is still serving the version
  it was serving before either way — nothing is deployed when this is red.

Both look identical in the list of runs, because both are a red ✗ and both stop
the deploy. The cross only ever means "the new code was not rolled out". The
panel is the message.


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
was not restarted after you set it. **The message itself is not lost** — it was
written to the database before the send was attempted, so it is on **Studio →
Enquiries** under "still to deal with". Fix the mail settings so you are told
next time, then go and read the one that came in while you were not.

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
the tracked-or-cheap decision in "What only you can supply". The cart and
checkout both price a basket the same way, through one piece of code, so the
figure a customer agrees to is the figure Stripe charges.

**Fly says the machine is unhealthy, or the deploy will not roll over**
Check `fly logs -a bamstudio-shop`, then
`curl https://bamstudio-shop.fly.dev/api/health` — it should return
`{"ok":true}`. That endpoint touches nothing, so if it fails the process itself
is not serving. `fly status -a bamstudio-shop` shows the machine's state.

**`/admin` sends me back to the shop, or to sign in**
The studio checks the `staff` table on every page, and that table is only
readable by the server — so being signed in is not enough, your account has to
be in it. Yours was added by the one-line statement in Step 1c. If you are being
turned away, check you are signed in with **the same email address** that
statement used.

**Someone I invited says the link is not valid**
Three usual causes, in order: they are signed in with a **different address**
than the one you invited (the link only works for the address on the
invitation); the invitation was already used, or you revoked it, or it has
expired — Studio access shows which; or they opened it, signed up, and never
came back to the link. Send a fresh invitation from Studio access rather than
re-sending the old link.

**A screen in the studio says "not measured" everywhere**
That is correct, not broken: a product with no print time and no filament grams
has no cost, so there is no margin and no suggested price to show, and the shop
will not print a number it cannot stand behind. **Studio → Inventory → Measure
the catalogue** is where you fill those in.
