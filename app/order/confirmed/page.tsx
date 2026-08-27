import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ProductImage } from "@/components/ProductArt";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { ButtonLink, Icon, Pill } from "@/components/ui";
import { ClearCartOnMount } from "./ClearCartOnMount";
import { getStripe } from "@/lib/stripe";
import {
  getOrderConfirmationSummary,
  isDatabaseConfigured,
} from "@/lib/queries";
import type { OrderConfirmationLookup } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import { canReachStudio, sendsOrderConfirmation } from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { money } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";

export const metadata: Metadata = {
  // Neutral on purpose: this page also renders the processing and never-paid
  // states, and the browser tab should not announce a confirmation for those.
  title: "Your order",
  robots: { index: false },
  // The URL carries a Stripe session id that reads back the customer's
  // address, so it must not leak to any third party in a Referer header.
  referrer: "no-referrer",
};

/**
 * Rendered per request, deliberately.
 *
 * The email statements below derive from `isEmailConfigured()`, which reads
 * the RESEND_API_KEY / EMAIL_FROM secrets on the server at render time.
 * Prerendered, that answer is frozen into the HTML at build: an owner who adds
 * the two secrets to the host without triggering a rebuild would get
 * confirmation emails going out from the Stripe webhook while this page — the
 * first thing a paying customer sees — still tells them none is coming. The
 * page is already uncacheable (it reads a Stripe session per visit), so this
 * costs nothing.
 */
export const dynamic = "force-dynamic";

type SearchParams = Promise<{ session_id?: string | string[] }>;

const STEPS = ["Confirmed", "Printing", "Packed", "Shipped"];

/**
 * Throttle on the Stripe reads below.
 *
 * This page was the only route family in the shop with no rate limit, and it
 * is `force-dynamic` and takes the session id straight off the query string.
 * Nothing leaks — a session id that is not ours makes `retrieve()` throw, and
 * the catch turns that into "we couldn't check this order" — but each visit
 * spends up to two Stripe API calls (`sessions.retrieve` and, when no order
 * row exists yet, `listLineItems`), and Stripe's rate limit is per *account*.
 * A loop on this URL therefore costs nothing to run and 429s real checkouts
 * for real customers, which is the failure that matters.
 *
 * 30 a minute per IP, which is deliberately loose. This page tells people to
 * refresh it — the order number is allocated by the webhook, so the copy in
 * OrderNumberCard says "Refresh this page and it should appear above" — and a
 * customer who has just been charged and is watching for their number must
 * never be the one who gets throttled. Thirty refreshes inside a minute is
 * well past anything a person does and still cheap against Stripe's budget.
 * The window matches the other unauthenticated routes (/api/checkout,
 * /api/track, /api/contact) so there is one shape to reason about.
 */
const CONFIRM_LIMIT = 30;
const CONFIRM_WINDOW_MS = 60_000;

/**
 * The caller's bucket key, from the same `clientKey()` every route handler
 * uses.
 *
 * `clientKey()` takes a Request because every other call site is a route
 * handler that has one; a page is handed the request headers and nothing else.
 * So the headers are wrapped back into the shape the shared helper expects,
 * rather than growing a second copy of the "which value identifies a caller"
 * decision here — that decision is subtle (see the header of lib/rate-limit.ts
 * on Fly appending to `x-forwarded-for`) and must exist in exactly one place.
 *
 * The URL is a placeholder: `clientKey()` reads headers only, and `.invalid` is
 * reserved by RFC 2606 so it can never resolve — the same device lib/safe-next.ts
 * uses for the same reason.
 */
async function confirmationKey(): Promise<string> {
  const inbound = await headers();
  return clientKey(
    new Request("https://order-confirmed.invalid", { headers: [...inbound] }),
    "order-confirmed",
  );
}

/**
 * Does the Stripe webhook email this customer their confirmation?
 *
 * Read from the secrets on the server, exactly as the webhook reads them, so
 * this page and the mail can never disagree about whether one is coming. Note
 * the send is queued with `after()` and can still fail, so the copy below says
 * an email is sent, never that it has arrived.
 *
 * (`canReachStudio` — is there any door at all — comes from lib/contact.ts and
 * is the same test /track uses. It matters most on this page: every "get in
 * touch and we'll put it right" below is the remedy offered to someone who has
 * just been charged, so it must not name a door that does not exist.)
 */
const SENDS_CONFIRMATION = sendsOrderConfirmation(isEmailConfigured());

/**
 * What this page can honestly say about the order behind a checkout session.
 * Derived in one place so the headline, the progress tick and the order-number
 * card can never disagree about which state they are in.
 */
type OrderView =
  | { kind: "number"; orderNumber: string }
  /** Paid or settling, but the webhook has not allocated a number yet. */
  | { kind: "pending" }
  /** The database answered and holds no order for this session. */
  | { kind: "missing" }
  /** No database, no service-role key, or the lookup errored. */
  | { kind: "unavailable" };

function orderView(lookup: OrderConfirmationLookup): OrderView {
  if (lookup.state === "not_found") return { kind: "missing" };
  if (lookup.state === "unavailable") return { kind: "unavailable" };

  const { orderNumber, status } = lookup.summary;
  // Both signals mean the same window: the webhook promotes `pending` to
  // `confirmed` and allocates the order number in the same step, so a row that
  // is still pending has no number to show even if one somehow appeared.
  if (status === "pending" || !orderNumber) return { kind: "pending" };
  return { kind: "number", orderNumber };
}

type LineSummary = {
  name?: string;
  art?: string;
  tint?: string;
  variant?: string;
  unit_price?: number;
  quantity?: number;
};

export default async function OrderConfirmedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const sessionId = Array.isArray(params.session_id)
    ? params.session_id[0]
    : params.session_id;

  let email: string | null = null;
  let total: number | null = null;
  let items: LineSummary[] = [];
  let firstName = "";
  let shippingLine: string | null = null;

  /**
   * Stripe hands the browser this session id BEFORE payment, and redirects
   * here for delayed payment methods while the money is still in flight. So
   * the page must never take reaching it as proof of payment — it reads the
   * session's real state and says only what is true.
   *
   *  paid       — money taken, order confirmed.
   *  processing — checkout completed on a delayed method; not yet paid.
   *  unpaid     — never completed. Their basket must survive.
   */
  let paymentState: "paid" | "processing" | "unpaid" | "unknown" = "unknown";

  // Read the session straight from Stripe so the page is correct even if the
  // webhook has not landed yet.
  if (sessionId) {
    // Checked here rather than at the top of the page on purpose: a visit with
    // no `session_id` calls Stripe not at all, so it costs nothing to serve and
    // must not spend anyone's allowance. Only the visits that would hit Stripe
    // are counted.
    //
    // ─────────────────────────────────────────────────────────────────────
    // DELIBERATELY `rateLimit()` AND NOT `rateLimitDurable()`. This is the
    // one of the five throttled surfaces that stays in-process, and it was
    // considered rather than overlooked: /api/track, /api/contact,
    // /api/newsletter, /api/checkout, /api/shipping/quote and
    // /api/search/suggest all take the durable path.
    //
    // 1. The check exists to make a throttled visit COST NOTHING — that is
    //    the paragraph immediately above, and the early return below. A
    //    durable decision is itself a network round trip, so the guard would
    //    start spending the thing it was put here to save. On a route
    //    handler that trade is obviously worth it; on the guard whose entire
    //    argument is "costs nothing", it inverts the argument.
    // 2. What durability buys is "a restart does not hand back an
    //    allowance", and the allowance here opens Stripe session retrieval —
    //    reachable only with a `session_id`, which is a long Stripe-issued
    //    random string and not a public incrementing sequence. Contrast
    //    /api/track, where the key space is ~65k guesses and a fresh
    //    allowance is the whole attack. There is nothing here to enumerate,
    //    so the durable version would be protecting against an attacker who
    //    can already do the thing anyway.
    // 3. This page renders inside a customer's payment redirect, and the
    //    copy tells them to refresh it while they wait for their order
    //    number. lib/rate-limit.ts bounds the store at 500ms with a breaker
    //    after three failures, which is a real ceiling and not a small one:
    //    a sick store can add up to 1.5s across three refreshes before the
    //    breaker opens, landing on somebody who has just been charged and is
    //    watching a page for a number. Elsewhere that latency lands on a
    //    background quote or a typeahead.
    // 4. Durability also cuts the wrong way for a legitimate visitor here:
    //    the counter surviving a restart means a customer refreshing hard is
    //    thirty from being told to wait, with nothing to forgive them.
    //
    // If a future reader wants uniformity, the honest way to get it is to
    // stop counting refreshes and cache the Stripe read instead — not to
    // put a network hop in front of the last page a paying customer sees.
    // ─────────────────────────────────────────────────────────────────────
    const limit = rateLimit(
      await confirmationKey(),
      CONFIRM_LIMIT,
      CONFIRM_WINDOW_MS,
    );
    if (!limit.ok) {
      // Bail out BEFORE the Stripe calls — throttling that still spends the
      // quota protects nothing. The early return also means <ClearCartOnMount />
      // is never rendered on this path, so a basket survives being throttled,
      // exactly as it survives an unpaid session.
      //
      // A page cannot set a 429 or a Retry-After the way the route handlers do,
      // so the wait is stated in the copy instead. Nothing here claims anything
      // about the payment: we did not ask Stripe, so we do not know, and telling
      // someone who has just been charged that no money was taken is the one
      // mistake this page exists to avoid.
      return <NotPaid hasSession checked={false} throttled />;
    }

    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);

      paymentState =
        session.payment_status === "paid"
          ? "paid"
          : session.status === "complete"
            ? "processing"
            : "unpaid";

      email = session.customer_details?.email ?? null;
      total = session.amount_total ?? null;
      firstName = (session.collected_information?.shipping_details?.name ?? "")
        .split(" ")[0]
        .trim();

      const address = session.collected_information?.shipping_details?.address;
      if (address) {
        shippingLine = [
          address.line1,
          address.line2,
          address.city,
          address.state,
          address.postal_code,
        ]
          .filter(Boolean)
          .join(", ");
      }

      // Line items live in our own database, staged when the session was
      // created — Stripe's metadata is too small to carry a basket.
      if (isDatabaseConfigured()) {
        const supabase = await createClient();
        const { data: order } = await supabase
          .from("orders")
          .select("id, order_items(product_name, variant_label, art, tint, unit_price, quantity)")
          .eq("stripe_session_id", sessionId)
          .maybeSingle();

        const rows = (order as { order_items?: LineSummary[] } | null)
          ?.order_items;
        if (Array.isArray(rows)) {
          items = rows.map((row) => ({
            name: (row as unknown as { product_name?: string }).product_name,
            variant: (row as unknown as { variant_label?: string }).variant_label,
            art: row.art,
            tint: row.tint,
            unit_price: row.unit_price,
            quantity: row.quantity,
          }));
        }
      }

      // Fall back to Stripe's own line items when there is no order row yet.
      if (items.length === 0) {
        const lineItems = await getStripe().checkout.sessions.listLineItems(
          sessionId,
          { limit: 100 },
        );
        items = lineItems.data.map((item) => ({
          name: item.description ?? "Item",
          unit_price: item.price?.unit_amount ?? 0,
          quantity: item.quantity ?? 1,
        }));
      }
    } catch (error) {
      console.error("Could not read checkout session:", error);
    }
  }

  // No confirmation to show: keep the basket intact and send them back to it.
  //
  // The two states are kept apart all the way into the copy. "unpaid" is
  // Stripe's own answer that no money was taken. "unknown" means the retrieve
  // above threw — which happens on a transient Stripe outage AFTER a successful
  // payment just as readily as on a bad session id — so it is only ever "we
  // could not check". Collapsing them, as this page used to, tells someone who
  // has just been charged that no payment was taken.
  if (paymentState === "unpaid" || paymentState === "unknown") {
    return (
      <NotPaid
        hasSession={Boolean(sessionId)}
        checked={paymentState === "unpaid"}
      />
    );
  }

  const paid = paymentState === "paid";

  /**
   * The order number, read by Stripe session id through the admin client.
   *
   * This is the fix for WORKLOG §0.1 on this page, and it does not depend on
   * email. A confirmation email carrying this number is sent when the Resend
   * secrets are set, but it is queued with `after()` and can fail silently, and
   * with the secrets unset nothing is sent at all — while `orders` RLS is
   * `auth.uid() = user_id` in every configuration, so a guest can never see
   * their own order through the anon client. Without the number printed here
   * the order they just paid for could be untrackable. The session id in the
   * URL is the authorisation — unguessable, and only this browser holds it.
   *
   * The helper never throws (no database, no service-role key and query errors
   * all come back as `unavailable`), because a customer who has just been
   * charged must never meet an error screen.
   */
  const lookup: OrderConfirmationLookup = sessionId
    ? await getOrderConfirmationSummary(sessionId)
    : { state: "unavailable" };

  // `missing` is the one state where confirmation must not be claimed: the
  // money moved at Stripe and nothing here recorded it. It is deliberately
  // distinct from `unavailable` — "we could not look it up" is not evidence
  // that no order exists, and saying so would be a fresh false claim.
  const view = orderView(lookup);
  const orderMissing = view.kind === "missing";
  const numberPending = view.kind === "pending";
  const orderNumber = view.kind === "number" ? view.orderNumber : null;
  // Confirmation is claimed only when this page has actually SEEN the order —
  // never on the strength of Stripe's payment_status alone (WORKLOG §0.5:
  // money taken, nothing recorded, page still says "order confirmed"). A
  // failed lookup is not evidence either way, so it too gets the hedged
  // "payment received" wording rather than a confirmation.
  const orderSeen = view.kind === "number" || view.kind === "pending";
  const confirmed = paid && orderSeen;

  const thanks = firstName ? `Thanks ${firstName} — ` : "Thanks — ";

  return (
    <div className="wrap max-w-3xl pt-12">
      {/* Clearing is safe here: checkout completed, so the basket is spent. */}
      <ClearCartOnMount />

      <div className="mb-8 flex flex-col items-center text-center">
        <span
          className={`flex h-20 w-20 items-center justify-center rounded-full ${
            confirmed ? "bg-good-soft text-good" : "bg-cream text-muted"
          }`}
        >
          <Icon
            name={confirmed ? "check" : "clock"}
            size={36}
            strokeWidth={2.4}
          />
        </span>
        <h1 className="mt-5 mb-2 text-3xl md:text-[34px]">
          {paid
            ? // "Payment received" whenever no order has been seen here — the
              // money is Stripe's fact, the order is ours, and only the second
              // one can confirm anything.
              `${thanks}${orderSeen ? "order confirmed!" : "payment received"}`
            : `${thanks}payment is processing`}
        </h1>
        <p className="text-muted">
          {/*
            This headline paragraph promises no email in any configuration.
            Whether one is coming is decided by the Resend secrets and stated
            once, in the order-number card below, where it can be gated on
            SENDS_CONFIRMATION. Nothing anywhere sends a dispatch or tracking
            notice. The order number is what the customer is pointed at, because
            it is the one thing that is true either way.
          */}
          {paid ? (
            orderMissing ? (
              <>
                Stripe has your payment. We can&apos;t see an order for it here
                yet — the note below says what happens now.
              </>
            ) : orderNumber ? (
              <>Your payment went through, and your order number is below.</>
            ) : numberPending ? (
              <>
                Your payment went through. Your order number is the next thing
                to appear on this page.
              </>
            ) : (
              <>
                Your payment went through. We can&apos;t show your order number
                just now — the note below says what to do.
              </>
            )
          ) : (
            <>
              Your payment method settles over a day or two. Printing starts the
              moment it clears — nothing to do in the meantime.
            </>
          )}
        </p>
      </div>

      <OrderNumberCard view={view} paid={paid} email={email} />

      <div className="card mb-6 p-7">
        <div className="mb-7 flex justify-between">
          {STEPS.map((step, i) => (
            <div
              key={step}
              className="relative flex flex-1 flex-col items-center gap-2.5"
            >
              {i < STEPS.length - 1 ? (
                <span className="absolute top-4 left-[calc(50%+22px)] right-[calc(-50%+22px)] h-0.5 bg-line" />
              ) : null}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold ${
                  i === 0 && confirmed
                    ? "bg-good text-white"
                    : "border border-line2 bg-surface text-faint"
                }`}
              >
                {/* Ticked on `confirmed`, not on `paid`: a payment Stripe took
                    that no order here records has not reached this stage. */}
                {i === 0 && confirmed ? (
                  <Icon name="check" size={15} strokeWidth={2.6} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-[12.5px] font-extrabold ${i === 0 && confirmed ? "text-ink" : "text-faint"}`}
              >
                {step}
              </span>
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2.5 rounded-xl bg-cream px-4 py-3.5 text-[13.5px] text-muted">
          <Icon name="box" size={18} className="mt-px shrink-0" />
          <span>
            {/* No dispatch or tracking notification is sent by anything in this
                codebase, in any configuration — the order confirmation is the
                only mail the shop sends, and it says the same thing. So the old
                "tracking lands in your inbox" promise is gone rather than
                gated: there is no configuration in which it would be true. */}
            Your pieces are <b className="text-ink">printed to order</b> —
            {paid ? " printing" : " once payment clears, printing"} takes{" "}
            {PRINT_LEAD_TIME.label} before anything is posted. Check where
            it&apos;s up to any time at{" "}
            <Link
              href="/track"
              className="font-bold text-accent underline underline-offset-2"
            >
              Track your order
            </Link>
            .
          </span>
        </p>
      </div>

      {items.length > 0 ? (
        <div className="card mb-6 p-6">
          <b className="text-[15px]">Your order</b>
          <div className="mt-2">
            {items.map((item, i) => (
              <div
                key={`${item.name}-${i}`}
                className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
              >
                <ProductImage
                  art={(item.art as ArtKey) ?? "macaron"}
                  tint={(item.tint as Tint) ?? "cream"}
                  alt=""
                  size={48}
                  rounded="rounded-lg"
                />
                <div className="min-w-0 flex-1 text-[13.5px]">
                  <b>{item.name}</b>
                  {item.variant ? (
                    <p className="text-[12.5px] text-muted">{item.variant}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[13.5px]">
                  {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {money(item.unit_price ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {total !== null ? (
            <div className="flex justify-between pt-4 text-[15px]">
              <b>{paid ? "Total paid" : "Total due"}</b>
              <b>{money(total)} AUD</b>
            </div>
          ) : null}
        </div>
      ) : null}

      {shippingLine ? (
        <div className="card mb-7 flex items-start gap-3 p-5 text-[13.5px]">
          <Icon name="pin" size={17} className="mt-0.5 shrink-0" />
          <div>
            <b>Delivering to</b>
            <p className="mt-1 text-muted">{shippingLine}</p>
          </div>
        </div>
      ) : null}

      <div className="card mb-7 flex flex-col items-center gap-4 bg-lilac p-6 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <b className="text-[15px]">Create an account in one click</b>
          {/* Not "track this order": a guest order is staged with a null
              user_id and nothing links it to an account created afterwards,
              so signing up would not put this order in the account list. The
              order number above is what tracks THIS order. */}
          <p className="mt-1 text-[13px] text-muted">
            Save your details, reorder favourites and keep future orders in one
            place.
          </p>
        </div>
        <ButtonLink href="/signup" variant="dark" size="sm">
          Create account
        </ButtonLink>
      </div>

      <div className="flex flex-wrap justify-center gap-3.5">
        <ButtonLink href="/shop">Continue shopping</ButtonLink>
        <ButtonLink href="/track" variant="ghost">
          Track this order
        </ButtonLink>
      </div>

      {/* The reply-time promise is gone rather than gated: a reply is written by
          a person, and nothing here measures or guarantees a turnaround. The
          contact form cannot even deliver the enquiry unless the Resend secrets
          and a studio mailbox are both set (it says so on submit). Quoting the
          order number is the part we can stand behind. */}
      <p className="mt-5 text-center text-[13px] text-muted">
        Questions?{" "}
        <Link href="/contact" className="text-accent underline underline-offset-2">
          {canReachStudio ? `Contact ${SHOP.name}` : "See how to reach us"}
        </Link>
        {canReachStudio && orderNumber ? " and quote your order number." : "."}
      </p>

      {!sessionId ? (
        <p className="mt-6 text-center text-[13px] text-faint">
          <Pill tone="neutral">No checkout session found</Pill>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The order number, and the honest alternative when there isn't one yet.
 *
 * This card is the remedy for WORKLOG §0.1 on this page. A guest is sent no
 * email and cannot read their own order row (RLS is `auth.uid() = user_id`),
 * so unless the number is printed here the order they have just paid for
 * cannot be tracked at all. Every branch states only what is known: no number
 * is ever invented, and a lookup that failed is never dressed up as "no such
 * order".
 */
function OrderNumberCard({
  view,
  paid,
  email,
}: {
  view: OrderView;
  paid: boolean;
  /**
   * The email address Stripe collected, shown so the customer has BOTH halves
   * of what /track asks for. It comes from the checkout session this page
   * already reads — never from a second admin query, whose column list is
   * deliberately order number and status only.
   */
  email: string | null;
}) {
  if (view.kind === "number") {
    const orderNumber = view.orderNumber;
    return (
      <div className="card mb-6 bg-good-soft p-6 text-center">
        <b className="text-[12.5px] font-extrabold tracking-wider text-muted uppercase">
          Your order number
        </b>
        <p className="mt-2 font-mono text-3xl font-extrabold tracking-[0.14em] text-ink select-all">
          {orderNumber}
        </p>
        <p className="mx-auto mt-3 max-w-md text-[13.5px] text-muted">
          This is the number to quote about your order. Save it — checking
          where the order is up to needs this number and the email you ordered
          with
          {email ? (
            <>
              , <b className="text-ink">{email}</b>
            </>
          ) : null}
          .
          {/* The one email-shaped statement left on the page, and the only one
              that may mention the confirmation email — gated on the same
              secrets the webhook checks, never on a separate flag, because a
              denial printed while the mail is going out is a lie to someone who
              has just been charged. The send is queued after the response and
              can fail, so the true branch never says the email has arrived and
              never makes it the way to track the order. */}
          {SENDS_CONFIRMATION
            ? " We also email this to you, along with what you ordered. If it does not turn up, this page and the tracking page are how you check on your order — you do not need the email."
            : " We don't send order emails, so this page and the tracking page are how you check on it."}
        </p>
        <div className="mt-4 flex justify-center">
          <ButtonLink href="/track" variant="dark" size="sm">
            Track this order
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (view.kind === "pending") {
    // Paid (or settling) with no number yet. Order numbers are allocated by
    // the Stripe webhook on payment, not at checkout, so beating the webhook
    // back to this page is normal — it is not an error and must not read as
    // one.
    return (
      <div className="card mb-6 p-6 text-center">
        <b className="text-[15px]">Your order number is still being allocated</b>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted">
          {paid
            ? "Your order is here, and the number is issued once Stripe confirms the payment — usually within a few moments. Refresh this page and it should appear above, ready to use at "
            : "The number is issued when your payment settles, which takes a day or two on this payment method. Come back to this page then and it should appear above, ready to use at "}
          <Link
            href="/track"
            className="font-bold text-accent underline underline-offset-2"
          >
            Track your order
          </Link>{" "}
          with the email you ordered with. Still nothing after a few hours?{" "}
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            {canReachStudio ? "Tell us" : "See how to reach us"}
          </Link>
          {canReachStudio ? " and we'll sort it out." : "."}
        </p>
      </div>
    );
  }

  if (view.kind === "missing") {
    // Stripe has the money and we have no order for it — WORKLOG §0.5's
    // failure, reached here rather than hidden behind "order confirmed".
    return (
      <div className="card mb-6 p-6 text-center">
        <b className="text-[15px]">We can&apos;t see an order for this payment</b>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted">
          Your payment is recorded with Stripe, but no order for it has reached
          us yet, so there is no order number to show and nothing has gone to
          print. Refresh this page in a minute; if it still says this, please
          don&apos;t pay again —{" "}
          {/* The remedy is only real if there is a channel to ask through, so
              it is gated the same way /track gates "message us". With none, the
              customer is at least told not to pay twice and where any channel
              we open will be listed. */}
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            {canReachStudio ? "get in touch" : "see how to reach us"}
          </Link>
          {canReachStudio
            ? " with the email you paid with and we'll put it right."
            : ". Your payment is safe with Stripe either way."}
        </p>
      </div>
    );
  }

  // `unavailable`: no database, no service-role key, or the lookup errored.
  // Saying "no order matches" here would be a guess, and a false one whenever
  // the order exists — exactly the class of claim this page is being fixed
  // for. So it says what is actually true: we cannot tell right now.
  return (
    <div className="card mb-6 p-6 text-center">
      <b className="text-[15px]">Your order number isn&apos;t showing yet</b>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] text-muted">
        We can&apos;t reach our order records from this page just now, so we
        can&apos;t show you the number. Your payment is recorded with Stripe.
        Try this page again shortly
        {canReachStudio ? ", or " : "."}
        {canReachStudio ? (
          <>
            <Link
              href="/contact"
              className="font-bold text-accent underline underline-offset-2"
            >
              get in touch
            </Link>{" "}
            with the email you paid with and we&apos;ll sort it out.
          </>
        ) : (
          <>
            {" "}
            The{" "}
            <Link
              href="/contact"
              className="font-bold text-accent underline underline-offset-2"
            >
              contact page
            </Link>{" "}
            lists any way to reach us as soon as we have one.
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Reached by opening the success URL without a completed payment — or without
 * being able to tell. Nothing is confirmed on either branch, and crucially
 * <ClearCartOnMount /> is NOT rendered, so the basket is still there when they
 * go back.
 */
function NotPaid({
  hasSession,
  checked,
  throttled = false,
}: {
  hasSession: boolean;
  /**
   * Did Stripe actually answer? True only when `checkout.sessions.retrieve`
   * returned and said the session was not paid. False when the call threw —
   * a network blip, an expired key, a Stripe incident — in which case we know
   * nothing about the payment and must not deny one. Someone whose card HAS
   * been charged can land here, and telling them no money was taken is a false
   * statement to a customer who is out of pocket.
   */
  checked: boolean;
  /**
   * Did the rate limit above stop us asking Stripe at all?
   *
   * Kept apart from `checked` because the two are different facts and the copy
   * has to match: `checked: false` on its own means we tried Stripe and could
   * not reach it, and saying that here would be untrue — we never tried. The
   * remedy differs too. A Stripe outage is "try again in a few minutes"; this
   * clears on its own in under a minute and the only thing to do is stop
   * refreshing.
   */
  throttled?: boolean;
}) {
  const unconfirmable = hasSession && !checked;
  return (
    <div className="wrap max-w-2xl pt-14 pb-8">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-cream text-muted">
          <Icon name={unconfirmable ? "help" : "bag"} size={36} strokeWidth={1.8} />
        </span>
        <h1 className="mt-5 mb-2 text-3xl">
          {!hasSession
            ? "No order to show"
            : throttled
              ? "Just a moment"
              : unconfirmable
                ? "We couldn't check this order"
                : "This order wasn't completed"}
        </h1>
        <p className="max-w-md text-muted">
          {throttled ? (
            // Says only what is true: we did not ask, so we do not know. It
            // never denies a payment and never suggests paying again.
            <>
              This page has been checked a lot in the last minute, so we&apos;ve
              paused looking your order up. Nothing is wrong and nothing is
              lost — if you were charged, Stripe has the payment. Wait about a
              minute, then reload this page and your order details will be
              here. Your basket is exactly as you left it in the meantime.
            </>
          ) : !hasSession ? (
            // No "check your email for the receipt": the confirmation email is
            // only sent for an order that was actually paid for, and there is
            // no session here to say one was. The contact line below is the
            // real route.
            <>
              We couldn&apos;t find a checkout to confirm. This page only works
              from the link Stripe returns you to after paying.
            </>
          ) : unconfirmable ? (
            // Deliberately says nothing about whether money moved, because we
            // do not know. It also does not tell them to pay again.
            <>
              We couldn&apos;t reach Stripe to check this checkout, so we
              can&apos;t tell you whether a payment went through. If you were
              charged, Stripe has the payment and nothing is lost — please
              don&apos;t pay again. Try this page again in a few minutes. Your
              basket is exactly as you left it in the meantime.
            </>
          ) : (
            <>
              No payment was taken, so there&apos;s nothing to confirm yet. Your
              basket is exactly as you left it.
            </>
          )}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          <ButtonLink href="/cart">Back to your basket</ButtonLink>
          <ButtonLink href="/shop" variant="ghost">
            Keep shopping
          </ButtonLink>
        </div>
        {/* Same gate as the cards above: "tell us and we'll sort it out" is
            only true while there is somewhere to tell. */}
        <p className="mt-6 text-[13px] text-muted">
          Charged but seeing this?{" "}
          <Link
            href="/contact"
            className="text-accent underline underline-offset-2"
          >
            {canReachStudio ? "Tell us" : "See how to reach us"}
          </Link>
          {canReachStudio ? " and we'll sort it out." : "."}
        </p>
      </div>
    </div>
  );
}
