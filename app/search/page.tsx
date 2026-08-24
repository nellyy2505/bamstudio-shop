import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductCard";
import { Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
import { searchProducts } from "@/lib/queries";
import { pluralise } from "@/lib/format";

type SearchParams = Promise<{ q?: string | string[] }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const term = Array.isArray(q) ? q[0] : q;
  return {
    title: term ? `Results for “${term}”` : "Search",
    robots: { index: false },
  };
}

const RELATED_TERMS = [
  "clicker keychain",
  "name charm",
  "plants",
  "gifts under $10",
  "phone strap",
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;
  const term = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const products = term ? await searchProducts(term) : [];

  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Search" }]} />

      <h1 className="mb-1 text-2xl md:text-3xl">
        {term ? <>Results for “{term}”</> : "Search the shop"}
      </h1>
      <p className="mb-5 text-sm text-muted">
        {term
          ? pluralise(products.length, "product") + " found"
          : "Try a product name, a theme like “food”, or a colour."}
      </p>

      <div className="mb-7 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-extrabold text-muted">Try:</span>
        {RELATED_TERMS.map((related) => (
          <Link key={related} href={`/search?q=${encodeURIComponent(related)}`}>
            <Pill tone="line">{related}</Pill>
          </Link>
        ))}
      </div>

      {products.length > 0 ? (
        <ProductGrid products={products} />
      ) : term ? (
        <div className="card flex flex-col items-center px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-cream">
            <Icon name="search" size={28} />
          </span>
          <h2 className="mt-5 text-xl">
            Nothing matches “{term}” — yet
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            We might not make it yet. Several catalogue pieces started as
            customer requests, so tell us what you&apos;d click.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/shop">Browse everything</ButtonLink>
            <ButtonLink href="/contact" variant="ghost">
              Request a design
            </ButtonLink>
          </div>
        </div>
      ) : null}

      {products.length > 0 ? (
        <div className="card mt-11 flex flex-col items-center gap-5 bg-cream p-7 text-center sm:flex-row sm:text-left">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-surface">
            <Icon name="help" size={28} />
          </span>
          <div className="flex-1">
            <b className="text-base">Searching for something we don&apos;t make?</b>
            <p className="mt-1 text-[13.5px] text-muted">
              We take custom requests — the dumbbell clicker started as one.
            </p>
          </div>
          <ButtonLink href="/contact" variant="ghost" size="sm">
            Request a design
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}
