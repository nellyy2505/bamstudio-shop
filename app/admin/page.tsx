import Link from "next/link";
import { can, requireStaff } from "@/lib/auth/staff";
import { getOpenOrders, getStudioSummary } from "./data";
import { NoRows } from "./ui";
import { ButtonLink, Icon, Pill } from "@/components/ui";
import { money } from "@/lib/format";

/**
 * The studio overview.
 *
 * It shows what is true and nothing else. A shop that has never taken an order
 * says so; it does not draw an empty chart, and it does not display a zero
 * dressed up as a statistic. Everything on this page is a count from the
 * database at request time.
 */
export default async function AdminOverviewPage() {
  const staff = await requireStaff();

  // Packing only ever sees orders, so the tiles below would all be blank for
  // them. Send them where their work is.
  if (!can(staff.role, "catalogue")) {
    const orders = await getOpenOrders();
    return <OrderQueue orders={orders} heading="Orders waiting on you" />;
  }

  const [summary, orders] = await Promise.all([
    getStudioSummary(),
    getOpenOrders(),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-3xl">Today in the studio</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Everything here needs a person, not a machine.
          </p>
        </div>
        <ButtonLink href="/admin/products/new" size="md">
          <Icon name="plus" size={18} />
          Add a product
        </ButtonLink>
      </div>

      <OrderQueue orders={orders} heading="Orders waiting on you" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          label="CATALOGUE"
          value={String(summary.productCount)}
          note={
            summary.toPrint > 0
              ? `${summary.toPrint} pieces short of your buffer`
              : "every product is stocked to its buffer"
          }
          href="/admin/products"
          linkLabel="Manage products"
        />
        <Tile
          label="FILAMENT COLOURS"
          value={String(summary.activeColourCount)}
          note={
            summary.colourCount === summary.activeColourCount
              ? "all offered in the shop"
              : `${summary.colourCount - summary.activeColourCount} turned off`
          }
          href="/admin/colours"
          linkLabel="Edit the palette"
        />
        <Tile
          label="TO PRINT"
          value={String(summary.toPrint)}
          note="to bring every product up to its buffer"
          href="/admin/inventory"
          linkLabel="Open inventory"
        />
      </div>

      {summary.noOrdersYet ? (
        <div className="card border-line2 bg-cream p-5 text-[13.5px] text-muted">
          <b className="text-ink">No orders yet.</b> Reports stay empty until the
          shop takes one — there is nothing to chart, and a chart of nothing is
          worse than no chart. Sales you make at a market or on TikTok can be
          typed in from the Orders page and they count the same.
        </div>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  note,
  href,
  linkLabel,
}: {
  label: string;
  value: string;
  note: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="card flex flex-col gap-2.5 p-5">
      <span className="text-[12.5px] font-extrabold tracking-[0.06em] text-faint">
        {label}
      </span>
      <span className="font-display text-[30px] leading-none font-semibold tabular-nums">
        {value}
      </span>
      <span className="text-[13.5px] text-muted">{note}</span>
      <Link href={href} className="text-[13.5px] font-bold text-accent hover:text-accent-dark">
        {linkLabel} →
      </Link>
    </div>
  );
}

const STATUS_TONE: Record<string, "accent" | "warn" | "neutral" | "good"> = {
  confirmed: "accent",
  printing: "warn",
  packed: "neutral",
  shipped: "good",
};

const CHANNEL_LABEL: Record<string, string> = {
  website: "Website",
  market_stall: "Market stall",
  tiktok: "TikTok Shop",
  shopee: "Shopee",
  other: "Other",
};

async function OrderQueue({
  orders,
  heading,
}: {
  orders: Awaited<ReturnType<typeof getOpenOrders>>;
  heading: string;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
        <h2 className="text-[17px]">{heading}</h2>
        {orders.length > 0 ? (
          <Pill tone="neutral">{orders.length} open</Pill>
        ) : null}
      </div>

      {orders.length === 0 ? (
        <NoRows>
          When an order is paid for it appears here, and stays until it has been
          printed, packed and posted.
        </NoRows>
      ) : (
        <ul className="divide-y divide-line">
          {orders.map((order) => (
            <li
              key={order.id}
              className="grid grid-cols-[128px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[128px_minmax(0,1fr)_130px_100px_auto]"
            >
              <span className="font-mono text-[13px] font-semibold">
                {order.orderNumber ?? "—"}
              </span>
              <span className="truncate text-[14.5px]">
                {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
                <span className="text-faint">
                  {" · "}
                  {CHANNEL_LABEL[order.channel] ?? order.channel}
                </span>
              </span>
              <span className="hidden sm:block">
                <Pill tone={STATUS_TONE[order.status] ?? "neutral"}>
                  {order.status}
                </Pill>
              </span>
              <span className="hidden font-bold tabular-nums sm:block">
                {money(order.total)}
              </span>
              <ButtonLink href={`/admin/orders/${order.id}`} variant="soft" size="sm">
                Open
              </ButtonLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
