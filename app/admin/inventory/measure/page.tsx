import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import {
  getColours,
  getMeasureQueue,
  MEASURE_COLOUR_SLOTS,
  type ColourRow,
  type MeasureRow,
} from "../../data";
import { NoRows, PageHead, Panel, Stat, Swatch } from "../../ui";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { saveMeasurement } from "../../actions";
import { ColourPalette, ExtraColours } from "./ExtraColours";
import { Alert, ButtonLink, Icon, Pill, cx, inputClass } from "@/components/ui";

export const metadata = { title: "Measure the catalogue · Studio" };

/**
 * Measure the whole catalogue in one sitting.
 *
 * THE PROBLEM THIS EXISTS FOR. Nothing in the studio can price a piece until it
 * has a print time and a filament recipe, and on the day this was written none
 * of the forty-four products had either. Every unit cost, every margin, every
 * suggested price and the entire filament buy list were therefore dark — and
 * the only way to turn one of them on was to open a product, scroll a long
 * form, fill two areas of it and save, forty-four times. This is that job as
 * one screen: a row per product, a print time, a colour, its grams, Save, next.
 *
 * WHY IT IS ALL SERVER-RENDERED. The row forms are the "Count it / Set" pattern
 * from the print queue next door — the fields inside `AdminForm` are passed in
 * as children, so no cost and no product reaches the browser bundle. The print
 * time, the first colour and its grams — the fast path, hours → colour → grams
 * → Enter — are plain server-rendered markup with nothing to hydrate.
 *
 * WHAT CHANGED, and the numbers that forced it. Measured on the deployed page,
 * 44 products and 18 colours:
 *
 *     htmlBytes   1,207,013     1.2 MB of HTML for one screen
 *     selects     176           four per row
 *     options     3,344
 *     forms       44
 *     nodes       4,744
 *
 * Chrome's renderer timed out screenshotting it, and it scaled with the
 * catalogue — 200 products would be roughly 5 MB. Every row was rendering four
 * whole palettes, three of them inside a <details> that almost nobody opens
 * because almost every piece is one colour. Colours two to four now start as
 * hidden inputs and are built in the browser from one copy of the palette; see
 * ExtraColours.tsx for what that has to preserve and why.
 *
 * WHY IT HANGS OFF INVENTORY BUT ASKS FOR "catalogue". Measuring is the thing
 * that makes the Inventory buy list true, which is where a person notices it is
 * needed and where the link is. What it WRITES is product rows — the two fields
 * every price in the shop is derived from — so it is guarded like the product
 * form, not like a stock count. The long note on `saveMeasurement` in
 * actions.ts has the argument; the short version is that counting a shelf is an
 * observation and typing a print time is authoring the cost basis.
 */

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function MeasurePage({
  searchParams,
}: {
  // Next.js 16: searchParams is a Promise and has to be awaited.
  searchParams: Promise<Search>;
}) {
  await requireStaff("catalogue");

  const params = await searchParams;
  const showAll = one(params.show) === "all";
  // Which single row was asked to show its extra colour slots. This is the
  // no-JavaScript half of that toggle: with React running the click never
  // navigates, without it the server renders that one row open.
  const openId = one(params.colours);

  const [queue, colours] = await Promise.all([getMeasureQueue(showAll), getColours()]);

  const done = queue.total > 0 ? Math.round((queue.measured / queue.total) * 100) : 0;

  return (
    <div>
      <PageHead
        title="Measure the catalogue"
        subtitle="A print time and the grams of each colour. These two are what every cost, margin and suggested price in the studio is worked out from."
        actions={
          <ButtonLink href="/admin/inventory" variant="soft" size="md">
            <Icon name="back" size={18} />
            Back to inventory
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="MEASURED"
          value={`${queue.measured} of ${queue.total}`}
          note="have both a print time and a filament recipe"
        />
        <Stat
          label="STILL TO DO"
          value={String(queue.unmeasured)}
          note="products with no cost, no margin and no suggested price"
          tone={queue.unmeasured > 0 ? "warn" : undefined}
        />
        <div className="card flex flex-col justify-center gap-3 p-5">
          <span className="text-[12.5px] font-extrabold tracking-[0.06em] text-faint">
            PROGRESS
          </span>
          {/* A bar rather than a fourth number: the point of this screen is
              watching the count fall over an evening. Nothing in components/ui
              draws one, and it is one element, so it stays here rather than
              becoming a component nobody else needs. */}
          <div
            role="progressbar"
            aria-valuenow={queue.measured}
            aria-valuemin={0}
            aria-valuemax={queue.total}
            aria-label="Products measured"
            className="h-2.5 w-full overflow-hidden rounded-full bg-cream"
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${done}%` }} />
          </div>
          <span className="text-[13.5px] text-muted">
            {queue.unmeasured === 0
              ? "Every product is measured."
              : `${done}% of the catalogue`}
          </span>
        </div>
      </div>

      {colours.length === 0 ? (
        <div className="mb-6">
          <Alert tone="error">
            There are no colours to choose from yet, so no filament can be recorded. Add the
            palette on the <Link href="/admin/colours" className="underline">Colours</Link> page
            first.
          </Alert>
        </div>
      ) : null}

      <Panel
        title={showAll ? "The whole catalogue" : "Not measured yet"}
        note={
          showAll
            ? "Every product, measured or not, so a number typed wrong can be corrected."
            : "One row each. Saving recalculates that product's cost, its place in the print queue and the filament buy list — and the row leaves this list the moment it has both numbers."
        }
        actions={
          <Link
            href={showAll ? "/admin/inventory/measure" : "/admin/inventory/measure?show=all"}
            className="text-[13.5px] font-bold text-accent hover:text-accent-dark"
          >
            {showAll ? "Show only what is missing" : "Show every product"} →
          </Link>
        }
        padded={false}
      >
        {queue.rows.length === 0 ? (
          <NoRows>
            {queue.total === 0
              ? "There is nothing in the catalogue yet."
              : "Every product has a print time and a filament recipe. The buy list and every cost in the studio are now working from real numbers."}
          </NoRows>
        ) : (
          <>
            {/* One header for the whole list rather than a label on each of the
                forty-four rows. Below md the rows stack and the header is
                meaningless, so it is hidden and the inputs carry aria-labels. */}
            <div className="hidden border-b border-line px-5 py-3 text-[12px] font-extrabold tracking-[0.04em] text-faint md:grid md:grid-cols-[minmax(0,1fr)_96px_minmax(150px,1fr)_92px_auto] md:items-center md:gap-3">
              <span>Product</span>
              <span>Hours</span>
              <span>Colour</span>
              <span>Grams</span>
              <span className="sr-only">Save</span>
            </div>

            {/* The palette crosses into the browser here, once for the whole
                list, so a row that is opened can build its own selects without
                eighteen colours being repeated down forty-four rows. */}
            <ColourPalette
              palette={colours.map((c) => ({ id: c.id, name: c.name, active: c.active }))}
            >
              <ul className="divide-y divide-line">
                {queue.rows.map((row) => (
                  // The id is the target of the row's own "more colours" link,
                  // so the no-JS round trip comes back to the row you clicked.
                  <li key={row.product.id} id={`row-${row.product.id}`} className="px-5 py-4">
                    <Row
                      row={row}
                      colours={colours}
                      base={showAll ? "/admin/inventory/measure?show=all" : "/admin/inventory/measure"}
                      openId={openId}
                    />
                  </li>
                ))}
              </ul>
            </ColourPalette>
          </>
        )}
      </Panel>

      <p className="mt-4 text-[13px] text-muted">
        Print time is hours as the slicer reports it — 0.75 is 45 minutes. Grams are for one
        piece, per colour, because the buy list adds them up colour by colour. Leave either blank
        and the piece stays on this list rather than being priced from half a measurement.
      </p>
    </div>
  );
}

/**
 * One product's row.
 *
 * THE MULTI-COLOUR DECISION, and why it is shaped like this.
 *
 * Grams have to be per colour — the buy list is "how many rolls of Sunset Coral
 * do I order", so one grams-for-everything box would be a number that cannot
 * answer the question it exists for. But almost every piece here is one colour,
 * and forty-four rows that each make you open something before you can type are
 * forty-four rows nobody finishes.
 *
 * So: the FIRST colour and its grams are always on the row, in the tab order,
 * server-rendered, and colours two to four are shut underneath unless the piece
 * already uses more than one. A single-colour piece is hours, colour, grams,
 * Enter — four keystrokes past the tab key and no clicks. A multi-colour piece
 * has its extra slots already open. Every slot is submitted either way, open or
 * shut, which is what lets `saveMeasurement` insist on receiving all four and
 * refuse a payload that is missing them.
 *
 * What a shut row used to submit was three more <select>s inside a <details>;
 * what it submits now is three pairs of hidden inputs holding the same values,
 * because 3,344 <option> elements on one screen (see the numbers at the top of
 * this file) is what a whole palette per slot per row costs. ExtraColours.tsx
 * holds that end of it.
 *
 * The ceiling is four because the workbook's Products sheet had four fixed
 * Colour/g pairs and nothing in this catalogue exceeds it. `product_filament`
 * has no ceiling at all, so a fifth colour is legal — this row refuses to edit
 * such a piece and sends the person to the full product form, rather than
 * writing back the four it can see and silently dropping the fifth.
 */
function Row({
  row,
  colours,
  base,
  openId,
}: {
  row: MeasureRow;
  colours: ColourRow[];
  /** This page's own URL, carrying whatever filter is on, for the toggle link. */
  base: string;
  /** The one product id `?colours=` named, if any. */
  openId: string;
}) {
  const { product, missing } = row;

  // A colour that has been turned off still has to appear if this piece uses
  // it, or saving the row would quietly drop it. Same rule as the product form.
  const usable = colours.filter(
    (c) => c.active || product.filament.some((f) => f.colourId === c.id),
  );

  const heading = (
    <div className="min-w-0">
      <span className="font-mono text-[12.5px] font-semibold text-faint">{product.sku}</span>
      <Link
        href={`/admin/products/${product.id}`}
        className="block truncate font-semibold hover:text-accent"
      >
        {product.name}
      </Link>
      <span className="mt-1 flex flex-wrap items-center gap-2">
        {missing.length === 0 ? (
          <Pill tone="good">measured</Pill>
        ) : (
          <Pill tone="warn">no {missing.join(", no ")}</Pill>
        )}
        {product.filament.map((use) => (
          <span key={use.colourId} className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <Swatch hex={use.hex} size={13} />
            {use.grams} g
          </span>
        ))}
      </span>
    </div>
  );

  /*
   * More colours than this screen has slots for. The row shows what is there
   * and hands the job to the product form. It is not editable here because a
   * four-slot form saving a five-colour piece deletes the fifth colour, and a
   * cost that quietly drops a colour is worse than one that says "not here".
   */
  if (product.filament.length > MEASURE_COLOUR_SLOTS) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-muted">
            {product.filament.length} colours — more than this screen can show.
          </span>
          <ButtonLink href={`/admin/products/${product.id}`} variant="soft" size="sm">
            Open it
          </ButtonLink>
        </div>
      </div>
    );
  }

  const slots = Array.from({ length: MEASURE_COLOUR_SLOTS }, (_, i) => product.filament[i] ?? null);
  // A piece that already uses more than one colour shows them, always. Anything
  // else opens on request — from the URL when JavaScript has not arrived yet.
  const pinned = product.filament.length > 1;
  const anchor = `#row-${product.id}`;

  return (
    <AdminForm action={saveMeasurement} className="!gap-2.5">
      <input type="hidden" name="id" value={product.id} />

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_96px_minmax(150px,1fr)_92px_auto] md:items-center">
        {heading}

        <input
          name="print_time_hours"
          type="number"
          step="0.001"
          min="0"
          defaultValue={product.printTimeHours ?? ""}
          placeholder="hours"
          aria-label={`Print time in hours for ${product.name}`}
          className={`${inputClass} !h-10`}
        />

        <ColourSlot slot={slots[0]} usable={usable} product={product.name} index={1} />

        <SubmitButton variant="soft" size="sm" pendingLabel="…">
          Save
        </SubmitButton>
      </div>

      <ExtraColours
        slots={slots.slice(1)}
        product={product.name}
        // Only the switched-off ones: everything still on is in the palette the
        // list already handed over, and repeating it here per row is the thing
        // this change exists to stop.
        keep={usable.filter((c) => !c.active).map((c) => c.id)}
        pinned={pinned}
        startOpen={pinned || openId === product.id}
        openHref={`${base}${base.includes("?") ? "&" : "?"}colours=${product.id}${anchor}`}
        closeHref={`${base}${anchor}`}
      />
    </AdminForm>
  );
}

/**
 * The first colour-and-grams pair, and only the first.
 *
 * Rendered as a fragment rather than a wrapper so the caller decides the grid:
 * this pair sits directly inside the row's own columns. It is the one slot that
 * has to be here, in the markup, in the tab order, with no waiting on a bundle
 * — it is the whole fast path. Slots two to four are ExtraColours.tsx, in the
 * browser, from one shared palette; that split is what took the page from
 * 3,344 <option>s to a nineteenth of them.
 */
function ColourSlot({
  slot,
  usable,
  product,
  index,
}: {
  slot: { colourId: string; grams: number } | null;
  usable: ColourRow[];
  product: string;
  index: number;
}) {
  return (
    <>
      <select
        name="filament_colour"
        defaultValue={slot?.colourId ?? ""}
        aria-label={`Colour ${index} for ${product}`}
        className={cx(inputClass, "!h-10 min-w-0")}
      >
        <option value="">{index === 1 ? "Choose a colour" : "None"}</option>
        {usable.map((colour) => (
          <option key={colour.id} value={colour.id}>
            {colour.name}
            {colour.active ? "" : " (turned off)"}
          </option>
        ))}
      </select>
      <input
        name="filament_grams"
        type="number"
        step="0.01"
        min="0"
        defaultValue={slot ? String(slot.grams) : ""}
        placeholder="grams"
        aria-label={`Grams of colour ${index} for ${product}`}
        className={cx(inputClass, "!h-10")}
      />
    </>
  );
}
