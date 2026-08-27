import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { SHOP } from "@/lib/config";
import { formatDate } from "@/lib/format";
import { Alert } from "@/components/ui";
import { PrintButton } from "../../PrintButton";
import {
  describePersonalisationText,
  getOrder,
  getOrderScoops,
  type OrderDetail,
  type OrderScoops,
} from "../../../data";

/**
 * The piece of paper that goes in the box.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES. There was no packing slip, so an order was read off a
 * screen and copied onto the parcel by hand. This shop sells custom name
 * charms: a letter transposed between the screen and the label is not a typo,
 * it is a remake, the filament and the postage both paid twice. So the
 * personalisation appears here EXACTLY as the customer typed it —
 * `describePersonalisationText` in data.ts is the one function that renders it,
 * shared with the pick list, because two screens formatting the same value two
 * ways is how the mistake gets made anyway.
 *
 * WHAT IS DELIBERATELY NOT ON IT.
 *
 *   * No money. Not the unit price, not the postage, not the total paid.
 *     Partly the obvious reason — a cost or a margin must never leave the
 *     studio, and `orders` is a capability Packing holds — but mostly two
 *     others. A great many of these parcels are gifts (the order carries a
 *     gift-note field), and a price list in a gift is a small unkindness the
 *     shop cannot take back. And a document listing goods and prices reads as a
 *     receipt: this shop is not GST-registered and has no ABN set, so a slip
 *     that looks like a tax invoice while being nothing of the sort is worse
 *     than a slip with no prices at all. There is a real trade — a customer who
 *     wants a receipt has to ask — and the footer says so where there is a
 *     mailbox to ask at.
 *   * No email address, no phone number, no payment reference. The parcel is
 *     addressed with a postal address; the rest is contact and payment data
 *     that has no job to do inside a box and every reason not to be printed,
 *     handled by a courier and left on a doorstep. A Stripe payment identifier
 *     on paper is a support-fraud kit.
 *   * No internal status, no tracking number, no staff name. None of it is the
 *     customer's, and none of it helps whoever is sealing the bag.
 *   * Nothing about any other order or any other customer.
 *
 * WHY ONE DOCUMENT AND NOT TWO. A bench copy with studio-only detail and a
 * customer copy without it would mean two prints and two chances to put the
 * wrong one in the bag. Everything above is instead chosen so that the single
 * sheet is safe for the customer to read: the personalisation is the thing she
 * has to check at the bench and the thing they want to verify, and it is the
 * same words either way.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Capability is `orders`, which Packing holds — packing a parcel is exactly
 * the job this page is for, and there is nothing on it a packer may not see.
 */

export const metadata = { title: "Packing slip · Studio" };

export default async function PackingSlipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("orders");

  const { id } = await params;
  const [order, scoops] = await Promise.all([getOrder(id), getOrderScoops(id)]);
  if (!order) notFound();

  /*
   * Two states that are not parcels. `pending` is a checkout somebody started
   * and never paid for — not an order at all — and a cancelled order is one
   * nobody should be packing. Checked here rather than only on the link that
   * got here, because a URL is typed as easily as it is clicked.
   */
  const notAParcel =
    order.status === "pending"
      ? "This is an unpaid checkout, not an order. Nothing should be packed for it."
      : order.status === "cancelled"
        ? "This order is cancelled, so there is nothing to pack."
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href={`/admin/orders/${order.id}`}
            className="text-[13.5px] font-bold text-accent hover:text-accent-dark"
          >
            ← Back to {order.orderNumber ?? "the order"}
          </Link>
          <h1 className="mt-1 text-2xl">Packing slip</h1>
        </div>
        <PrintButton>Print this slip</PrintButton>
      </div>

      {/*
        * THE TWO CASES WHERE NO SLIP IS DRAWN AT ALL, rather than drawn with a
        * warning stapled to it.
        *
        * The second is the refund guard. `payment_incidents` records money
        * taken for an order that was already cancelled: nothing was numbered,
        * no stock moved, and it must not be posted. The order screen shows the
        * same fact. Here it does more than warn, because the one way this page
        * can do harm is by handing somebody a tidy printed sheet that makes an
        * unpostable parcel look ready to go.
        */}
      {notAParcel ? (
        <Alert tone="error">{notAParcel}</Alert>
      ) : order.openIncidents.length > 0 ? (
        <Alert tone="error">
          <b>Do not post this order.</b> Money was taken for it after it was
          cancelled and has not been refunded, so no packing slip is printed for
          it. Open the order to see the detail and settle the refund first.
        </Alert>
      ) : (
        <article className="print-sheet card p-8">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-5">
            <div>
              <p className="font-display text-[22px] font-semibold">{SHOP.name}</p>
              <p className="text-[13px] text-muted">
                {SHOP.city}, {SHOP.country}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                PACKING SLIP
              </p>
              {/* The order number is what every later conversation about this
                  parcel will be keyed on, so it is the largest thing on the
                  page after the shop's name. Null on an order the webhook never
                  numbered — a dash, never an invented number. */}
              <p className="font-mono text-[20px] font-semibold">
                {order.orderNumber ?? "—"}
              </p>
              <p className="text-[13px] text-muted">
                Ordered {formatDate(order.createdAt)}
              </p>
            </div>
          </header>

          <section className="mt-6">
            <h2 className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
              WHERE IT GOES
            </h2>
            <SlipAddress order={order} />
          </section>

          <section className="mt-7">
            {/* No total piece count. A Lucky Scoop line's quantity is the
                number of BAGS, not the number of things in them, so any total
                this page could add up would be wrong on exactly the orders that
                most need checking. The per-line quantities are the count. */}
            <h2 className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
              IN THIS PARCEL
            </h2>

            <table className="mt-2.5 w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="w-14 py-2">QTY</th>
                  <th className="py-2">PIECE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {order.lines.map((line) => {
                  const personalisation = describePersonalisationText(line.personalisation);
                  // Colour and variant are words, not swatches. A swatch is a
                  // colour carrying meaning on its own, which a mono printer
                  // turns into an identical grey circle on every line.
                  const bits = [line.variantLabel, line.colour].filter(
                    (bit): bit is string => typeof bit === "string" && bit.trim().length > 0,
                  );

                  return (
                    <tr key={line.id} className="break-inside-avoid align-top">
                      <td className="py-3 font-semibold tabular-nums">{line.quantity} ×</td>
                      <td className="py-3">
                        <span className="font-semibold">{line.productName}</span>
                        {bits.length > 0 ? (
                          <span className="mt-0.5 block text-[13px] text-muted">
                            {bits.join(" · ")}
                          </span>
                        ) : null}
                        {personalisation ? (
                          /*
                            * Boxed, monospaced and left exactly as typed —
                            * including the capitals, the spacing and anything
                            * that looks like a mistake. It is not this page's
                            * job to tidy somebody's name, and "correcting" one
                            * is how the wrong charm gets made.
                            */
                          <span className="mt-1.5 block border border-line2 px-3 py-2 font-mono text-[14px] break-words whitespace-pre-wrap">
                            {personalisation}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <ScoopContents scoops={scoops} />

          {order.giftNote ? (
            <section className="mt-7 break-inside-avoid">
              <h2 className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                GIFT NOTE — COPY THIS ONTO THE CARD
              </h2>
              <p className="mt-2 border border-line2 px-4 py-3 text-[14.5px] break-words whitespace-pre-wrap">
                {order.giftNote}
              </p>
            </section>
          ) : null}

          <footer className="mt-8 border-t border-line pt-4 text-[13px] text-muted">
            <p>
              Everything on this slip is what {SHOP.name} recorded for order{" "}
              {order.orderNumber ?? "this order"}. If a piece is missing or the
              spelling is wrong, keep this slip — it is the quickest way for us to
              find the order.
            </p>
            {/* Prices are deliberately absent; see the note at the top of this
                file. The offer of a receipt is only made where there is an
                address to make it at — `SHOP.supportEmail` renders a bracketed
                placeholder when unset and must never be printed without this
                check. */}
            {SHOP.hasSupportEmail ? (
              <p className="mt-1">
                No prices are shown here. If you need a receipt, email{" "}
                {SHOP.supportEmail}.
              </p>
            ) : (
              <p className="mt-1">No prices are shown here.</p>
            )}
          </footer>
        </article>
      )}
    </div>
  );
}

/**
 * The address, read defensively — the same shape as the order screen's block
 * and for the same reason: a sale typed in at a market has no address at all
 * and carries a note instead, and five blank lines on a printed page look like
 * a printer fault rather than a fact.
 */
function SlipAddress({ order }: { order: OrderDetail }) {
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

  if (lines.length === 0) {
    return (
      <p className="mt-2 text-[14.5px]">
        No address was collected for this order — it was handed over in person.
      </p>
    );
  }

  return (
    <address className="mt-2 text-[16px] leading-relaxed not-italic">
      {/* Keyed on the position, not the text: two identical lines are unlikely
          but legal, and a duplicate key would drop one off the envelope. */}
      {lines.map((line, index) => (
        <span key={`${index}-${line}`} className="block">
          {line}
        </span>
      ))}
    </address>
  );
}

/**
 * What actually went into a Lucky Scoop.
 *
 * A scoop is sold before anybody knows what is in it, so the line above says
 * "Pet scoop, five pieces" and this is the only place that can say which five.
 * Where nothing has been recorded yet the slip says so in words rather than
 * printing a promise it cannot keep — and `markShipped` refuses the dispatch
 * anyway, so this is the earlier of the two warnings, not a substitute for it.
 *
 * Costs are absent here as everywhere else on this page, even though
 * `ScoopPackRow` carries them.
 */
function ScoopContents({ scoops }: { scoops: OrderScoops }) {
  if (scoops.unreadable) {
    return (
      <section className="mt-7 break-inside-avoid">
        <p className="text-[13.5px]">
          The Lucky Scoop records for this order could not be read, so this slip
          cannot say what is in them. Check the order screen before sealing the bag.
        </p>
      </section>
    );
  }

  if (scoops.lines.length === 0) return null;

  return (
    <section className="mt-7">
      <h2 className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
        WHAT WENT IN THE SCOOP
      </h2>
      <div className="mt-2.5 flex flex-col gap-3.5">
        {scoops.lines.flatMap((line) =>
          line.packs.map((pack) => (
            <div key={`${line.orderItemId}-${pack.packIndex}`} className="break-inside-avoid">
              <p className="text-[14px] font-semibold">
                {line.tierName}
                {line.packs.length > 1 ? ` — scoop ${pack.packIndex} of ${line.packs.length}` : ""}
              </p>
              {pack.items.length === 0 ? (
                <p className="mt-1 text-[13.5px]">
                  Nothing recorded yet. Record what went in on the order screen —
                  this order cannot be marked posted until you do.
                </p>
              ) : (
                <ul className="mt-1 text-[14px]">
                  {pack.items.map((piece) => (
                    <li key={`${piece.productId}-${piece.sku}`}>
                      {piece.quantity} × {piece.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )),
        )}
      </div>
    </section>
  );
}
