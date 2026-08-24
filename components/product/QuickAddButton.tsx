"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import type { Product } from "@/lib/types";

/**
 * One-tap add from a grid card. Products with choices to make (colours or a
 * personalisation step) route to the product page instead of guessing.
 */
export function QuickAddButton({ product }: { product: Product }) {
  const { add } = useCart();
  const router = useRouter();
  const [added, setAdded] = useState(false);

  const needsChoice =
    product.is_personalised || (product.colours?.length ?? 0) > 1;

  function onClick() {
    if (needsChoice) {
      router.push(`/product/${product.slug}`);
      return;
    }

    const attachment = product.attachments?.[0] ?? null;
    add({
      product_id: product.id,
      slug: product.slug,
      name: product.short_name,
      art: product.art,
      tint: product.tint,
      colour: product.colours?.[0]?.name ?? null,
      attachment_id: attachment?.id ?? null,
      attachment_label: attachment?.label ?? null,
      unit_price: product.price + (attachment?.price_delta ?? 0),
      quantity: 1,
      is_personalised: false,
    });

    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2.5 bottom-2.5 flex h-10 items-center gap-1.5 rounded-full border border-line2 bg-surface px-3.5 text-sm font-extrabold shadow-sm transition-colors hover:border-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
    >
      {added ? (
        <>
          <Icon name="check" size={15} strokeWidth={2.4} />
          Added
        </>
      ) : (
        <>
          <Icon name={needsChoice ? "arrow" : "plus"} size={15} strokeWidth={2.4} />
          {needsChoice ? "Options" : "Add"}
        </>
      )}
      <span className="sr-only"> {product.short_name}</span>
    </button>
  );
}
