import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImage } from "@/components/ProductArt";
import { Alert, ButtonLink, Icon, Pill, cx } from "@/components/ui";
import { SHIPPING, SHOP } from "@/lib/config";
import { formatDate, money, pluralise } from "@/lib/format";
import {
  ORDER_STATUS_FLOW,
  type Address,
  type Order,
  type OrderItem,
} from "@/lib/types";
import { STATUS_LABEL, STATUS_TONE, requireAccount } from "../../data";

export const metadata: Metadata = {
  title: "Order details",
  description: "The items, delivery details and printing progress for your order.",
  robots: { index: false, follow: false },
};

type Personalisation = {
  collection_name?: string;
  letters?: string;
  with_charm?: boolean;
};

type DetailItem = OrderItem & { personalisation: Personalisation | null };

type OrderRow = Omit<Order, "items"> & { order_items: DetailItem[] };

const STEP_CIRCLE = {
  done: "bg-good text-white",
  current: "border-2 border-good bg-surface text-good",
  todo: "border border-line2 bg-surface text-faint",
} as const;

const STEP_LABEL_TEXT = {
  done: "text-ink",
  current: "text-good",
  todo: "text-faint",
} as const;

/** Delivered means every step is behind us; a cancelled order has no progress. */
function stepIndex(status: Order["status"]): number {
  if (status === "delivered") return ORDER_STATUS_FLOW.length;
  if (status === "cancelled") return -1;
  return ORDER_STATUS_FLOW.indexOf(status);
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await requireAccount();

  let order: OrderRow | null = null;
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) console.error("account order query failed:", error.message);
    order = (data ?? null) as OrderRow | null;
  } catch {
    order = null;
  }

  if (!order) notFound();

  const items = order.order_items ?? [];
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const current = stepIndex(order.status);
  const address = order.shipping_address as Address | null;
  const method = SHIPPING.methods.find((m) => m.id === order.shipping_method);
  const printingStarted = order.status !== "confirmed";

  return (
    <div>
      <Link
        href="/account/orders"
        className="mb-5 inline-flex items-center gap-2 text-[13.5px] font-bold text-muted hover:text-ink"
      >
        <Icon name="back" size={16} />
        All orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl">{order.order_number}</h1>
          <p className="mt-1.5 text-sm text-muted">
            Placed {formatDate(order.created_at)} · {pluralise(count, "item")}
          </p>
        </div>
        <Pill tone={STATUS_TONE[order.status]}>
          {STATUS_LABEL[order.status]}
        </Pill>
      </div>

      <section className="card mt-7 p-5 sm:p-6" aria-label="Order progress">
        <ol className="flex items-start">
          {ORDER_STATUS_FLOW.map((step, index) => {
            const state =
              index < current ? "done" : index === current ? "current" : "todo";
            return (
              <li
                key={step}
                className="flex flex-1 flex-col items-center text-center"
              >
                <div className="flex w-full items-center">
                  <span
                    className={cx(
                      "h-0.5 flex-1 rounded-full",
                      index === 0
                        ? "bg-transparent"
                        : index <= current
                          ? "bg-good"
                          : "bg-line",
                    )}
                  />
                  <span
                    className={cx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold",
                      STEP_CIRCLE[state],
                    )}
                  >
                    {state === "done" ? (
                      <Icon name="check" size={15} strokeWidth={2.6} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span
                    className={cx(
                      "h-0.5 flex-1 rounded-full",
                      index === ORDER_STATUS_FLOW.length - 1
                        ? "bg-transparent"
                        : index < current
                          ? "bg-good"
                          : "bg-line",
                    )}
                  />
                </div>
                <span
                  className={cx(
                    "mt-2 text-[12.5px] font-bold",
                    STEP_LABEL_TEXT[state],
                  )}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  {STATUS_LABEL[step]}
                </span>
              </li>
            );
          })}
        </ol>

        {order.status === "cancelled" ? (
          <div className="mt-5">
            <Alert tone="error">
              This order was cancelled — nothing was printed or posted.
            </Alert>
          </div>
        ) : null}
      </section>

      <div className="mt-7 grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="card p-5 sm:p-6" aria-label="Items in this order">
          <b className="font-display text-[17px]">Items</b>
          <div className="mt-3 border-t border-line">
            {items.map((item) => (
              <div key={item.id} className="flex gap-4 border-b border-line py-4">
                <ProductImage
                  art={item.art}
                  tint={item.tint}
                  alt={item.product_name}
                  size={68}
                  rounded="rounded-xl"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-4">
                    <b className="text-[14.5px]">{item.product_name}</b>
                    <b className="shrink-0 text-[14.5px]">
                      {money(item.unit_price * item.quantity)}
                    </b>
                  </div>
                  {item.variant_label ? (
                    <p className="mt-0.5 text-[13px] text-muted">
                      {item.variant_label}
                    </p>
                  ) : null}
                  {item.personalisation?.letters ? (
                    <p className="mt-1 text-[13px] text-accent-dark">
                      Personalised:{" "}
                      <b className="tracking-[0.18em]">
                        {item.personalisation.letters}
                      </b>
                      {item.personalisation.collection_name
                        ? ` · ${item.personalisation.collection_name}`
                        : ""}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[12.5px] text-faint">
                    Qty {item.quantity} · {money(item.unit_price)} each
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-col gap-3 text-[14.5px]">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span>{money(order.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">
                Delivery{method ? ` · ${method.label}` : ""}
              </span>
              <span className={order.shipping === 0 ? "font-extrabold text-good" : ""}>
                {order.shipping === 0 ? "FREE" : money(order.shipping)}
              </span>
            </div>
            <div className="flex justify-between border-t border-line pt-3.5 text-lg">
              <b>Total</b>
              <b>{money(order.total)} AUD</b>
            </div>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          {order.tracking_number ? (
            <section className="card p-5 sm:p-6" aria-label="Tracking">
              <b className="flex items-center gap-2 font-display text-[15.5px]">
                <Icon name="truck" size={17} />
                Tracking
              </b>
              <p className="mt-2 font-mono text-[14px] break-all">
                {order.tracking_number}
              </p>
              <div className="mt-4">
                <ButtonLink href="/track" size="sm" variant="soft" full>
                  Track this parcel
                </ButtonLink>
              </div>
            </section>
          ) : null}

          <section className="card p-5 sm:p-6" aria-label="Delivery address">
            <b className="flex items-center gap-2 font-display text-[15.5px]">
              <Icon name="pin" size={17} />
              Delivery address
            </b>
            {address ? (
              <address className="mt-2.5 text-[14px] text-muted not-italic">
                <span className="block font-bold text-ink">
                  {address.first_name} {address.last_name}
                </span>
                <span className="block">{address.line1}</span>
                {address.line2 ? <span className="block">{address.line2}</span> : null}
                <span className="block">
                  {address.suburb} {address.state} {address.postcode}
                </span>
                {address.phone ? <span className="block">{address.phone}</span> : null}
              </address>
            ) : (
              <p className="mt-2.5 text-[14px] text-muted">
                No delivery address on this order.
              </p>
            )}
          </section>

          <section className="card p-5 sm:p-6" aria-label="Payment">
            <b className="flex items-center gap-2 font-display text-[15.5px]">
              <Icon name="card" size={17} />
              Payment
            </b>
            <p className="mt-2.5 text-[14px] text-muted">
              {money(order.total)} AUD paid at checkout. Card details go
              straight to Stripe, so we never see or store them.
            </p>
            <p className="mt-2 text-[13px] text-faint">
              Receipt sent to {order.email}
            </p>
          </section>

          {order.gift_note ? (
            <section className="card p-5 sm:p-6" aria-label="Gift note">
              <b className="flex items-center gap-2 font-display text-[15.5px]">
                <Icon name="gift" size={17} />
                Gift note
              </b>
              <p className="mt-2.5 text-[14px] text-muted">{order.gift_note}</p>
            </section>
          ) : null}
        </div>
      </div>

      {order.status === "cancelled" ? null : (
        <div className="mt-6">
          <Alert tone="info">
            {printingStarted
              ? `Printing has already started on this order, so it can no longer be changed here — email ${SHOP.supportEmail} and we'll see what's possible.`
              : `Need to change something? Orders can be edited or cancelled right up until printing starts — email ${SHOP.supportEmail}.`}
          </Alert>
        </div>
      )}
    </div>
  );
}
