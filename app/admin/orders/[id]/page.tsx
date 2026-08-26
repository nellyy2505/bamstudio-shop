import { notFound } from "next/navigation";
import { can, requireStaff } from "@/lib/auth/staff";
import { formatDate, money, pluralise } from "@/lib/format";
import { Alert, Breadcrumbs, Field, Pill, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { setOrderStatus } from "../../actions";
import { CHANNEL_LABEL, PageHead, Panel, StatusPill, Unknown } from "../../ui";
import { getOrder, type OrderDetail, type OrderLine } from "../../data";

/**
 * One order, and the one thing a person does to it: move it along.
 *
 * The making cost of a line is only shown to a role that is allowed to see
 * costs. Packing is orders and nothing else — the person helping post parcels
 * has no business seeing the margin on what they are packing, and the column is
 * simply not rendered for them rather than being hidden with CSS.
 */

const STATUS_STEPS = [
  { value: "confirmed", label: "Confirmed — paid, not started" },
  { value: "printing", label: "Printing" },
  { value: "packed", label: "Packed — ready to post" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

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
            <Row label="Tracking">
              {order.trackingNumber ? (
                <span className="font-mono text-[13px] break-all select-all">
                  {order.trackingNumber}
                </span>
              ) : (
                <span className="text-muted">Not posted yet.</span>
              )}
            </Row>
            {order.giftNote ? <Row label="Gift note">{order.giftNote}</Row> : null}
          </dl>
        </Panel>
      </div>

      <Panel
        title="Move it along"
        note="Changing the status here is what the customer sees on the tracking page."
      >
        <AdminForm action={setOrderStatus}>
          <input type="hidden" name="id" value={order.id} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status" htmlFor="status">
              <select
                id="status"
                name="status"
                defaultValue={order.status}
                className={inputClass}
              >
                {STATUS_STEPS.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Tracking number"
              htmlFor="tracking_number"
              hint="From the Australia Post label. Leave it alone to keep the one already saved."
            >
              <input
                id="tracking_number"
                name="tracking_number"
                type="text"
                defaultValue={order.trackingNumber ?? ""}
                placeholder="33ABC123456789"
                className={inputClass}
              />
            </Field>
          </div>

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
