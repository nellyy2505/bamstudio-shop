import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductCard";
import { Breadcrumbs, Icon, Pill } from "@/components/ui";
import { FilterSidebar } from "./FilterSidebar";
import { SortSelect } from "./SortSelect";
import { getFacets, getProducts, type ProductFilters } from "@/lib/queries";
import { pluralise } from "@/lib/format";
import { SITE_OPEN_GRAPH } from "../seo";

const PER_PAGE = 12;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The parameters that make this a VIEW of the catalogue rather than the
 * catalogue. Every one of them narrows or reorders the same set of products,
 * and every combination is a separate URL: `/shop?category=…`, `?theme=…`,
 * `?attachment=…`, `?min=`, `?max=`, `?sort=`, and any pairing of them. The
 * home page alone links seven of them (CATEGORY_TILES), so they are crawled.
 *
 * `page` is deliberately NOT in this list — see below.
 */
const VIEW_PARAMS = [
  "category",
  "theme",
  "attachment",
  "min",
  "max",
  "sort",
] as const;

/**
 * Which URL this listing claims to be.
 *
 * Nothing on the live site said, so `/shop`, `/shop?theme=Food` and
 * `/shop?category=Phone+%26+bag&sort=price-asc` were three pages of largely
 * the same products competing with each other.
 *
 *  • Any filter or sort present → `/shop`. A filtered view is a subset of the
 *    catalogue with no copy of its own, and every product it can reach is in
 *    /sitemap.xml by its own URL, so nothing becomes undiscoverable by
 *    folding these into the one listing.
 *  • `?page=N` with no filter → `/shop?page=N`, itself. Page 2 is NOT a
 *    duplicate of page 1 — it holds twelve different products — and Google is
 *    explicit that paginated pages should not be canonicalised to the first.
 *    Saying otherwise here would be a false statement about the content.
 *  • Anything else, `?utm_source=` included → `/shop`.
 *
 * The origin comes from `metadataBase` (app/layout.tsx → `siteUrl()`); this
 * returns a path, never a host. See `app/seo.ts`.
 */
function canonicalShopPath(
  params: Record<string, string | string[] | undefined>,
): string {
  const filtered = VIEW_PARAMS.some((key) => Boolean(one(params[key])));
  if (filtered) return "/shop";

  const page = toInt(one(params.page));
  return page && page > 1 ? `/shop?page=${page}` : "/shop";
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const canonical = canonicalShopPath(await searchParams);

  return {
    title: "Shop all",
    description:
      "Every Bam Studio clicker keychain, charm and desk piece — printed to order in Sydney.",
    alternates: { canonical },
    openGraph: { ...SITE_OPEN_GRAPH, url: canonical },
  };
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const filters: ProductFilters = {
    category: one(params.category),
    theme: one(params.theme),
    attachment: one(params.attachment),
    min: toInt(one(params.min)),
    max: toInt(one(params.max)),
    sort: (one(params.sort) as ProductFilters["sort"]) ?? "popular",
    page: toInt(one(params.page)) ?? 1,
    perPage: PER_PAGE,
  };

  const [{ products, total }, facets] = await Promise.all([
    getProducts(filters),
    getFacets(),
  ]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const currentPage = Math.min(filters.page ?? 1, pages);

  const active = [
    filters.category && { label: filters.category, key: "category" },
    filters.theme && { label: filters.theme, key: "theme" },
    filters.attachment && { label: filters.attachment, key: "attachment" },
    filters.max && { label: `Under $${(filters.max / 100).toFixed(0)}`, key: "max" },
  ].filter(Boolean) as { label: string; key: string }[];

  function pageHref(page: number) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = one(value);
      if (single && key !== "page") next.set(key, single);
    }
    if (page > 1) next.set("page", String(page));
    const query = next.toString();
    return query ? `/shop?${query}` : "/shop";
  }

  function withoutFilter(key: string) {
    const next = new URLSearchParams();
    for (const [k, value] of Object.entries(params)) {
      const single = one(value);
      if (single && k !== key && k !== "page") next.set(k, single);
    }
    const query = next.toString();
    return query ? `/shop?${query}` : "/shop";
  }

  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Shop all" }]} />

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-1.5 text-3xl md:text-4xl">
            {filters.category ?? filters.theme ?? "Shop all"}
          </h1>
          <p className="text-sm text-muted">
            {pluralise(total, "product")} · every one printed to order in Sydney
          </p>
        </div>
        <SortSelect current={filters.sort ?? "popular"} />
      </div>

      <div className="grid items-start gap-10 lg:grid-cols-[255px_minmax(0,1fr)]">
        <FilterSidebar
          facets={facets}
          activeCategory={filters.category}
          activeTheme={filters.theme}
          activeAttachment={filters.attachment}
          activeMax={filters.max}
          activeCount={active.length}
        />

        <div>
          {active.length > 0 ? (
            <div className="mb-5 flex flex-wrap items-center gap-2 lg:hidden">
              {active.map((item) => (
                <Link key={item.key} href={withoutFilter(item.key)}>
                  <Pill tone="dark">
                    {item.label}
                    <Icon name="x" size={11} strokeWidth={2.6} />
                  </Pill>
                </Link>
              ))}
            </div>
          ) : null}

          {products.length === 0 ? (
            <div className="card flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cream">
                <Icon name="search" size={28} />
              </span>
              <h2 className="mt-5 text-xl">Nothing matches those filters</h2>
              <p className="mt-2 max-w-sm text-sm text-muted">
                Try widening the price range or clearing a filter — the whole
                range is only a click away.
              </p>
              <Link
                href="/shop"
                className="mt-5 font-bold text-accent underline underline-offset-2"
              >
                Clear all filters
              </Link>
            </div>
          ) : (
            <ProductGrid products={products} columns={3} />
          )}

          {pages > 1 ? (
            <nav
              aria-label="Pagination"
              className="mt-11 flex items-center justify-center gap-2"
            >
              {Array.from({ length: pages }, (_, i) => i + 1).map((page) => (
                <Link
                  key={page}
                  href={pageHref(page)}
                  aria-current={page === currentPage ? "page" : undefined}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-extrabold ${
                    page === currentPage
                      ? "bg-ink text-white"
                      : "border border-line2 bg-surface hover:border-ink"
                  }`}
                >
                  {page}
                </Link>
              ))}
              {currentPage < pages ? (
                <Link
                  href={pageHref(currentPage + 1)}
                  aria-label="Next page"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-line2 bg-surface hover:border-ink"
                >
                  <Icon name="arrow" size={16} />
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
