"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductImage } from "@/components/ProductArt";
import { Alert, Button, Field, Icon, Pill, inputClass } from "@/components/ui";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  transitDays,
  transitRangeLabel,
} from "@/lib/config";
import { canReachStudio } from "@/lib/contact";
import { deliveryWindow, formatDate, money, pluralise } from "@/lib/format";
import { ORDER_STATUS_FLOW } from "@/lib/types";
import type { OrderStatus, PublicTrackedOrder } from "@/lib/types";

/**
 * The API allow-lists the fields it publishes, so the browser type is the
 * published shape itself — notably it carries no `phone`, which this page has
 * never rendered and must not start rendering.
 */
type TrackedOrder = PublicTrackedOrder;

/*
 * `canReachStudio` — is there a mailbox or a social account behind "send us the
 * order number and we will find it" — is imported from lib/contact.ts. It is
 * built from NEXT_PUBLIC_ config only, so it is identical on the server and in
 * the browser and is safe in this client component.
 *
 * Nothing on this page depends on whether the shop can SEND email, so no
 * capability prop is threaded in from /track. If a claim about email is ever
 * added here, it must arrive as a prop from the server page — reading the
 * secrets in the browser is the skew this codebase was just cleaned of.
 */

const STEP_COPY: Record<OrderStatus, { label: string; body: string }> = {
  // Unpaid checkouts are excluded by lookup_order, so this never renders.
  pending: {
    label: "Awaiting payment",
    body: "This checkout was never completed.",
  },
  confirmed: {
    label: "Confirmed",
    body: "Payment received and your order joined the print queue.",
  },
  printing: {
    label: "Printing",
    body: `On the printer now — printing runs ${PRINT_LEAD_TIME.label} before anything is dispatched.`,
  },
  packed: {
    label: "Packed",
    body: "Trimmed, checked by hand and bagged with its backing card.",
  },
  /*
   * This used to read "Handed to Australia Post. Tracking is live once they
   * scan it in." — an unconditional promise of a tracking number, printed to
   * every shipped order. It is not true for every parcel: `quoteBasket()`
   * returns `tracked: false` for a Large Letter, `transitLabel()` takes
   * tracking as a required argument precisely so nothing hardcodes the word,
   * and the studio's dispatch panel has an explicit "posted without tracking"
   * answer. /track stands in for a confirmation email the shop may not be able
   * to send, so this was the worst place in the shop to promise a number that
   * may never exist. The step now states only what is true of every dispatch;
   * the number — or its absence — is rendered from the order's own
   * `tracking_number` below.
   */
  shipped: {
    label: "Shipped",
    body: "Handed to Australia Post.",
  },
  delivered: {
    label: "Delivered",
    body: "Marked as delivered by the carrier.",
  },
  cancelled: {
    label: "Cancelled",
    body: "This order was cancelled and nothing was printed.",
  },
};

/**
 * A sale typed in at a market is written straight to `delivered` with
 * `shipping_method` of `in_person` (`recordSale` in app/admin/actions.ts), and
 * it can be looked up here whenever a real email was taken at the stall. Two
 * steps then describe something that never happened — nothing was handed to
 * Australia Post and no carrier marked anything delivered — so they are read
 * off the method rather than assumed, exactly as the studio's own dispatch
 * panel does it.
 */
function isInPerson(order: TrackedOrder): boolean {
  return order.shipping_method === "in_person";
}

function stepBody(step: OrderStatus, order: TrackedOrder): string {
  if (isInPerson(order)) {
    if (step === "shipped") return "Handed over in person — nothing was posted.";
    if (step === "delivered") return "Handed over in person.";
  }
  return STEP_COPY[step].body;
}

/**
 * `missing` is a genuine miss. `throttled` and `invalid` are not: the route
 * answers 429 after ten attempts per IP per minute and 400 on input it cannot
 * parse, and both used to land in the not-found card, which asserts "it is
 * almost always a typo in the order number" and invites the customer to retype
 * into a limiter that will keep refusing. Australian mobile carriers NAT
 * heavily, so a customer's first ever attempt can be throttled by strangers
 * sharing their address. Each response now says what is actually true.
 */
type Status =
  | "idle"
  | "searching"
  | "found"
  | "missing"
  | "throttled"
  | "invalid"
  | "error";

export function TrackForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setStatus("searching");
    setOrder(null);
    setRetryAfter(null);

    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: String(data.get("orderNumber") ?? ""),
          email: String(data.get("email") ?? ""),
        }),
      });

      const body = await res.json().catch(() => null);

      if (res.ok && body?.found && body.order) {
        setOrder(body.order as TrackedOrder);
        setStatus("found");
        return;
      }

      // Branch on the status, not on `found`. Every response carries
      // `found: false`, including the two the route returns before it looks
      // anything up, so reading that field alone reported throttling and
      // unparseable input as "No order matched those details".
      if (res.status === 429) {
        const header = Number(res.headers.get("Retry-After"));
        setRetryAfter(Number.isFinite(header) && header > 0 ? header : null);
        setStatus("throttled");
        return;
      }
      if (res.status === 400) {
        setStatus("invalid");
        return;
      }
      setStatus("missing");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-7 sm:p-8">
        <h2 className="text-xl">Find your order</h2>
        {/* The order number comes off /order/confirmed, which prints it on the
            page — this must never send anyone to an email that is not sent,
            because the number is what makes this page usable at all. */}
        <p className="mt-1.5 text-[14.5px] text-muted">
          Use the order number from your confirmation page, plus the email
          address you ordered with. No account needed.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Order number"
              htmlFor="track-order"
              hint="Looks like BS-1042-9F3A."
            >
              <input
                id="track-order"
                name="orderNumber"
                type="text"
                required
                maxLength={40}
                autoComplete="off"
                placeholder="BS-1042-9F3A"
                className={inputClass}
              />
            </Field>

            <Field label="Email address" htmlFor="track-email">
              <input
                id="track-email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                className={inputClass}
              />
            </Field>
          </div>

          <div>
            <Button type="submit" size="lg" disabled={status === "searching"}>
              {status === "searching" ? "Looking…" : "Track order"}
              <Icon name="search" size={18} />
            </Button>
          </div>

          {status === "error" ? (
            <Alert tone="error">
              We could not reach the studio just now. Check your connection and
              try again.
            </Alert>
          ) : null}
        </form>
      </div>

      {status === "missing" ? <NotFoundCard /> : null}
      {status === "throttled" ? <ThrottledCard seconds={retryAfter} /> : null}
      {status === "invalid" ? <InvalidCard /> : null}
      {status === "found" && order ? <OrderResult order={order} /> : null}
    </div>
  );
}

function NotFoundCard() {
  return (
    <div className="card flex flex-col items-start p-7 sm:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cream">
        <Icon name="help" size={24} />
      </span>
      <h2 className="mt-4 text-xl">No order matched those details</h2>
      <p className="mt-2 max-w-[56ch] text-[14.5px] text-muted">
        Nothing to worry about yet — it is almost always a typo in the order
        number, or a different email address than the one used at checkout (a
        partner&apos;s, or the one attached to your payment account). Check both
        against your confirmation page and try again.
      </p>
      <p className="mt-3 max-w-[56ch] text-[14.5px] text-muted">
        {canReachStudio
          ? "Still nothing? Send us the order number and we will find it from our side."
          : "Still nothing? The contact page has the ways to reach us."}
      </p>
      <Link
        href="/contact"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
      >
        Contact the studio
        <Icon name="arrow" size={14} />
      </Link>
    </div>
  );
}

/**
 * 429. Nothing was looked up, so nothing may be said about the order — least
 * of all that it could not be found. The limit is ten attempts per IP per
 * minute and Australian mobile carriers put many customers behind one address,
 * so a first attempt really can be refused because of strangers; saying so is
 * kinder than implying the customer got their own order number wrong.
 */
function ThrottledCard({ seconds }: { seconds: number | null }) {
  return (
    <div className="card flex flex-col items-start p-7 sm:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cream">
        <Icon name="clock" size={24} />
      </span>
      <h2 className="mt-4 text-xl">Too many lookups just now</h2>
      <p className="mt-2 max-w-[56ch] text-[14.5px] text-muted">
        We did not check your order — this page limits how often it will look
        one up, and that limit counts everyone sharing your internet connection,
        which on a mobile network can be a lot of people. Nothing is wrong with
        your order or the details you typed.
      </p>
      <p className="mt-3 max-w-[56ch] text-[14.5px] text-muted">
        {seconds
          ? `Wait about ${pluralise(seconds, "second")} and try the same details again.`
          : "Wait about a minute and try the same details again."}
      </p>
      {canReachStudio ? (
        <Link
          href="/contact"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          Or contact the studio
          <Icon name="arrow" size={14} />
        </Link>
      ) : null}
    </div>
  );
}

/**
 * 400. The route rejected the body before any lookup — an order number under
 * three characters or over forty, or something that is not an email address.
 * Again: no search happened, so "no order matched" would be a claim about a
 * search that was never run.
 */
function InvalidCard() {
  return (
    <div className="card flex flex-col items-start p-7 sm:p-8">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-cream">
        <Icon name="help" size={24} />
      </span>
      <h2 className="mt-4 text-xl">We could not read those details</h2>
      <p className="mt-2 max-w-[56ch] text-[14.5px] text-muted">
        Nothing was looked up. The order number should look like BS-1042-9F3A,
        and the email address needs to be the full address you ordered with.
        Check both and try again.
      </p>
    </div>
  );
}

function OrderResult({ order }: { order: TrackedOrder }) {
  const flow = ORDER_STATUS_FLOW;
  const cancelled = order.status === "cancelled";
  const delivered = order.status === "delivered";

  // Delivered sits past the end of the flow; cancelled sits outside it.
  const currentIndex = cancelled
    ? -1
    : delivered
      ? flow.length
      : flow.indexOf(order.status);

  const inPerson = isInPerson(order);
  const method = SHIPPING.methods.find((m) => m.id === order.shipping_method);
  // Unknown methods fall back to standard inside the helper.
  const [transitMin, transitMax] = transitDays(order.shipping_method);
  const eta = deliveryWindow(transitMin, transitMax, new Date(order.created_at));
  const items = order.items ?? [];
  const address = order.shipping_address;

  return (
    <div className="card p-7 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <h2 className="text-xl">Order {order.order_number}</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            Placed {formatDate(order.created_at)} · {money(order.total)} ·{" "}
            {/* An in-person sale has no postage method, and printing
                "in_person post" both leaked a database value and described a
                parcel that never existed. */}
            {inPerson
              ? "handed over in person"
              : `${method?.label ?? order.shipping_method} post`}
          </p>
        </div>
        <Pill tone={cancelled ? "warn" : delivered ? "good" : "accent"}>
          {STEP_COPY[order.status]?.label ?? order.status}
        </Pill>
      </div>

      {cancelled ? (
        <div className="pt-6">
          <Alert tone="error">
            This order was cancelled and nothing was printed.
            {canReachStudio
              ? " If you did not ask for that, message us and we will sort it out."
              : ""}
          </Alert>
        </div>
      ) : (
        <ol className="pt-6">
          {flow.map((step, i) => {
            const done = i < currentIndex;
            const current = i === currentIndex;
            const reached = done || current;
            const last = i === flow.length - 1;

            return (
              <li key={step} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span
                    className={
                      done
                        ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-good text-white"
                        : current
                          ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-good bg-good-soft text-good"
                          : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line2 bg-surface text-faint"
                    }
                  >
                    {done ? (
                      <Icon name="check" size={17} strokeWidth={2.6} />
                    ) : current ? (
                      <Icon name="clock" size={17} />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-line2" />
                    )}
                  </span>
                  {!last ? (
                    <span
                      className={
                        done
                          ? "my-1 w-0.5 flex-1 rounded-full bg-good"
                          : "my-1 w-0.5 flex-1 rounded-full bg-line"
                      }
                    />
                  ) : null}
                </div>

                <div className={last ? "pb-0" : "pb-7"}>
                  <p
                    className={
                      reached
                        ? "font-display text-[15.5px] font-semibold text-good"
                        : "font-display text-[15.5px] font-semibold text-faint"
                    }
                  >
                    {STEP_COPY[step].label}
                    {current ? " — happening now" : ""}
                  </p>
                  <p className="mt-0.5 max-w-[52ch] text-[13.5px] text-muted">
                    {stepBody(step, order)}
                  </p>
                  {/* The tracking line is worded off this order's own
                      `tracking_number`, which the API allow-lists and which is
                      the only signal there is: `markShipped` is the sole writer
                      of the column and refuses a tracked dispatch with an empty
                      box, so a posted order with no number was posted without
                      one. The copy still speaks about the record rather than
                      the parcel, because a hand edit in the Supabase table
                      editor can break that invariant and nothing here would
                      know. */}
                  {step === "shipped" && reached && !inPerson ? (
                    order.tracking_number ? (
                      <p className="mt-1.5 text-[13.5px] font-extrabold">
                        Tracking: {order.tracking_number}
                      </p>
                    ) : (
                      <p className="mt-1.5 max-w-[52ch] text-[13.5px] text-muted">
                        No tracking number was recorded for this parcel — some
                        orders go by untracked letter post, so there is nothing
                        to follow.
                      </p>
                    )
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Nothing was posted for an in-person sale, so neither half of this box
          is true of one: there is no carrier transit to add to the print time
          and no post office to ask about a parcel that was handed over at a
          stall. */}
      {!cancelled && !inPerson ? (
        <div className="mt-2 flex items-start gap-2.5 rounded-xl bg-cream px-4 py-3 text-[13.5px] text-muted">
          <Icon name="truck" size={18} className="mt-px shrink-0" />
          <span>
            {delivered ? (
              <>
                Marked delivered. If it has not turned up, check with your local
                post office first, then tell us.
              </>
            ) : (
              <>
                Estimated arrival <b className="text-ink">{eta}</b> — printing
                ({PRINT_LEAD_TIME.label}) plus{" "}
                {transitRangeLabel(order.shipping_method) || "carrier transit"}.
                Estimates are not guarantees; Australia Post has its own
                opinions.
              </>
            )}
          </span>
        </div>
      ) : null}

      {/*
       * A LUCKY SCOOP RENDERS HERE WITH NO SPECIAL CASE, AND THAT IS A
       * DECISION rather than an oversight.
       *
       * A scoop line carries the TIER'S name in `product_name` and its promise
       * in `variant_label`, so it comes through this loop as "Pet scoop /
       * 5 pieces · Qty 1" — precisely what the customer bought, and everything
       * that was knowable at the moment they bought it. Nothing on this page has
       * to learn what a scoop is for that to be true.
       *
       * WHAT IS NOT SHOWN, AND WHY NOT HERE OF ALL PLACES. Once the studio
       * records the pack the pieces are known, and they stay off this page.
       * `lookup_order` (0001_init.sql) returns a fixed column list and that list
       * IS the security boundary: /track is reachable by anyone holding an order
       * number and the email it was placed with, and an order number is a public
       * sequence plus four hex characters. Every field added to that function is
       * a field a brute-forcer is handed too, and "what was in this person's
       * parcel" is not one to add — least of all for a page whose only throttle
       * is one process's memory (WORKLOG §0.I). The contents live in
       * `scoop_pack_items`, which 0007_lucky_scoop.sql keeps service_role in and
       * out, and the customer learns them the way the product intends: by
       * opening the parcel.
       */}
      {items.length > 0 ? (
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="mb-4 text-[15px]">
            {inPerson ? "What you bought" : "In this parcel"}
          </h3>
          <ul className="flex flex-col gap-3.5">
            {items.map((item, i) => (
              <li
                key={`${item.product_name}-${i}`}
                className="flex items-center gap-3.5"
              >
                <ProductImage
                  art={item.art}
                  tint={item.tint}
                  alt=""
                  size={52}
                  rounded="rounded-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-semibold">
                    {item.product_name}
                  </p>
                  <p className="text-xs text-muted">
                    {[item.variant_label, `Qty ${item.quantity}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-extrabold">
                  {money(item.unit_price * item.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {address ? (
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="mb-2 text-[15px]">Posting to</h3>
          <p className="text-[13.5px] text-muted">
            {address.first_name} {address.last_name}
            <br />
            {address.line1}
            {address.line2 ? (
              <>
                <br />
                {address.line2}
              </>
            ) : null}
            <br />
            {address.suburb} {address.state} {address.postcode}
          </p>
        </div>
      ) : null}

      <p className="mt-6 text-[13px] text-muted">
        Something look wrong?{" "}
        <Link
          href="/contact"
          className="font-bold text-accent underline underline-offset-2"
        >
          {canReachStudio ? "Message us" : "See how to reach us"}
        </Link>
        {canReachStudio ? " with the order number and we will take a look." : "."}
      </p>
    </div>
  );
}
