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
import { Breadcrumbs, ButtonLink } from "@/components/ui";
import { money } from "@/lib/format";
import { toPrint } from "@/lib/costing";

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

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Photographs" note="Shown on the shop in this order. The first one is the main picture.">
            <PhotoDrop productId={product.id} photos={product.photos} publicBase={photoBase} />
          </Panel>

          <ProductForm
            product={product}
            colours={colours}
            accessories={accessories}
            defaultBuffer={settings.defaultBufferStock}
          />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-8">
          <Panel title="What it costs">
            {costed.cost.unknown ? (
              <div className="flex flex-col gap-3">
                <Unknown what={`No ${costed.cost.missing.join(" and no ")} recorded`} />
                <p className="text-[13.5px] text-muted">
                  Until both are filled in there is no unit cost, so there is no margin and no
                  suggested price. The parts below are what is known so far — they are not a
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
                <Row label="Profit each" value="—" />
                <Row label="Actual margin" value="—" />
                <p className="mt-1 text-[13.5px] text-muted">
                  A suggested price, a profit and a margin all need a unit cost. Fill in the
                  print time and at least one filament colour and they appear here.
                </p>
              </dl>
            ) : (
              <dl className="flex flex-col gap-2.5 text-[14px]">
                <Row
                  label={`Suggested at ${Math.round(settings.targetMargin * 100)}%`}
                  value={money(costed.suggested)}
                  strong
                />
                <Row label="Your price" value={money(product.price)} />
                <Row
                  label="Profit each"
                  value={money(
                    Math.round(product.price * (1 - settings.cardFeeRate) - costed.cost.total),
                  )}
                />
                <Row
                  label="Actual margin"
                  value={
                    product.price > 0
                      ? `${Math.round(
                          ((product.price * (1 - settings.cardFeeRate) - costed.cost.total) /
                            product.price) *
                            100,
                        )}%`
                      : "—"
                  }
                />
                {product.price > 0 && product.price < costed.suggested ? (
                  <p className="mt-1 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                    Priced below the suggestion. That is a decision, not a mistake — but it is
                    worth being a deliberate one.
                  </p>
                ) : null}
              </dl>
            )}
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-faint">
              Cost covers filament, machine and power, the accessory and packaging. The mailer is
              charged once per order, not per piece, so it is not in here.
            </p>
          </Panel>

          <Panel title="Stock">
            <dl className="flex flex-col gap-2.5 text-[14px]">
              <Row label="On the shelf" value={String(product.stockOnHand)} />
              <Row label="Sold, not yet posted" value={String(ordered)} />
              <Row label="Buffer you keep" value={String(product.bufferStock)} />
              <Row label="To print" value={String(queue)} strong />
            </dl>
            <p className="mt-3 text-[12px] text-faint">
              To print = sold, not yet posted + buffer − on the shelf.
            </p>
            <Link
              href="/admin/inventory"
              className="mt-2 inline-block text-[13px] font-bold text-accent hover:text-accent-dark"
            >
              Open the print queue →
            </Link>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-display font-semibold tabular-nums" : "tabular-nums"}>
        {value}
      </dd>
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
  // Costs are fractional cents — a keyring is 9.5c and packaging is 13c. They
  // are shown to two decimal places of a cent rather than rounded to the nearest
  // cent, because rounding four parts and then adding them does not give the
  // total the shop actually uses.
  const cents = (value: number) => `${value.toFixed(2)}c`;

  return (
    <dl className="flex flex-col gap-2 text-[13.5px]">
      <Row
        label="Filament"
        value={partial && costed.cost.missing.includes("filament weight") ? "—" : cents(cost.filament)}
      />
      <Row
        label="Machine + power"
        value={partial && costed.cost.missing.includes("print time") ? "—" : cents(cost.machineAndPower)}
      />
      <Row
        label={costed.accessoryName ?? "Accessory"}
        value={costed.accessoryName ? cents(cost.accessory) : "none"}
      />
      <Row label="Packaging" value={cents(cost.packaging)} />
      <p className="text-[12px] text-faint">
        At {settings.filamentPerKgCents / 100 > 0 ? money(settings.filamentPerKgCents) : "—"} a
        kilo and {(
          settings.printerPriceCents / Math.max(1, settings.printerLifeHours) +
          (settings.powerDrawWatts / 1000) * settings.electricityPerKwhCents
        ).toFixed(2)}
        c an hour for the machine.
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
