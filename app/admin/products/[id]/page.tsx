import { notFound } from "next/navigation";
import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import {
  costProduct,
  getAccessories,
  getColours,
  getOpenDemand,
  getProduct,
  getSettings,
} from "../../data";
import { PageHead, Panel, Unknown } from "../../ui";
import { PhotoDrop } from "../PhotoDrop";
import { ProductForm } from "../ProductForm";
import { ProductTabs, TabPane } from "../ProductTabs";
import { ProductPreview } from "../ProductPreview";
import { Breadcrumbs, ButtonLink } from "@/components/ui";
import { money } from "@/lib/format";
import {
  costAtPrice,
  perPrinterHour,
  priceTerms,
  targetPerPrinterHour,
  toPrint,
} from "@/lib/costing";

export const metadata = { title: "Edit product · Studio" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff("catalogue");

  const { id } = await params;
  const [product, settings, accessories, colours, demand] = await Promise.all([
    getProduct(id),
    getSettings(),
    getAccessories(),
    getColours(),
    getOpenDemand(),
  ]);

  if (!product) notFound();

  const costed = costProduct(product, settings, accessories);
  const ordered = demand.get(product.id) ?? 0;
  const queue = toPrint({
    onHand: product.stockOnHand,
    ordered,
    buffer: product.bufferStock,
  });

  const photoBase = storagePublicBase();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Studio", href: "/admin" },
          { label: "Products", href: "/admin/products" },
          { label: product.shortName || product.name },
        ]}
      />

      <PageHead
        title={product.name}
        subtitle={
          <>
            <span className="font-mono">{product.sku}</span> ·{" "}
            {product.active ? "in the shop" : "hidden from the shop"}
            {product.onMarketStall ? " · goes to markets" : null}
          </>
        }
        actions={
          <ButtonLink href={`/product/${product.slug}`} variant="soft" size="sm">
            View in the shop
          </ButtonLink>
        }
      />

      <ProductTabs>
        <ProductForm
          product={product}
          colours={colours}
          accessories={accessories}
          defaultBuffer={settings.defaultBufferStock}
          pricingAside={
            <>
              <Panel title="What it costs">
                {costed.cost.unknown ? (
                  <div className="flex flex-col gap-3">
                    <Unknown what={`No ${costed.cost.missing.join(" and no ")} recorded`} />
                    <p className="text-[13.5px] text-muted">
                      Until both are filled in there is no unit cost, so there is no margin and no
                      suggested price. The parts below are what is known so far, they are not a
                      total.
                    </p>
                    <CostLines settings={settings} costed={costed} partial />
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <CostLines settings={settings} costed={costed} />
                    <div className="flex items-baseline justify-between border-t border-line pt-3">
                      <span className="font-display font-semibold">Unit cost</span>
                      <span className="font-display text-[22px] font-semibold tabular-nums">
                        {money(Math.round(costed.cost.total))}
                      </span>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel title="What to charge">
                {/* Profit and margin are worked out from the same `cost.total` the
                    suggestion is, so gating only on `suggested` let an unmeasured
                    piece print four false numbers from packaging alone: $0.50
                    suggested, $8.73 profit, 97% margin. The whole block branches on
                    the unknown cost. The price she typed in is still a fact and
                    stays; everything derived from a cost that does not exist goes. */}
                {costed.cost.unknown || costed.suggested === null ? (
                  <dl className="flex flex-col gap-2.5 text-[14px]">
                    {product.price > 0 ? (
                      <Row label="Your price" value={money(product.price)} />
                    ) : null}
                    <Row label="Profit each" value="-" />
                    <Row label="Actual margin" value="-" />
                    <p className="mt-1 text-[13.5px] text-muted">
                      A suggested price, a profit and a margin all need a unit cost. Fill in the
                      print time and at least one filament colour and they appear here.
                    </p>
                  </dl>
                ) : (
                  <AtThisPrice
                    settings={settings}
                    price={product.price}
                    unitCostCents={Math.round(costed.cost.total)}
                    suggested={costed.suggested}
                    printTimeHours={product.printTimeHours}
                  />
                )}
                <p className="mt-3 border-t border-line pt-3 text-[12px] text-faint">
                  The mailer is charged once per order, not per piece, so it is not in
                  here. Nor is your own time, by your decision, which makes every
                  margin on this page better than the real one.
                </p>
              </Panel>
            </>
          }
          reportingAside={
            /* On the shelf and the buffer are editable in the panel above, so
               they are not repeated here. What is left is the half nobody types:
               open demand, and the queue the two of them produce. */
            <Panel title="What that adds up to">
              <dl className="flex flex-col gap-2.5 text-[14px]">
                <Row label="Sold, not yet posted" value={String(ordered)} />
                <Row label="To print" value={String(queue)} strong />
              </dl>
              <p className="mt-3 text-[12px] text-faint">
                To print = sold, not yet posted + buffer &minus; on the shelf. It
                counts pieces somebody has already paid for, so it can be more
                than the buffer alone would ask for.
              </p>
              <Link
                href="/admin/inventory"
                className="mt-2 inline-block text-[13px] font-bold text-accent hover:text-accent-dark"
              >
                Open the print queue &rarr;
              </Link>
            </Panel>
          }
        />

        {/*
          * Photographs and the preview sit OUTSIDE the form, after it, and that
          * is a constraint rather than a layout choice: PhotoDrop posts its own
          * uploads and deletions through actions of its own, so it contains
          * `<form>` elements, and a form inside a form is invalid HTML that
          * browsers resolve by silently dropping the inner one. After, rather
          * than before, so the reading order on this tab is the words, then the
          * pictures, then the page they add up to.
          */}
        <TabPane tab="customer" className="mt-6 flex flex-col gap-6">
          <Panel title="Photographs" note="Shown on the shop in this order. The first one is the main picture.">
            <PhotoDrop productId={product.id} photos={product.photos} publicBase={photoBase} />
          </Panel>

          <Panel title="How it looks in the shop">
            <ProductPreview slug={product.slug} active={product.active} />
          </Panel>
        </TabPane>
      </ProductTabs>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  quiet,
}: {
  label: string;
  value: string;
  strong?: boolean;
  /** A line that breaks down the one above it rather than adding to the total. */
  quiet?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className={quiet ? "pl-3 text-[12.5px] text-faint" : "text-muted"}>{label}</dt>
      <dd
        className={
          strong
            ? "font-display font-semibold tabular-nums"
            : quiet
              ? "text-[12.5px] text-faint tabular-nums"
              : "tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Where the money actually goes at the price on the shelf.
 *
 * The workbook's AO:AT block, which was added during the pricing work precisely
 * because a total nobody can decompose is a total nobody argues with. It answers
 * a different question from the suggested price: not "what should this cost" but
 * "at what I charge, what is left, and where did the rest go".
 *
 * The two questions disagree all over this catalogue and the disagreement is the
 * point. The macaron sells at $6.50 against a suggestion of $8.50, which is a
 * decision that was made with reasons; a screen showing only the suggestion
 * would hide it, and a screen showing only the margin would hide what it cost.
 *
 * Both tests are shown, margin and dollars per printer-hour, because a piece can
 * pass one and fail the other and the failure mode is asymmetric: margin is
 * about whether a sale is worth making, the hour is about whether the year adds
 * up. The macaron clears its margin comfortably and misses the bar.
 */
function AtThisPrice({
  settings,
  price,
  unitCostCents,
  suggested,
  printTimeHours,
}: {
  settings: Awaited<ReturnType<typeof getSettings>>;
  price: number;
  unitCostCents: number;
  suggested: number;
  printTimeHours: number | null;
}) {
  const outcome = costAtPrice(priceTerms(settings), price, unitCostCents);
  const hourly = perPrinterHour(outcome.profit, printTimeHours);
  const bar = targetPerPrinterHour(settings);
  const cents = (value: number) => money(Math.round(value));

  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-2.5 text-[14px]">
        <Row
          label={`Suggested at ${Math.round(settings.targetMargin * 100)}%`}
          value={money(suggested)}
          strong
        />
        <Row label="Your price" value={money(price)} />
      </dl>

      {price > 0 ? (
        <>
          <dl className="flex flex-col gap-2 border-t border-line pt-3 text-[13.5px]">
            <div className="mb-0.5 text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
              WHERE THAT PRICE GOES
            </div>
            <Row label="Making it" value={cents(outcome.unitCost)} />
            <Row
              label={`Card fee, ${Math.round(settings.cardFeeRate * 1000) / 10}% + ${Math.round(settings.cardFeeFixedCents)}c`}
              value={cents(outcome.cardFee)}
            />
            <Row label="Postage you absorb" value={cents(outcome.postage)} />
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="font-display font-semibold">Profit each</dt>
              <dd className="font-display text-[19px] font-semibold tabular-nums">
                {cents(outcome.profit)}
              </dd>
            </div>
          </dl>

          <dl className="flex flex-col gap-2.5 border-t border-line pt-3 text-[14px]">
            <Row
              label="Actual margin"
              value={outcome.margin === null ? "-" : `${Math.round(outcome.margin * 100)}%`}
            />
            <Row
              label="Per printer-hour"
              value={hourly === null ? "-" : `${money(hourly)} of ${money(bar)}`}
            />
          </dl>

          {/*
            * Three separate warnings rather than one, because they are three
            * separate facts and the remedy for each is different. Priced under
            * the suggestion is a choice; under the bar is a product that will
            * not pay for the year however many sell; unmeasured print time
            * means the bar cannot be applied at all.
            */}
          {hourly !== null && hourly < bar ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              {money(hourly)} an hour of machine time, against the {money(bar)}{" "}
              the year needs. Machine time is the limit, not shelf space, so a
              piece under the bar earns less for the year than a dearer one that
              prints faster, whatever its margin says.
            </p>
          ) : null}

          {hourly === null ? (
            <p className="rounded-lg bg-cream px-3 py-2 text-[12.5px] text-muted">
              No print time recorded, so this piece cannot be judged per
              printer-hour. Margin alone will make it look fine.
            </p>
          ) : null}

          {price < suggested ? (
            <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              Priced {money(suggested - price)} below the suggestion. That is a
              decision, not a mistake, but it is worth being a deliberate one.
            </p>
          ) : null}
        </>
      ) : (
        <p className="border-t border-line pt-3 text-[13.5px] text-muted">
          No price set yet, so there is nothing to break down. The suggestion
          above is where to start.
        </p>
      )}
    </div>
  );
}

function CostLines({
  settings,
  costed,
  partial,
}: {
  settings: Awaited<ReturnType<typeof getSettings>>;
  costed: ReturnType<typeof costProduct>;
  partial?: boolean;
}) {
  const { cost } = costed;
  // Costs are fractional cents - a keyring is 9.5c and packaging is 13c. They
  // are shown to two decimal places of a cent rather than rounded to the nearest
  // cent, because rounding four parts and then adding them does not give the
  // total the shop actually uses.
  const cents = (value: number) => `${value.toFixed(2)}c`;

  return (
    <dl className="flex flex-col gap-2 text-[13.5px]">
      <Row
        label="Filament"
        value={partial && costed.cost.missing.includes("filament weight") ? "-" : cents(cost.filament)}
      />
      <Row
        label="Machine + power"
        value={partial && costed.cost.missing.includes("print time") ? "-" : cents(cost.machineAndPower)}
      />
      <Row
        label={costed.accessoryName ?? "Accessory"}
        value={costed.accessoryName ? cents(cost.accessory) : "none"}
      />
      <Row label="Packaging" value={cents(cost.packaging)} />
      {/* The waste uplift is already inside filament and machine above; this
          line names it so those two figures are not quietly 12% larger than the
          grams and hours on the form would imply. */}
      <Row
        label={`of which waste, ${Math.round(settings.wasteRate * 100)}%`}
        value={partial && cost.waste === 0 ? "-" : cents(cost.waste)}
        quiet
      />
      <Row label="Insurance, permits, web" value={cents(cost.insuranceShare)} />
      <Row label="Equipment wear" value={cents(cost.depreciationShare)} />
      <p className="text-[12px] text-faint">
        At {settings.filamentPerKgCents / 100 > 0 ? money(settings.filamentPerKgCents) : "-"} a
        kilo and {(
          settings.printerPriceCents / Math.max(1, settings.printerLifeHours) +
          (settings.powerDrawWatts / 1000) * settings.electricityPerKwhCents
        ).toFixed(2)}
        c an hour for the machine, plus {Math.round(settings.wasteRate * 100)}% for
        prints that fail. The two overhead lines are the year&rsquo;s fixed costs
        spread over {settings.expectedUnitsPerYear.toLocaleString("en-AU")} units.
      </p>
    </dl>
  );
}

/**
 * The public URL prefix for the photo bucket.
 *
 * Built from the Supabase project URL rather than stored on each photo, so the
 * rows hold a path and nothing else. A stored absolute URL survives a project
 * move and then points at nothing.
 */
function storagePublicBase(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/product-photos`;
}
