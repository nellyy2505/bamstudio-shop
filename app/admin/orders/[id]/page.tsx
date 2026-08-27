import { notFound } from "next/navigation";
import { can, requireStaff } from "@/lib/auth/staff";
import { formatDate, money, pluralise } from "@/lib/format";
import { Alert, Breadcrumbs, Field, Pill, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { setOrderStatus } from "../../actions";
import { CHANNEL_LABEL, PageHead, Panel, StatusPill, Unknown } from "../../ui";
import { DispatchPanel } from "./DispatchPanel";
import {
  getOrder,
  type OrderDetail,
  type OrderLine,
  type PaymentIncident,
} from "../../data";

/**
 * One order, and the two things a person does to it: move it along, and post
 * it.
 *
 * Those are deliberately two panels with two buttons. "Move it along" is the
 * everyday ladder and is cheap to undo; posting a parcel is a one-way event in
 * the physical world, it is the only change a customer is shown as a new fact,
 * and it is the only one carrying a second piece of information — the tracking
 * number. See DispatchPanel.tsx and `markShipped` for the argument.
 *
 * The making cost of a line is only shown to a role that is allowed to see
 * costs. Packing is orders and nothing else — the person helping post parcels
 * has no business seeing the margin on what they are packing, and the column is
 * simply not rendered for them rather than being hidden with CSS.
 */

/*
 * `shipped` is not here. It is not a step somebody types into a dropdown, it is
 * what "Post this parcel" below records — together with the tracking number, in
 * one write. `setOrderStatus` rejects it as well, because a select element is
 * markup and a server action is a public endpoint.
 */
const STATUS_STEPS = [
  { value: "confirmed", label: "Confirmed — paid, not started" },
  { value: "printing", label: "Printing" },
  { value: "packed", label: "Packed — ready to post" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

// Without its own title a page falls back to the layout default, so seven
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Order · Studio" };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const staff = await requireStaff("orders");

  const { id } = await params;
  const order = await getOrder(id);
  if (!order) notFound();

  const showCosts = can(staff.role, "reports");
  const units = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  const reference = order.orderNumber ?? "This order";

  /*
   * A posted order can only go forwards from here. Dragging it back into the
   * workshop would leave its tracking number on a row the customer is shown as
   * still being printed, so that path is "Undo this dispatch" instead — which
   * removes the number in the same write. `setOrderStatus` refuses the
   * backwards move regardless of what this dropdown offers.
   */
  const steps =
    order.status === "shipped"
      ? STATUS_STEPS.filter((step) => step.value === "delivered" || step.value === "cancelled")
      : STATUS_STEPS;

  /*
   * "" when the order's own status is not on the list — a posted order, whose
   * step is recorded in the panel below. An empty default is safer than
   * silently preselecting the first option, which is how a posted parcel would
   * be knocked back to "confirmed" by somebody pressing the button without
   * touching the dropdown.
   */
  const currentStep = steps.some((step) => step.value === order.status) ? order.status : "";

  return (
    <div className="flex flex-col gap-7">
      <div>
        <Breadcrumbs
          items={[
            { label: "Studio", href: "/admin" },
            { label: "Orders", href: "/admin/orders" },
            { label: order.orderNumber ?? "Order" },
          ]}
        />
        <PageHead
          title={order.orderNumber ?? "Order"}
          subtitle={
            <>
              {formatDate(order.createdAt)} · {CHANNEL_LABEL[order.channel] ?? order.channel} ·{" "}
              {pluralise(order.lines.length, "line")} · {pluralise(units, "piece")}
            </>
          }
          actions={<StatusPill status={order.status} />}
        />
      </div>

      <RefundOwed incidents={order.openIncidents} />

      <Panel
        title="What was ordered"
        note={
          showCosts
            ? "Cost is what the piece cost to make at the moment it sold, not what it would cost today."
            : undefined
        }
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                <th className="px-5 py-3">PIECE</th>
                <th className="px-5 py-3 text-right">QTY</th>
                <th className="px-5 py-3 text-right">EACH</th>
                {showCosts ? <th className="px-5 py-3 text-right">COST EACH</th> : null}
                <th className="px-5 py-3 text-right">LINE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-5 py-3.5">
                    <span className="font-semibold">{line.productName}</span>
                    <LineNotes line={line} />
                  </td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{money(line.unitPrice)}</td>
                  {showCosts ? (
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {line.unitCostCents === null ? (
                        <Unknown what="Not measured" />
                      ) : (
                        money(line.unitCostCents)
                      )}
                    </td>
                  ) : null}
                  <td className="px-5 py-3.5 text-right font-bold tabular-nums">
                    {money(line.unitPrice * line.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="flex flex-col gap-2 border-t border-line px-5 py-4 text-[14px]">
          <Money label="Items" value={order.subtotal} />
          <Money label="Postage" value={order.shipping} />
          <div className="flex items-baseline justify-between border-t border-line pt-2">
            <dt className="font-extrabold">Paid</dt>
            <dd className="font-display text-[19px] font-semibold tabular-nums">
              {money(order.total)}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Where it goes">
          <AddressBlock order={order} />
        </Panel>

        <Panel title="Payment and delivery">
          <dl className="flex flex-col gap-3 text-[14px]">
            <Row label="Email">{order.email}</Row>
            <Row label="Channel">{CHANNEL_LABEL[order.channel] ?? order.channel}</Row>
            <Row label="Postage method">{order.shippingMethod.replace(/_/g, " ")}</Row>
            <Row label="Payment reference">
              {order.stripePaymentIntent ? (
                <span className="font-mono text-[13px] break-all select-all">
                  {order.stripePaymentIntent}
                </span>
              ) : order.recordedBy ? (
                <span className="text-muted">
                  Typed in by a person, so there is no Stripe payment to point at.
                </span>
              ) : (
                <span className="text-muted">None recorded.</span>
              )}
            </Row>
            {/*
              * Tracking used to be stated here as well, and read "Not posted
              * yet." whenever the column was null — which is a false statement
              * about a parcel that went as an untracked Large Letter, and is
              * the sort of thing two panels on one screen end up disagreeing
              * about. The dispatch panel below is now the only place on this
              * page that says anything about tracking, because it is the only
              * one that also knows the status the answer depends on.
              */}
            {order.giftNote ? <Row label="Gift note">{order.giftNote}</Row> : null}
          </dl>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Move it along"
          note="Where the work is up to. This is what the customer sees on the tracking page."
        >
          <AdminForm action={setOrderStatus}>
            <input type="hidden" name="id" value={order.id} />

            <Field
              label="Status"
              htmlFor="status"
              hint="Posting the parcel is the panel beside this one, so the tracking number is recorded at the same moment."
            >
              <select
                id="status"
                name="status"
                defaultValue={currentStep}
                required
                className={inputClass}
              >
                {currentStep === "" ? (
                  <option value="">Choose a step…</option>
                ) : null}
                {steps.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton pendingLabel="Updating…">Update this order</SubmitButton>
              <span className="text-[13px] text-muted">
                {reference} stays in the reports whatever you set here, unless it is cancelled.
              </span>
            </div>
          </AdminForm>

          <div className="mt-4">
            <Alert>
              An order cannot be put back to unpaid. That state belongs to the checkout, and
              writing to it by hand is how a paid order gets counted twice.
            </Alert>
          </div>
        </Panel>

        <DispatchPanel order={order} />
      </div>
    </div>
  );
}

/**
 * Money taken on this order that the shop owes back.
 *
 * THE DEFECT THIS CLOSES. `payment_incidents` (0005_sale_integrity.sql) records
 * a payment that cleared for an order somebody had already cancelled: the
 * customer was charged, the webhook correctly refused to number it, move its
 * stock or email them, and the refund is a manual job. It was surfaced on
 * /admin and nowhere else — so the order it happened to, which is the screen a
 * person is on when they decide whether to print and post something, gave no
 * hint that money was owed on it. Two people, or one person on a Tuesday,
 * could work this order without ever passing the overview.
 *
 * WHO SEES IT — the Packing question, decided.
 *
 * Packing holds `orders` and nothing else, precisely so that the person helping
 * post parcels never sees a cost or a margin. This panel is shown to them, and
 * the reasoning is that a refund owed is not a cost:
 *
 *  1. Every figure here is one Packing can already see on this page. The amount
 *     is what the customer was charged — the same number the "Paid" line prints
 *     two panels down. Nothing about what the piece cost to make appears; the
 *     COST EACH column above stays gated on `showCosts`, which is the line that
 *     actually protects the margin.
 *  2. It is a packing instruction before it is a finance one. The single thing
 *     this row means operationally is DO NOT POST THIS ORDER. Hiding it from
 *     the one role whose whole job is posting parcels would be hiding it from
 *     the person most likely to act on it wrongly — and a parcel that goes out
 *     on a refunded order costs the studio the postage, the filament and the
 *     piece.
 *  3. The shop already made this call: `resolveRefundIncident` in actions.ts is
 *     guarded by `orders`, the capability Packing holds. Rendering the fact to
 *     a narrower audience than the action that settles it would be inconsistent
 *     for no gain.
 *
 * What is deliberately NOT here is the "I have refunded this" control. It lives
 * on the studio overview, which is where the refund is actually reconciled, and
 * a second copy of it here would revalidate the wrong path and leave a button
 * that looks like it did nothing.
 *
 * The wording assumes the one `kind` the table's CHECK constraint allows today,
 * `paid_while_cancelled`. Adding a second kind means reading that column and
 * branching here — a sentence saying "nothing was printed, posted or emailed"
 * is only true of this one.
 */
function RefundOwed({ incidents }: { incidents: PaymentIncident[] }) {
  // Nothing to say on an ordinary order, and nothing drawn — no reassuring
  // "no refunds owed" panel, which is a claim about a table this page would
  // then have to keep true.
  if (incidents.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {incidents.map((incident) => (
        <Alert key={incident.id} tone="error">
          <b>
            {money(incident.amountCents)} was taken for this order and has not
            been refunded.
          </b>{" "}
          {/* `noticed_at` is when the webhook recorded it, not when the card
              cleared, and the two can differ by a retry — so it is worded as
              "noticed". `order_status` is the status the order was in at the
              moment the payment landed, which is the fact that makes this an
              incident; it is stated only when the column holds one. */}
          {incident.orderStatus
            ? `The payment landed when this order was already ${incident.orderStatus}`
            : "The payment landed on an order the shop could not honour"}
          , noticed {formatDate(incident.noticedAt)}, so it was never numbered,
          no stock moved and no confirmation went out.{" "}
          <b>Do not print or post it.</b> The refund is issued by hand in Stripe
          and marked off on the studio overview.
          {incident.detail ? <> {incident.detail}</> : null}
          <span className="mt-1 block font-mono text-[12.5px] break-all">
            {incident.stripeSessionId}
          </span>
        </Alert>
      ))}
    </div>
  );
}

function Money({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">{money(value)}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12.5px] font-extrabold tracking-[0.04em] text-faint">
        {label.toUpperCase()}
      </dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function LineNotes({ line }: { line: OrderLine }) {
  const personalisation = describePersonalisation(line.personalisation);
  const bits = [line.variantLabel, line.colour].filter(
    (bit): bit is string => typeof bit === "string" && bit.trim().length > 0,
  );

  if (bits.length === 0 && !personalisation) return null;

  return (
    <span className="mt-0.5 block text-[12.5px] text-muted">
      {bits.join(" · ")}
      {bits.length > 0 && personalisation ? " · " : ""}
      {personalisation ? <span className="font-semibold">{personalisation}</span> : null}
    </span>
  );
}

/**
 * Personalisation is jsonb and its shape has changed once already, so this
 * reads whatever is there rather than assuming a schema. Nothing is invented:
 * an empty value produces no line at all.
 */
function describePersonalisation(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((part) => String(part)).filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([key, v]) => `${key.replace(/_/g, " ")}: ${String(v)}`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return String(value);
}

/**
 * The address, read defensively. A sale typed in at a market has no address at
 * all — it carries a note instead — and saying so is better than printing five
 * blank lines.
 */
function AddressBlock({ order }: { order: OrderDetail }) {
  const address = order.shippingAddress;
  const get = (key: string): string => {
    const value = address[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const name = [get("first_name"), get("last_name")].filter(Boolean).join(" ");
  const lines = [
    name,
    get("line1"),
    get("line2"),
    [get("suburb"), get("state"), get("postcode")].filter(Boolean).join(" "),
  ].filter(Boolean);

  const phone = get("phone");
  const note = get("note");

  if (lines.length === 0) {
    return (
      <div className="flex flex-col gap-3 text-[14px]">
        <Pill tone="line">Nothing to post</Pill>
        <p className="text-muted">
          {note || "No address was collected, so this was handed over in person."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-[14px]">
      <address className="not-italic leading-relaxed">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </address>
      {phone ? <p className="text-muted">Phone {phone}</p> : null}
      {note ? <p className="text-muted">{note}</p> : null}
    </div>
  );
}
