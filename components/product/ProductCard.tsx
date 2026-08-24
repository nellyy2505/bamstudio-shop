import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { Pill, Stars, cx } from "@/components/ui";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";
import { FavouriteButton } from "./FavouriteButton";
import { QuickAddButton } from "./QuickAddButton";

const TINT_CLASS: Record<string, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

export function ProductCard({
  product,
  quickAdd = true,
}: {
  product: Product;
  quickAdd?: boolean;
}) {
  const badge = product.is_bestseller
    ? "Bestseller"
    : product.is_new
      ? "New"
      : product.is_personalised
        ? "Personalised"
        : null;

  return (
    <div className="group flex flex-col gap-2.5">
      <div
        className={cx(
          "relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl",
          TINT_CLASS[product.tint] ?? "bg-cream",
        )}
      >
        <Link
          href={`/product/${product.slug}`}
          className="flex h-full w-full items-center justify-center"
          aria-label={product.short_name}
        >
          <ProductArt
            art={product.art}
            size={160}
            className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </Link>

        {badge ? (
          <span className="pointer-events-none absolute top-3 left-3">
            <Pill tone="surface">{badge}</Pill>
          </span>
        ) : null}

        <FavouriteButton productId={product.id} name={product.short_name} />

        {quickAdd ? (
          <QuickAddButton product={product} />
        ) : null}
      </div>

      <div>
        <Link
          href={`/product/${product.slug}`}
          className="text-[14.5px] font-bold hover:text-accent-dark"
        >
          {product.short_name}
        </Link>
        {product.review_count > 0 ? (
          <div className="my-0.5 flex items-center gap-1.5">
            <Stars rating={product.rating} size={13} />
            <span className="text-xs text-muted">({product.review_count})</span>
          </div>
        ) : (
          /* No reviews yet, so no stars and no "(0)" — but hold the row's
             height so the price line stays put across a mixed grid. */
          <div className="my-0.5 h-4" aria-hidden="true" />
        )}
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-[15px]">
            {/* Only builder charms are priced by length; text personalisation
                costs exactly what the card says. */}
            {product.personalisation_mode === "builder" ? "From " : ""}
            {money(product.price)}{" "}
            <span className="text-[11.5px] font-semibold text-faint">AUD</span>
          </b>
          {product.stock_on_hand > 0 && product.stock_on_hand <= 4 ? (
            <span className="text-[11.5px] font-bold text-accent-dark">
              Only {product.stock_on_hand} ready
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ProductGrid({
  products,
  columns = 4,
  quickAdd = true,
}: {
  products: Product[];
  columns?: 3 | 4;
  quickAdd?: boolean;
}) {
  return (
    <div
      className={cx(
        "grid gap-5 sm:gap-6",
        "grid-cols-2",
        columns === 3 ? "lg:grid-cols-3" : "md:grid-cols-3 lg:grid-cols-4",
      )}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} quickAdd={quickAdd} />
      ))}
    </div>
  );
}
