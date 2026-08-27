import { requireStaff } from "@/lib/auth/staff";
import { money, pluralise } from "@/lib/format";
import { Alert, Breadcrumbs, ButtonLink, Field, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { recordSale } from "../../actions";
import { CHANNEL_LABEL, NoRows, PageHead, Panel } from "../../ui";
import { listProducts, type ProductRow } from "../../data";

/**
 * A sale that did not come through the website.
 *
 * It writes to the same table a website order does, because every report reads
 * that table and a sale kept anywhere else is a sale every number is quietly
 * wrong about.
 */

/** Everything except the website — the website records its own sales. */
const CHANNELS = ["market_stall", "tiktok", "shopee", "other"] as const;

/**
 * How many pages of the catalogue this will fetch before giving up.
 *
 * `listProducts` pages at PAGE_SIZE (25) rows, so the whole catalogue has to be
 * walked to build a select that can offer every product — a picker that only
 * lists the first 25 is a picker that cannot record half the sales made at a
 * stall. The loop is capped so a runaway catalogue cannot turn one page load
 * into an unbounded number of queries; at 25 a page that is 500 products, and
 * the screen says so out loud if the cap is ever reached.
 */
const MAX_PAGES = 20;

async function loadAllProducts(): Promise<{ rows: ProductRow[]; capped: boolean }> {
  const rows: ProductRow[] = [];
  let page = 1;

  for (let round = 0; round < MAX_PAGES; round += 1) {
    const batch = await listProducts(page, {});
    rows.push(...batch.rows);
    if (batch.page >= batch.pageCount) return { rows, capped: false };
    page = batch.page + 1;
  }

  return { rows, capped: true };
}

// Without its own title a page falls back to the layout default, so seven
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Record a sale · Studio" };

export default async function RecordSalePage() {
  await requireStaff("orders");

  const { rows: products, capped } = await loadAllProducts();

  return (
    <div className="flex flex-col gap-7">
      <div>
        <Breadcrumbs
          items={[
            { label: "Studio", href: "/admin" },
            { label: "Orders", href: "/admin/orders" },
            { label: "Record a sale" },
          ]}
        />
        <PageHead
          title="Record a sale"
          subtitle="A market stall, a TikTok order, a piece sold to someone at work."
          actions={
            <ButtonLink href="/admin/orders" variant="soft" size="md">
              Back to orders
            </ButtonLink>
          }
        />
      </div>

      <Panel title="What this does">
        <div className="flex flex-col gap-3 text-[14px] text-muted">
          <p>
            This records a sale that did not come through the website. It is written as an
            ordinary order, so it counts in the reports exactly the same as one somebody paid
            for online — the same revenue, the same units, the same top-products list.
          </p>
          <p>
            <b className="text-ink">Stock comes off.</b> The piece you choose has its stock on
            hand reduced by the quantity, the same way the website does it when a payment
            lands. Record the sale once, and only once.
          </p>
          <p>
            The order is saved as delivered, because it was handed over in person and there is
            nothing to print or post. It is given an order number from the same run as every
            other order, so it can be looked up the same way.
          </p>
        </div>
      </Panel>

      {capped ? (
        <Alert tone="error">
          The catalogue is larger than this picker can load, so the list below stops at{" "}
          {pluralise(products.length, "product")}. Anything beyond that cannot be chosen here
          yet.
        </Alert>
      ) : null}

      <Panel title="The sale">
        {products.length === 0 ? (
          <NoRows>
            <p>There are no products to sell yet.</p>
            <p className="mt-4">
              <ButtonLink href="/admin/products/new" variant="soft" size="sm">
                Add a product
              </ButtonLink>
            </p>
          </NoRows>
        ) : (
          <AdminForm action={recordSale}>
            <Field
              label="What was sold"
              htmlFor="product_id"
              hint={`${pluralise(products.length, "product")} in the catalogue, hidden ones included — a stall sells things the shop does not list.`}
            >
              <select id="product_id" name="product_id" defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Choose a product
                </option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.sku} · {product.name} · {money(product.price)}
                    {product.active ? "" : " · hidden in the shop"}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="How many" htmlFor="quantity">
                <input
                  id="quantity"
                  name="quantity"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={1}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Where it was sold"
                htmlFor="channel"
                hint="Not the website. Those sales record themselves when the payment lands."
              >
                <select id="channel" name="channel" defaultValue="market_stall" className={inputClass}>
                  {CHANNELS.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABEL[channel] ?? channel}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Price each (optional)"
                htmlFor="unit_price"
                hint="In dollars, like 12.50. Leave it blank to use the shop price. Fill it in if you sold at a market price or gave a friend a discount."
              >
                <input
                  id="unit_price"
                  name="unit_price"
                  type="text"
                  inputMode="decimal"
                  placeholder="Shop price"
                  className={inputClass}
                />
              </Field>

              <Field
                label="Their email (optional)"
                htmlFor="email"
                hint="Only if they gave you one and want it on record. Nothing is sent to it."
              >
                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Left blank for a counter sale"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton pendingLabel="Recording…">Record this sale</SubmitButton>
              <span className="text-[13px] text-muted">
                Stock comes off as soon as you do.
              </span>
            </div>
          </AdminForm>
        )}
      </Panel>
    </div>
  );
}
