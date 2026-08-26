import { requireStaff } from "@/lib/auth/staff";
import {
  costProduct,
  getAccessories,
  getCategories,
  getOpenDemand,
  getSettings,
  listProducts,
} from "../data";
import { PageHead, Panel, NoRows, Unknown } from "../ui";
import { ButtonLink, Icon, Pagination, Pill, inputClass } from "@/components/ui";
import { money } from "@/lib/format";
import { toPrint } from "@/lib/costing";
import Link from "next/link";

export const metadata = { title: "Products · Studio" };

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

export default async function ProductsPage({
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

  // pageFromParam needs a page count, which is only known after the query. Ask
  // for page 1's worth of clamping, then use the page listProducts actually
  // settled on — it clamps against the real total.
  const requested = Number.parseInt(one(params.page) || "1", 10);
  const [products, settings, accessories, categories, demand] = await Promise.all([
    listProducts(Number.isFinite(requested) ? requested : 1, filters),
    getSettings(),
    getAccessories(),
    getCategories(),
    getOpenDemand(),
  ]);

  const hrefFor = (page: number) => {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.category) query.set("category", filters.category);
    if (filters.visibility) query.set("visibility", filters.visibility);
    if (page > 1) query.set("page", String(page));
    const qs = query.toString();
    return qs ? `/admin/products?${qs}` : "/admin/products";
  };

  return (
    <div>
      <PageHead
        title="Products"
        subtitle="Everything you sell, what it costs to make, and how many are on the shelf."
        actions={
          <ButtonLink href="/admin/products/new" size="md">
            <Icon name="plus" size={18} />
            Add a product
          </ButtonLink>
        }
      />

      {/* A plain GET form: the filters end up in the address bar, so a filtered
          list can be bookmarked and the back button works. No client JS. */}
      <form className="mb-5 flex flex-wrap items-end gap-3" action="/admin/products">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <span className="text-[13px] font-extrabold">Search</span>
          <input
            name="q"
            defaultValue={filters.q}
            placeholder="Name or SKU"
            className={inputClass}
          />
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
        <button type="submit" className={`${inputClass} !w-auto cursor-pointer px-5 font-display font-semibold`}>
          Apply
        </button>
      </form>

      <Panel padded={false}>
        {products.rows.length === 0 ? (
          <NoRows>
            {filters.q || filters.category || filters.visibility ? (
              <>
                Nothing matches those filters.{" "}
                <Link href="/admin/products" className="font-bold text-accent">
                  Clear them
                </Link>
                .
              </>
            ) : (
              <>Nothing in the catalogue yet. Add the first product to get started.</>
            )}
          </NoRows>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] font-extrabold tracking-[0.04em] text-faint">
                    <th className="px-5 py-3">SKU</th>
                    <th className="px-3 py-3">Product</th>
                    <th className="px-3 py-3 text-right">Unit cost</th>
                    <th className="px-3 py-3 text-right">Price</th>
                    <th className="px-3 py-3 text-right">Margin</th>
                    <th className="px-3 py-3 text-right">On hand</th>
                    <th className="px-3 py-3 text-right">To print</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {products.rows.map((product) => {
                    const costed = costProduct(product, settings, accessories);
                    const ordered = demand.get(product.id) ?? 0;
                    const queue = toPrint({
                      onHand: product.stockOnHand,
                      ordered,
                      buffer: product.bufferStock,
                    });
                    const margin =
                      costed.cost.unknown || product.price <= 0
                        ? null
                        : (product.price * (1 - settings.cardFeeRate) - costed.cost.total) /
                          product.price;

                    return (
                      <tr key={product.id} className="align-middle hover:bg-cream/50">
                        <td className="px-5 py-3 font-mono text-[13px] font-semibold">
                          {product.sku}
                        </td>
                        <td className="max-w-[280px] px-3 py-3">
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="font-semibold hover:text-accent"
                          >
                            {product.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
                            {product.category}
                            {!product.active ? <Pill tone="neutral">Hidden</Pill> : null}
                            {product.onMarketStall ? <Pill tone="line">Stall</Pill> : null}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {costed.cost.unknown ? (
                            <Unknown what="Not measured" />
                          ) : (
                            money(Math.round(costed.cost.total))
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums">
                          {money(product.price)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {margin === null ? (
                            <span className="text-faint">—</span>
                          ) : (
                            <span
                              className={
                                margin < settings.targetMargin ? "font-semibold text-warn" : ""
                              }
                            >
                              {Math.round(margin * 100)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{product.stockOnHand}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {queue > 0 ? <b>{queue}</b> : <span className="text-faint">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/admin/products/${product.id}`}
                            className="text-[13px] font-bold text-accent hover:text-accent-dark"
                          >
                            Edit
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line">
              <Pagination
                page={products.page}
                pageCount={products.pageCount}
                total={products.total}
                noun="products"
                hrefFor={hrefFor}
              />
            </div>
          </>
        )}
      </Panel>

      <p className="mt-4 text-[13px] text-muted">
        A margin shown in amber is below your target of{" "}
        {Math.round(settings.targetMargin * 100)}%. A dash means the piece has never been
        timed or weighed, so there is no cost to compare a price against.
      </p>
    </div>
  );
}
