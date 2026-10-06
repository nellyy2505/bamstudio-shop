import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { Pill, Stars, cx } from "@/components/ui";
import { money } from "@/lib/format";
import { productPhotos } from "@/lib/photos";
import { cutoutFor } from "@/lib/cutouts";
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

  // A second view to cross-fade to on hover, when the gallery has one. Cards
  // with a single view keep the gentle zoom and nothing else.
  const hoverView = product.gallery?.length > 1 ? product.gallery[1] : null;
  // Real photographs win over the drawing whenever the studio has uploaded any.
  const photos = productPhotos(product);
  // The cut-out leads when there is one, so every card in a grid sits the same
  // way on its own tile; the first real photo fades in on hover.
  const cutout = cutoutFor(product.slug);

  return (
    <div className="group flex h-full flex-col gap-2.5">
      <div
        className={cx(
          "relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl",
          cutout ? null : (TINT_CLASS[product.tint] ?? "bg-cream"),
        )}
        style={cutout ? { background: cutout.tile } : undefined}
      >
        <Link
          href={`/product/${product.slug}`}
          className="flex h-full w-full items-center justify-center"
          aria-label={product.short_name}
        >
          {cutout ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
              <img
                src={cutout.src}
                alt={product.short_name}
                loading="lazy"
                decoding="async"
                className="bam-cutout absolute inset-[14%] h-[72%] w-[72%] object-contain transition duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
              {photos[0] ? (
                /* eslint-disable-next-line @next/next/no-img-element -- as above */
                <img
                  src={photos[0].thumb}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
                />
              ) : null}
            </>
          ) : photos.length > 0 ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage is not a next/image loader (see PhotoDrop). */}
              <img
                src={photos[0].thumb}
                alt={photos[0].alt}
                loading="lazy"
                decoding="async"
                className={cx(
                  "absolute inset-0 h-full w-full object-cover transition duration-300 motion-reduce:transition-none",
                  photos[1] ? "group-hover:opacity-0" : "group-hover:scale-105 motion-reduce:group-hover:scale-100",
                )}
              />
              {photos[1] ? (
                /* eslint-disable-next-line @next/next/no-img-element -- as above */
                <img
                  src={photos[1].thumb}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
                />
              ) : null}
            </>
          ) : (
            <>
            <ProductArt
              art={product.art}
              size={160}
              className={cx(
                "transition duration-300 motion-reduce:transition-none",
                hoverView
                  ? "group-hover:opacity-0"
                  : "group-hover:scale-105 motion-reduce:group-hover:scale-100",
              )}
            />
            {hoverView ? (
              <span
                aria-hidden="true"
                className={cx(
                  "absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none",
                  TINT_CLASS[hoverView.tint] ?? "bg-cream",
                )}
              >
                <ProductArt art={hoverView.art} size={160} />
              </span>
            ) : null}
            </>
          )}
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

      {/* Name (two lines at most), then price pinned to the bottom so the
          price row lines up across a grid row whatever the name length. */}
      <div className="flex flex-1 flex-col gap-1">
        <Link
          href={`/product/${product.slug}`}
          className="line-clamp-2 text-[14.5px] leading-snug font-bold hover:text-accent-dark"
        >
          {product.short_name}
        </Link>
        {product.review_count > 0 ? (
          <div className="flex items-center gap-1.5">
            <Stars rating={product.rating} size={13} />
            <span className="text-xs text-muted">({product.review_count})</span>
          </div>
        ) : null}
        <div className="mt-auto flex items-baseline justify-between gap-2">
          <b className="text-[15px]">
            {/* Only builder charms are priced by length; text personalisation
                costs exactly what the card says. Currency is stated once in
                the shop header and again at the basket total. */}
            {product.personalisation_mode === "builder" ? "From " : ""}
            {money(product.price)}
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
  columns?: 3 | 4 | 5;
  quickAdd?: boolean;
}) {
  return (
    <div
      className={cx(
        "grid gap-x-5 gap-y-8 sm:gap-x-6 sm:gap-y-10",
        "grid-cols-2",
        columns === 3
          ? "lg:grid-cols-3"
          : columns === 5
            ? "md:grid-cols-3 lg:grid-cols-5"
            : "md:grid-cols-3 lg:grid-cols-4",
      )}
    >
      {products.map((product) => (
        <ProductCard key={product.id} product={product} quickAdd={quickAdd} />
      ))}
    </div>
  );
}
