import Link from "next/link";
import { can, requireStaff } from "@/lib/auth/staff";
import { getInventory } from "../data";
import { NoRows, PageHead, Panel, Stat, Swatch } from "../ui";
import { AdminForm, SubmitButton } from "../AdminForm";
import { setRolls, setStock } from "../actions";
import { Alert, ButtonLink, Icon, inputClass } from "@/components/ui";
import { money } from "@/lib/format";

export const metadata = { title: "Inventory · Studio" };

/**
 * The print queue and the filament it needs.
 *
 * This is the workbook's Filament sheet. It reads the whole catalogue, not a
 * page of it — a buy list that only covers what fits on one screen is a buy
 * list that sends you home short.
 */
export default async function InventoryPage() {
  const staff = await requireStaff("inventory");

  /*
   * The measuring screen writes product rows, so it asks for "catalogue" rather
   * than "inventory" — the argument is on `saveMeasurement` in actions.ts. The
   * two capabilities are held by exactly the same roles today, but a link that
   * bounces a person straight back to /admin is worse than no link, so it is
   * shown only to someone the screen will actually let in. Hiding a link is
   * presentation; the page behind it calls requireStaff() for itself.
   */
  const canMeasure = can(staff.role, "catalogue");

  const inventory = await getInventory();
  const needed = inventory.filament.filter((f) => f.gramsNeeded > 0 || f.rollsToBuy > 0);

  /*
   * Whether the print queue below has an oversell in it.
   *
   * `oversold_units` is a running total of units sold that the ready-to-ship
   * buffer did not have (0005_sale_integrity.sql). The shop prints to order, so
   * that is allowed and is not an error — but it is somebody who has already
   * paid, waiting on a piece that was not on the shelf, which makes it the
   * strongest print-this-first signal there is. It was surfaced on /admin and
   * nowhere else; this is the screen where it changes what she does next.
   */
  const oversoldInQueue = inventory.rows.some((r) => r.product.oversoldUnits > 0);

  /*
   * Nothing recorded and nothing needed are two different claims.
   *
   * The buy list is built from filament recipes, so a product with no grams on
   * it is invisible to it. Measured in the browser against the live database:
   * all 44 products had no recipe, and this page still printed "ROLLS TO BUY /
   * 0 / the shelf covers the queue" and "Nothing to buy. Either the queue is
   * empty, or the rolls you have cover it." Both were false, and both were
   * stated as fact next to a banner saying the opposite. While `unmeasured` is
   * above zero the buy list is a floor at best, and where it comes out empty it
   * says nothing at all.
   */
  const unmeasuredNote = `${inventory.unmeasured} product${
    inventory.unmeasured === 1 ? " has" : "s have"
  } no filament recorded`;

  return (
    <div>
      <PageHead
        title="Inventory"
        subtitle="What to print next, and what filament that will take."
        actions={
          canMeasure ? (
            <ButtonLink
              href="/admin/inventory/measure"
              variant={inventory.unmeasured > 0 ? "primary" : "soft"}
              size="md"
            >
              <Icon name="clock" size={18} />
              Measure the catalogue
            </ButtonLink>
          ) : null
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="TO PRINT"
          value={String(inventory.totalToPrint)}
          note="pieces, to bring everything up to its buffer"
        />
        <Stat
          label="ROLLS TO BUY"
          value={
            inventory.unmeasured > 0 && inventory.totalRollsToBuy === 0
              ? "—"
              : String(inventory.totalRollsToBuy)
          }
          note={
            inventory.unmeasured > 0
              ? inventory.totalRollsToBuy > 0
                ? `at least ${money(inventory.totalBuyCostCents)} — ${unmeasuredNote}`
                : `not measured — ${unmeasuredNote}`
              : inventory.totalRollsToBuy > 0
                ? `about ${money(inventory.totalBuyCostCents)}`
                : "the shelf covers the queue"
          }
        />
        <Stat
          label="NOT MEASURED"
          value={String(inventory.unmeasured)}
          note="products with no filament recorded"
          tone={inventory.unmeasured > 0 ? "warn" : undefined}
        />
      </div>

      {inventory.unmeasured > 0 ? (
        <div className="mb-6">
          <Alert tone="error">
            {inventory.unmeasured} product{inventory.unmeasured === 1 ? " has" : "s have"} no
            filament recorded, so nothing they use appears in the buy list below.{" "}
            {canMeasure ? (
              <>
                <Link href="/admin/inventory/measure" className="underline">
                  Measure them
                </Link>{" "}
                — a print time and the grams, one row each — and this page becomes trustworthy.
              </>
            ) : (
              "Add the grams on each product and this page becomes trustworthy."
            )}
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel
          title="The print queue"
          note={
            /*
             * The sentence about ordering is here only when a row in this table
             * actually carries an oversell — not merely when the catalogue has
             * one somewhere, which can be true while every oversold piece has
             * already been printed and left the queue. A standing explanation
             * of a column reading "—" on every row is a warning about nothing.
             */
            oversoldInQueue
              ? "Sold but not yet posted, plus your buffer, less what is on the shelf. Oversold pieces come first: somebody has already paid for those."
              : "Sold but not yet posted, plus your buffer, less what is on the shelf."
          }
          padded={false}
        >
          {inventory.rows.length === 0 ? (
            <NoRows>
              Nothing to print. Every product is stocked to its buffer and no order is waiting.
            </NoRows>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-extrabold tracking-[0.04em] text-faint">
                    <th className="px-5 py-3">SKU</th>
                    <th className="px-3 py-3">Product</th>
                    <th className="px-3 py-3 text-right">On shelf</th>
                    <th className="px-3 py-3 text-right">Sold</th>
                    {/* The count the shelf could not cover. Named "Oversold"
                        rather than "Short" because it is a running total of
                        demand that ran ahead of the shelf, not today's gap —
                        "To print" is the gap. */}
                    <th className="px-3 py-3 text-right">Oversold</th>
                    <th className="px-3 py-3 text-right">Buffer</th>
                    <th className="px-3 py-3 text-right">To print</th>
                    <th className="px-5 py-3">Count it</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inventory.rows.map((row) => (
                    <tr key={row.product.id}>
                      <td className="px-5 py-3 font-mono text-[13px] font-semibold">
                        {row.product.sku}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/admin/products/${row.product.id}`}
                          className="font-semibold hover:text-accent"
                        >
                          {row.product.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.product.stockOnHand}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.ordered}</td>
                      {/* An em dash for nothing to report, the same as the "To
                          buy" and "Cost" columns below. A 0 printed here would
                          read as a measured fact — "we checked, none were
                          oversold" — on a row where it is just the absence of
                          an incident. */}
                      <td className="px-3 py-3 text-right tabular-nums">
                        {row.product.oversoldUnits > 0 ? (
                          <span className="font-bold text-danger">
                            {row.product.oversoldUnits}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.product.bufferStock}</td>
                      <td className="px-3 py-3 text-right font-display text-[17px] font-semibold tabular-nums">
                        {row.toPrint}
                      </td>
                      <td className="px-5 py-3">
                        {/* Its own form per row, so counting one product does
                            not resubmit the whole table. */}
                        <AdminForm action={setStock} className="!flex-row items-center gap-2">
                          <input type="hidden" name="id" value={row.product.id} />
                          <input
                            name="stock_on_hand"
                            type="number"
                            min="0"
                            defaultValue={row.product.stockOnHand}
                            aria-label={`Stock on hand for ${row.product.name}`}
                            className={`${inputClass} !h-10 w-20`}
                          />
                          <SubmitButton variant="soft" size="sm" pendingLabel="…">
                            Set
                          </SubmitButton>
                        </AdminForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/*
            * Oversold pieces the queue above cannot show.
            *
            * `rows` only carries products with something to print, and
            * `oversold_units` is a running total that nothing decrements — so a
            * piece that was oversold, printed and counted back up leaves the
            * queue with its counter still standing. Dropping it silently would
            * make the one screen that is meant to surface an oversell the one
            * screen it disappears from. Absent entirely when there are none.
            */}
          {inventory.oversoldOffQueue.length > 0 ? (
            <div className="border-t border-line px-5 py-4 text-[13px] text-muted">
              <b className="text-ink">Oversold, with nothing left to print:</b>{" "}
              {inventory.oversoldOffQueue
                .map((product) => `${product.name} (${product.units})`)
                .join(", ")}
              . The shelf covers these now. The count is a running total of
              demand that ran ahead of the shelf and nothing clears it
              automatically, so it stays until someone sets the stock on the
              product itself.
            </div>
          ) : null}
        </Panel>

        <Panel
          title="Filament to buy"
          note="Grams the queue above will use, per colour, against what is on the shelf."
          padded={false}
        >
          {needed.length === 0 ? (
            <NoRows>
              {inventory.unmeasured > 0
                ? `Nothing recorded to buy — ${unmeasuredNote}, so this list is empty because the grams are missing, not because the shelf covers the queue.`
                : "Nothing to buy. Either the queue is empty, or the rolls you have cover it."}
            </NoRows>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-extrabold tracking-[0.04em] text-faint">
                    <th className="px-5 py-3">Colour</th>
                    <th className="px-3 py-3 text-right">Grams needed</th>
                    <th className="px-3 py-3 text-right">Rolls needed</th>
                    <th className="px-3 py-3 text-right">On hand</th>
                    <th className="px-3 py-3 text-right">To buy</th>
                    <th className="px-3 py-3 text-right">Cost</th>
                    <th className="px-5 py-3">Count it</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {needed.map((colour) => (
                    <tr key={colour.colourId}>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2.5 font-semibold">
                          <Swatch hex={colour.hex} />
                          {colour.name}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {Math.round(colour.gramsNeeded)} g
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{colour.rollsNeeded}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{colour.rollsOnHand}</td>
                      <td className="px-3 py-3 text-right font-display text-[17px] font-semibold tabular-nums">
                        {colour.rollsToBuy > 0 ? colour.rollsToBuy : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {colour.rollsToBuy > 0 ? money(colour.costToBuyCents) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <AdminForm action={setRolls} className="!flex-row items-center gap-2">
                          <input type="hidden" name="colour_id" value={colour.colourId} />
                          <input
                            name="rolls_on_hand"
                            type="number"
                            step="0.25"
                            min="0"
                            defaultValue={colour.rollsOnHand}
                            aria-label={`Rolls of ${colour.name} on hand`}
                            className={`${inputClass} !h-10 w-24`}
                          />
                          <SubmitButton variant="soft" size="sm" pendingLabel="…">
                            Set
                          </SubmitButton>
                        </AdminForm>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-4 text-[13px] text-muted">
        Rolls are rounded up: 1,200 g of one colour is two rolls, because you cannot buy two
        fifths of one. Part-used rolls can be counted in quarters.
      </p>
    </div>
  );
}
