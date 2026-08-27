import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/ProductArt";
import {
  ButtonLink,
  EmptyState,
  Icon,
  Pill,
  cx,
} from "@/components/ui";
import { formatDate, money, pluralise } from "@/lib/format";
import type { CartLine, Order, OrderItem, OrderStatus, Product } from "@/lib/types";
import { BuyAgainButton } from "./BuyAgainButton";
import { STATUS_LABEL, STATUS_TONE, firstOf, requireAccount } from "../data";

export const metadata: Metadata = {
  title: "Your orders",
  description: "Every Bam Studio order you've placed, and where each one is up to.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type ReorderProduct = Pick<
  Product,
  | "id"
  | "slug"
  | "short_name"
  | "price"
  | "art"
  | "tint"
  | "colours"
  | "attachments"
  | "is_personalised"
>;

type OrderItemRow = OrderItem & {
  products: ReorderProduct | ReorderProduct[] | null;
};

type OrderRow = Omit<Order, "items"> & { order_items: OrderItemRow[] };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "progress", label: "In progress" },
  { key: "delivered", label: "Delivered" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const IN_PROGRESS: OrderStatus[] = [
  "confirmed",
  "printing",
  "packed",
  "shipped",
];

const MAX_THUMBS = 4;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Re-orderable lines keep the colour and attachment that were actually
 * ordered (stored on the order item), but are priced at *today's* price —
 * the shopper reviews the basket before paying. Personalised lines are
 * skipped: the letters have to be chosen again in the builder.
 */
function reorderLines(items: OrderItemRow[]): Omit<CartLine, "key">[] {
  return items.flatMap((item) => {
    const product = firstOf(item.products);
    /*
     * A LUCKY SCOOP IS NOT RE-ORDERABLE HERE, and it drops out of this test
     * rather than needing one of its own: a scoop line has no `product_id`, so
     * the `products` embed is null and the line is skipped.
     *
     * That is the right answer and not merely a convenient one. "Buy again"
     * restores the exact variant that was ordered, and there is no such thing
     * for a scoop — the tier may since have been retired, re-priced or given a
     * different pool, and the one thing that certainly cannot be repeated is
     * the draw. Another scoop is bought from the tier page, where the price and
     * the pool are the current ones and `availability.sellable` is asked before
     * anything reaches a basket.
     */
    if (!product || product.is_personalised) return [];

    const attachments = product.attachments ?? [];
    const attachment =
      attachments.find((a) => a.id === item.attachment_id) ??
      attachments[0] ??
      null;
    const colour =
      product.colours?.find((c) => c.name === item.colour)?.name ??
      product.colours?.[0]?.name ??
      null;

    return [
      {
        product_id: product.id,
        slug: product.slug,
        name: product.short_name,
        art: product.art,
        tint: product.tint,
        colour,
        attachment_id: attachment?.id ?? null,
        attachment_label: attachment?.label ?? null,
        unit_price: product.price + (attachment?.price_delta ?? 0),
        quantity: item.quantity,
        is_personalised: false,
      },
    ];
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requested = one(params.status);
  const filter: FilterKey = FILTERS.some((f) => f.key === requested)
    ? (requested as FilterKey)
    : "all";

  const { supabase, user } = await requireAccount();

  let orders: OrderRow[] = [];
  try {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "*, order_items(*, products(id, slug, short_name, price, art, tint, colours, attachments, is_personalised))",
      )
      .eq("user_id", user.id)
      // 'pending' rows are unpaid checkouts staged for the Stripe webhook.
      .neq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("account orders query failed:", error.message);
    } else {
      orders = (data ?? []) as OrderRow[];
    }
  } catch {
    // Database unreachable — fall through to the empty state below.
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={
          <span className="flex h-32 w-32 items-center justify-center rounded-[32px] bg-butter">
            <Icon name="box" size={52} strokeWidth={1.4} />
          </span>
        }
        title="No orders yet"
        body="Once you've ordered, every parcel and its printing progress shows up here."
      >
        <ButtonLink href="/shop">Shop the range</ButtonLink>
        <ButtonLink href="/builder" variant="ghost">
          <Icon name="sparkle" size={17} />
          Design your own
        </ButtonLink>
      </EmptyState>
    );
  }

  const visible = orders.filter((order) => {
    if (filter === "progress") return IN_PROGRESS.includes(order.status);
    if (filter === "delivered") return order.status === "delivered";
    return true;
  });

  return (
    <div>
      <h1 className="mb-1.5 text-3xl md:text-4xl">Your orders</h1>
      <p className="text-sm text-muted">
        {pluralise(orders.length, "order")} placed with us so far.
      </p>

      <div className="mt-6 mb-7 flex flex-wrap gap-2">
        {FILTERS.map((option) => {
          const on = option.key === filter;
          return (
            <Link
              key={option.key}
              href={
                option.key === "all"
                  ? "/account/orders"
                  : `/account/orders?status=${option.key}`
              }
              aria-current={on ? "page" : undefined}
              className={cx(
                "rounded-full px-4 py-2 text-[13.5px] font-extrabold transition-colors",
                on
                  ? "bg-ink text-white"
                  : "border border-line2 bg-surface text-muted hover:border-ink hover:text-ink",
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <h2 className="text-xl">Nothing in this view</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            No orders match that filter right now.
          </p>
          <Link
            href="/account/orders"
            className="mt-5 inline-block font-bold text-accent underline underline-offset-2"
          >
            Show all orders
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {visible.map((order) => {
            const items = order.order_items ?? [];
            const count = items.reduce((sum, item) => sum + item.quantity, 0);
            const thumbs = items.slice(0, MAX_THUMBS);
            const overflow = items.length - thumbs.length;
            const lines = reorderLines(items);

            return (
              <article key={order.id} className="card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <b className="font-display text-[17px]">
                      {order.order_number}
                    </b>
                    <p className="mt-0.5 text-[13px] text-muted">
                      Placed {formatDate(order.created_at)}
                    </p>
                  </div>
                  <Pill tone={STATUS_TONE[order.status]}>
                    {STATUS_LABEL[order.status]}
                  </Pill>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  {thumbs.map((item) => (
                    <ProductImage
                      key={item.id}
                      art={item.art}
                      tint={item.tint}
                      alt={item.product_name}
                      size={56}
                      rounded="rounded-xl"
                    />
                  ))}
                  {overflow > 0 ? (
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-cream text-[13px] font-extrabold text-muted">
                      +{overflow}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
                  <p className="text-[14px] text-muted">
                    {pluralise(count, "item")} ·{" "}
                    <b className="text-ink">{money(order.total)}</b>
                  </p>
                  <div className="flex flex-wrap gap-2.5">
                    <ButtonLink
                      href={`/account/orders/${order.id}`}
                      size="sm"
                      variant="ghost"
                    >
                      View order
                      <span className="sr-only"> {order.order_number}</span>
                    </ButtonLink>
                    {lines.length > 0 ? (
                      <BuyAgainButton
                        lines={lines}
                        orderNumber={order.order_number}
                      />
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
