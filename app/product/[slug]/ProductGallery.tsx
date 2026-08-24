"use client";

import { useState } from "react";
import { ProductArt } from "@/components/ProductArt";
import { FavouriteButton } from "@/components/product/FavouriteButton";
import { Icon, Pill, cx } from "@/components/ui";
import type { Product, Tint } from "@/lib/types";

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

export function ProductGallery({ product }: { product: Product }) {
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

        {product.is_bestseller ? (
          <span className="absolute top-4 left-4">
            <Pill tone="surface">Bestseller</Pill>
          </span>
        ) : null}

        <FavouriteButton
          productId={product.id}
          name={product.short_name}
          className="absolute top-3.5 right-3.5"
        />

        <span className="absolute right-3.5 bottom-3.5">
          <Pill tone="surface" className="text-muted">
            <Icon name="camera" size={14} />
            Illustration — photos coming soon
          </Pill>
        </span>
      </div>
    </div>
  );
}
