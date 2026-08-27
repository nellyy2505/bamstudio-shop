import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { formatDate, pluralise } from "@/lib/format";
import { NoRows, Panel } from "../../ui";
import { PrintButton } from "../PrintButton";
import { getPickList, type PickEntry } from "../../data";

/**
 * One sheet listing everything every open order needs.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE SAME JOB AS THE PACKING SLIP, AND WHY IT IS NOT.
 *
 * It is the same medium — the print stylesheet, the page box, the black-on-
 * white rule, "no colour may carry meaning", the `.no-print` chrome — and it
 * reuses every one of them. It is the same reading, near enough: open orders,
 * their lines, their personalisation, rendered by the same
 * `describePersonalisationText`. And it answers the same complaint, which is
 * that she reads work off a screen and copies it by hand.
 *
 * What is NOT shared is the shape of the document, and that is deliberate. A
 * packing slip is per-order and its job is to be checked against one parcel. A
 * pick list is per-shelf and its job is to be walked once: plain pieces are
 * therefore POOLED across orders — three of the same clicker in the same colour
 * is one trip to one drawer — while a personalised piece is never pooled,
 * because three "Custom name charm" lines are three different objects that
 * happen to share a product row. `getPickList()` in data.ts holds that rule;
 * this page only draws it.
 *
 * WHAT IS NOT ON IT. No costs, no prices, no addresses, no customer names, no
 * email addresses. A pick list lives on the bench, gets handled all day and
 * ends up in the recycling — it needs order numbers so a piece can be matched
 * to a parcel, and nothing else about the person who ordered it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Capability is `orders`, held by Packing: picking and printing is that job.
 */

export const metadata = { title: "Pick list · Studio" };

export default async function PickListPage() {
  await requireStaff("orders");

  const list = await getPickList();

  const plain = list.entries.filter((entry) => entry.kind === "plain");
  const personalised = list.entries.filter((entry) => entry.kind === "personalised");
  const scoops = list.entries.filter((entry) => entry.kind === "scoop");

  return (
    <div className="flex flex-col gap-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin/orders"
            className="text-[13.5px] font-bold text-accent hover:text-accent-dark"
          >
            ← Back to orders
          </Link>
          <h1 className="mt-1 text-2xl">Pick list</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            Everything the open orders need, in one walk of the shelves.
          </p>
        </div>
        <PrintButton>Print this list</PrintButton>
      </div>

      {list.entries.length === 0 ? (
        <Panel padded={false}>
          <NoRows>
            <p>Nothing is waiting to be picked.</p>
            <p className="mx-auto mt-2 max-w-[46ch]">
              This list covers orders that are confirmed, printing or packed. An
              unpaid checkout is not an order and never appears here.
            </p>
          </NoRows>
        </Panel>
      ) : (
        <article className="print-sheet card p-8">
          <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-4">
            <div>
              <h2 className="font-display text-[22px] font-semibold">Pick list</h2>
              {/* "to pick" and not "in these orders": the count deliberately
                  leaves the scoops out, because a scoop's contents are not
                  decided yet and its quantity counts bags. See `PickList`. */}
              <p className="text-[13px] text-muted">
                {pluralise(list.orderCount, "open order")} ·{" "}
                {pluralise(list.pieceCount, "piece")} to pick
              </p>
            </div>
            {/* When this sheet was produced, so a stale one found on the bench
                next week can be recognised as stale. It is the render time and
                nothing else — no claim about when the orders arrived. */}
            <p className="text-[13px] text-muted">Printed {formatDate(new Date())}</p>
          </header>

          {plain.length > 0 ? (
            <Section
              title="OFF THE SHELF"
              note="Pooled across orders. The order numbers say which parcels they split between."
              entries={plain}
            />
          ) : null}

          {personalised.length > 0 ? (
            <Section
              title="MADE TO ORDER — CHECK EVERY LETTER"
              note="One entry per order. These are never added together: each one is its own piece."
              entries={personalised}
            />
          ) : null}

          {scoops.length > 0 ? (
            <Section
              title="LUCKY SCOOPS TO DRAW"
              note="Nobody knows what goes in these yet. Draw them, then record what went in on the order."
              entries={scoops}
            />
          ) : null}
        </article>
      )}
    </div>
  );
}

function Section({
  title,
  note,
  entries,
}: {
  title: string;
  note: string;
  entries: PickEntry[];
}) {
  return (
    <section className="mt-7">
      <h3 className="text-[11.5px] font-extrabold tracking-[0.08em] text-faint">{title}</h3>
      <p className="mt-0.5 text-[13px] text-muted">{note}</p>

      <ul className="mt-3 flex flex-col divide-y divide-line border-t border-line">
        {entries.map((entry) => {
          // Words, not swatches: a printed colour dot is the same grey circle
          // on every line of a mono printer, and colour may not carry meaning
          // on paper.
          const bits = [entry.variantLabel, entry.colour].filter(
            (bit): bit is string => typeof bit === "string" && bit.trim().length > 0,
          );

          return (
            <li key={entry.key} className="flex gap-4 break-inside-avoid py-3">
              {/* A box to tick. Printed as an empty square rather than a
                  checkbox input, because an interactive control on paper is a
                  grey rectangle that cannot be ticked. */}
              <span
                aria-hidden="true"
                className="mt-0.5 hidden h-4 w-4 shrink-0 border border-line2 print:block"
              />
              <span className="w-14 shrink-0 font-semibold tabular-nums">
                {entry.quantity} ×
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{entry.name}</span>
                {entry.sku ? (
                  <span className="ml-2 font-mono text-[12.5px] text-muted">{entry.sku}</span>
                ) : null}
                {bits.length > 0 ? (
                  <span className="mt-0.5 block text-[13px] text-muted">{bits.join(" · ")}</span>
                ) : null}
                {entry.personalisation ? (
                  // Verbatim, as on the packing slip and from the same helper.
                  // A name tidied up between the two sheets is a remake.
                  <span className="mt-1.5 block border border-line2 px-3 py-2 font-mono text-[14px] break-words whitespace-pre-wrap">
                    {entry.personalisation}
                  </span>
                ) : null}
                <span className="mt-1 block text-[12.5px] text-muted">
                  For{" "}
                  {entry.orders
                    .map((order) => order.orderNumber ?? "an unnumbered order")
                    .join(", ")}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
