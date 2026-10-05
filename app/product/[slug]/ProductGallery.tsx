"use client";

import { useState } from "react";
import { ProductArt } from "@/components/ProductArt";
import { FavouriteButton } from "@/components/product/FavouriteButton";
import { Icon, Pill, cx } from "@/components/ui";
import type { Product, Tint } from "@/lib/types";
import { productPhotos } from "@/lib/photos";

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

function isIllustration(view: object): boolean {
  return !("src" in view);
}

export function ProductGallery({ product }: { product: Product }) {
  const photos = productPhotos(product);
  if (photos.length > 0) return <PhotoGallery product={product} photos={photos} />;
  return <ArtGallery product={product} />;
}

/** Real photographs: a square main image with thumbnails, like most shops. */
function PhotoGallery({
  product,
  photos,
}: {
  product: Product;
  photos: { src: string; thumb: string; alt: string }[];
}) {
  const [index, setIndex] = useState(0);
  const active = photos[Math.min(index, photos.length - 1)];
  return (
    <div className="flex flex-col-reverse gap-3.5 md:flex-row md:items-start">
      {photos.length > 1 ? (
        <div
          role="tablist"
          aria-label="Product photos"
          className="flex gap-2.5 overflow-x-auto md:w-[76px] md:flex-col md:overflow-visible"
        >
          {photos.map((photo, i) => (
            <button
              key={photo.src}
              role="tab"
              aria-selected={i === index}
              aria-label={`Photo ${i + 1} of ${photos.length}`}
              onClick={() => setIndex(i)}
              className={cx(
                "h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl bg-cream",
                i === index ? "outline-2 outline-offset-2 outline-ink" : "opacity-70 hover:opacity-100",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Storage is not a next/image loader. */}
              <img src={photo.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative aspect-square w-full overflow-hidden rounded-[22px] bg-cream">
        {/* eslint-disable-next-line @next/next/no-img-element -- Storage is not a next/image loader. */}
        <img
          src={active.src}
          alt={active.alt}
          fetchPriority={index === 0 ? "high" : undefined}
          className="h-full w-full object-cover"
        />
        <FavouriteButton
          productId={product.id}
          name={product.short_name}
          className="absolute top-3.5 right-3.5"
        />
      </div>
    </div>
  );
}

function ArtGallery({ product }: { product: Product }) {
  const views =
    product.gallery?.length > 0
      ? product.gallery
      : [{ art: product.art, tint: product.tint, alt: product.short_name }];
  const [index, setIndex] = useState(0);
  const active = views[Math.min(index, views.length - 1)];

  return (
    <div className="flex flex-col-reverse gap-3.5 md:flex-row md:items-start">
      {views.length > 1 ? (
        <div
          role="tablist"
          aria-label="Product views"
          className="flex gap-2.5 overflow-x-auto md:w-[76px] md:flex-col md:overflow-visible"
        >
          {views.map((view, i) => (
            <button
              key={`${view.art}-${i}`}
              role="tab"
              aria-selected={i === index}
              aria-label={view.alt}
              onClick={() => setIndex(i)}
              className={cx(
                "flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-xl",
                TINT_BG[view.tint],
                i === index
                  ? "outline-2 outline-offset-2 outline-ink"
                  : "opacity-60 hover:opacity-100",
              )}
            >
              <ProductArt art={view.art} size={46} />
            </button>
          ))}
        </div>
      ) : null}

      <div
        className={cx(
          "relative flex aspect-square w-full items-center justify-center rounded-[22px]",
          TINT_BG[active.tint],
        )}
      >
        <ProductArt art={active.art} size={300} />
        <span className="sr-only">{active.alt}</span>

        {/* No Bestseller pill here: the title block beside it already says so. */}
        <FavouriteButton
          productId={product.id}
          name={product.short_name}
          className="absolute top-3.5 right-3.5"
        />

        {/* Labelled only when the view is an illustration rather than a
            photo. Every view is one today (ProductImage has no photo field),
            so the label stays, but it no longer promises photos that may
            never arrive. A view carrying a `src` is a photo and goes unlabelled. */}
        {isIllustration(active) ? (
          <span className="absolute right-3.5 bottom-3.5">
            <Pill tone="surface" className="text-muted">
              <Icon name="camera" size={14} />
              Illustration
            </Pill>
          </span>
        ) : null}
      </div>
    </div>
  );
}
