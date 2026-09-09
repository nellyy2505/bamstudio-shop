import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { getCategories, getRepricingBoard } from "../../data";
import { savePrices } from "../../actions";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { NoRows, PageHead, Panel, Stat } from "../../ui";
import { ButtonLink, inputClass } from "@/components/ui";
import { money } from "@/lib/format";
import { PricingTable } from "./PricingTable";

/**
 * Repricing, as one screen and one save.
 *
 * This exists because 38 of 44 products still carry the price the catalogue was
 * seeded with, and setting them one product page at a time is a day of clicking
 * for a job that is really one decision repeated: is the suggestion right, and
 * if not, what instead. Everything needed to answer that is in one row here.
 *
 * It is a static segment under /admin/products, which Next resolves ahead of the
 * `[id]` route beside it, the same way `new` already does. Nothing to configure.
 */
export const metadata = { title: "Repricing · Studio" };

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function RepricingPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireStaff("catalogue");

  const params = await searchParams;
  const filters = {
    q: one(params.q),
    category: one(params.category),
    visibility: one(params.visibility),
  };
  const attention = one(params.attention) === "1";

  const [board, categories] = await Promise.all([
    getRepricingBoard(filters),
    getCategories(),
  ]);

  /*
   * "Needs attention" is applied here rather than in the query because all three
   * of its tests are computed, not stored: a margin under target, a piece under
   * the printer-hour bar, or a piece that cannot be judged at all because nobody
   * has measured it. The third belongs in the same filter as the other two - an
   * unmeasured product is not a product that passes, it is one whose price
   * nobody can defend.
   */
  const rows = attention
    ? board.rows.filter(
        (row) =>
          row.unitCostCents === null ||
          row.margin === null ||
          row.margin < board.targetMargin ||
          row.perHour === null ||
          row.perHour < board.barPerHour,
      )
    : board.rows;

  const measured = board.rows.filter((row) => row.unitCostCents !== null).length;
  const belowBar = board.rows.filter(
    (row) => row.perHour !== null && row.perHour < board.barPerHour,
  ).length;
  const belowTarget = board.rows.filter(
    (row) => row.margin !== null && row.margin < board.targetMargin,
  ).length;

  return (
    <div>
      <PageHead
        title="Repricing"
        subtitle="Every product, what it costs, what it should sell for, and what it actually earns per hour of machine time. One save for the lot."
        actions={
          <ButtonLink href="/admin/products" size="md" variant="soft">
            Back to products
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="PRODUCTS"
          value={String(board.rows.length)}
          note={`${measured} measured, ${board.rows.length - measured} not`}
          tone={measured < board.rows.length ? "warn" : undefined}
        />
        <Stat
          label="ON ONE PRICE"
          value={board.seedPrice === null ? "-" : String(board.atSeedPrice)}
          note={
            board.seedPrice === null ? (
              "No price shared by three or more products."
            ) : (
              <>
                all still at {money(board.seedPrice)}, which is a price nobody
                has set individually
              </>
            )
          }
          tone={board.atSeedPrice > 2 ? "warn" : undefined}
        />
        <Stat
          label="UNDER TARGET MARGIN"
          value={String(belowTarget)}
          note={`Target is ${Math.round(board.targetMargin * 100)}%.`}
          tone={belowTarget > 0 ? "warn" : undefined}
        />
        <Stat
          label="UNDER THE HOUR BAR"
          value={String(belowBar)}
          note={`The bar is ${money(board.barPerHour)} per printer-hour.`}
          tone={belowBar > 0 ? "warn" : undefined}
        />
      </div>

      {/* Plain GET, so a filtered grid is a bookmarkable address and the back
          button behaves. The prices themselves POST separately, below. */}
      <form className="mb-5 flex flex-wrap items-end gap-3" action="/admin/products/pricing">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">Search</span>
          <input name="q" defaultValue={filters.q} placeholder="Name or SKU" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">Category</span>
          <select name="category" defaultValue={filters.category} className={inputClass}>
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">Showing</span>
          <select name="visibility" defaultValue={filters.visibility} className={inputClass}>
            <option value="">In the shop and hidden</option>
            <option value="active">In the shop</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label className="flex h-12 shrink-0 cursor-pointer items-center gap-2 text-[13.5px] font-extrabold">
          <input
            name="attention"
            type="checkbox"
            value="1"
            defaultChecked={attention}
            className="h-4 w-4 accent-accent"
          />
          Needs attention only
        </label>
        <button
          type="submit"
          className={`${inputClass} !w-auto cursor-pointer px-5 font-display font-semibold`}
        >
          Apply
        </button>
      </form>

      <Panel padded={false}>
        {rows.length === 0 ? (
          <NoRows>
            {attention ? (
              <>
                Nothing needs attention under these filters. Every one of these
                clears your target margin and the printer-hour bar.
              </>
            ) : (
              <>
                Nothing matches those filters.{" "}
                <Link href="/admin/products/pricing" className="font-bold text-accent">
                  Clear them
                </Link>
                .
              </>
            )}
          </NoRows>
        ) : (
          /*
           * The whole grid is ONE form and one action. Per-row saves would mean
           * forty-four round trips and forty-four chances to walk away halfway
           * through with no way to tell which rows landed.
           *
           * Only the rows currently on screen are in the payload, which is why
           * `savePrices` treats an absent field as "not mentioned" rather than
           * as a clearing: filtering to one category and saving must not blank
           * the price of everything else.
           */
          <div className="p-5">
            <AdminForm action={savePrices}>
              <PricingTable
                rows={rows}
                terms={board.terms}
                targetMargin={board.targetMargin}
                barPerHour={board.barPerHour}
              />
              <div className="flex flex-wrap items-center gap-4 border-t border-line pt-5">
                <SubmitButton size="md">Save these prices</SubmitButton>
                <span className="text-[13px] text-muted">
                  Only rows you have changed are written. A blank box leaves that
                  product&rsquo;s price alone.
                </span>
              </div>
            </AdminForm>
          </div>
        )}
      </Panel>

      <div className="mt-5 flex flex-col gap-2 text-[13px] text-muted">
        <p>
          <b>Margin in amber</b> is under your target of{" "}
          {Math.round(board.targetMargin * 100)}%. <b>$ per hour in amber</b> is
          under {money(board.barPerHour)}, the contribution each printer-hour has
          to make for the year to work. A piece can pass one and fail the other,
          and the one that matters more is usually the hour: machine time is what
          limits the year, and a cheap thing that prints for two hours earns less
          than a dearer thing that prints in twenty minutes.
        </p>
        <p>
          Suggested prices cover the cost, your target margin, both halves of the
          card fee and the postage absorbed on a basket that only just earns free
          shipping. They are a starting point, not an instruction, and the
          catalogue departs from them deliberately in places.
        </p>
        <p>
          A dash means the piece has never been timed or weighed, so there is no
          cost to price from. Those are on{" "}
          <Link href="/admin/inventory/measure" className="font-bold text-accent">
            the measuring screen
          </Link>
          .
        </p>
        <p>
          <b>Your own time is not in any of these numbers</b>, by your decision,
          so every margin here is better than the real one by whatever three
          minutes of handling is worth to you.
        </p>
      </div>
    </div>
  );
}
