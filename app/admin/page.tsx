import Link from "next/link";
import { can, requireStaff } from "@/lib/auth/staff";
import {
  getOpenOrders,
  getStudioAttention,
  getStudioSummary,
  type StudioAttention,
} from "./data";
import { NoRows, Panel } from "./ui";
import { AdminForm, SubmitButton } from "./AdminForm";
import { resolveRefundIncident } from "./actions";
import { Alert, ButtonLink, Icon, Pill } from "@/components/ui";
import { money, pluralise } from "@/lib/format";

/**
 * The studio overview.
 *
 * It shows what is true and nothing else. A shop that has never taken an order
 * says so; it does not draw an empty chart, and it does not display a zero
 * dressed up as a statistic. Everything on this page is a count from the
 * database at request time.
 */
// Without its own title a page falls back to the layout default, so seven
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Overview · Studio" };

export default async function AdminOverviewPage() {
  const staff = await requireStaff();

  // Packing only ever sees orders, so the tiles below would all be blank for
  // them. Send them where their work is.
  if (!can(staff.role, "catalogue")) {
    const orders = await getOpenOrders();
    return <OrderQueue orders={orders} heading="Orders waiting on you" />;
  }

  const [summary, orders, attention] = await Promise.all([
    getStudioSummary(),
    getOpenOrders(),
    getStudioAttention(),
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

      <NeedsAPerson attention={attention} />

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

/**
 * The three things that mean somebody has been charged, or somebody has been
 * left waiting, and only a person can put it right.
 *
 * Every one of them used to happen in silence.
 *
 *  - A payment landing on an order that had already been cancelled was a
 *    `console.error` in the webhook saying "refund this one by hand" and a 200
 *    to Stripe. The customer was charged, received nothing, and the only record
 *    was a line in a log nobody reads. The refund is still issued by hand in
 *    Stripe — that is a decision with a customer at the other end of it — but
 *    it is now a row here until she says it is done.
 *  - An order confirmation that never sent left no trace at all, and /track
 *    needs the order number that email carries.
 *  - An oversell was clamped to zero and never mentioned, so the count was
 *    quietly one short for ever.
 *
 * Nothing is drawn when there is nothing to say: this section is absent on an
 * ordinary day rather than being a row of reassuring zeroes.
 */
function NeedsAPerson({ attention }: { attention: StudioAttention }) {
  // Only meaningful on a shop that can send mail at all. `getStudioAttention`
  // reads lib/email's own predicate for that and reports 0 otherwise, so a shop
  // with no provider is not told it has a backlog of emails it was never going
  // to send.
  const awaitingMail = attention.ordersAwaitingConfirmation;
  const nothingToSay =
    attention.refundsOwed.length === 0 &&
    awaitingMail === 0 &&
    attention.oversoldUnits === 0;

  if (nothingToSay) return null;

  return (
    <section className="flex flex-col gap-4">
      {attention.refundsOwed.length > 0 ? (
        <Panel
          title="Refunds owed"
          note={`${pluralise(
            attention.refundsOwed.length,
            "payment",
          )} took money for an order that had already been cancelled. Nothing was printed, posted or emailed. Refund each one by hand in Stripe, then mark it here.`}
          padded={false}
        >
          <ul className="divide-y divide-line">
            {attention.refundsOwed.map((incident) => (
              <li
                key={incident.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5"
              >
                <span className="font-bold tabular-nums text-danger">
                  {money(incident.amountCents)}
                </span>
                <span className="text-[13px] text-muted">
                  {new Date(incident.noticedAt).toLocaleDateString("en-AU")}
                  {" · "}
                  <span className="font-mono">{incident.stripeSessionId}</span>
                </span>
                {incident.orderId ? (
                  <Link
                    href={`/admin/orders/${incident.orderId}`}
                    className="text-[13px] font-bold text-accent hover:text-accent-dark"
                  >
                    Open the order →
                  </Link>
                ) : null}
                <AdminForm action={resolveRefundIncident} className="ml-auto">
                  <input type="hidden" name="id" value={incident.id} />
                  <SubmitButton variant="soft" size="sm" pendingLabel="Marking…">
                    I have refunded this
                  </SubmitButton>
                </AdminForm>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {awaitingMail > 0 ? (
        <Alert>
          {pluralise(awaitingMail, "paid order")} {awaitingMail === 1 ? "has" : "have"}{" "}
          no confirmation email recorded against{" "}
          {awaitingMail === 1 ? "it" : "them"}. The webhook tries again on every
          delivery Stripe makes, so this usually clears itself — if it does not,
          those customers have no order number and cannot use /track.
        </Alert>
      ) : null}

      {attention.oversoldUnits > 0 ? (
        <Alert>
          <b>
            {pluralise(attention.oversoldUnits, "piece")} sold beyond what was on
            the shelf.
          </b>{" "}
          That is allowed — everything is printed to order — but these are the
          ones to print first:{" "}
          {attention.oversoldProducts
            .map((product) => `${product.name} (${product.units})`)
            .join(", ")}
          .
        </Alert>
      ) : null}
    </section>
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
