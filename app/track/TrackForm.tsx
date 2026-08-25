"use client";

import Link from "next/link";
import { useState } from "react";
import { ProductImage } from "@/components/ProductArt";
import { Alert, Button, Field, Icon, Pill, inputClass } from "@/components/ui";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  transitDays,
  transitLabel,
} from "@/lib/config";
import { canReachStudio } from "@/lib/contact";
import { deliveryWindow, formatDate, money } from "@/lib/format";
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
  shipped: {
    label: "Shipped",
    body: "Handed to Australia Post. Tracking is live once they scan it in.",
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

type Status = "idle" | "searching" | "found" | "missing" | "error";

export function TrackForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [order, setOrder] = useState<TrackedOrder | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setStatus("searching");
    setOrder(null);

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

      if (body?.found && body.order) {
        setOrder(body.order as TrackedOrder);
        setStatus("found");
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
            {method?.label ?? order.shipping_method} post
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
                    {STEP_COPY[step].body}
                  </p>
                  {step === "shipped" && reached && order.tracking_number ? (
                    <p className="mt-1.5 text-[13.5px] font-extrabold">
                      Tracking: {order.tracking_number}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {!cancelled ? (
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
                {transitLabel(order.shipping_method) || "carrier transit"}.
                Estimates are not guarantees; Australia Post has its own
                opinions.
              </>
            )}
          </span>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="mt-6 border-t border-line pt-6">
          <h3 className="mb-4 text-[15px]">In this parcel</h3>
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
