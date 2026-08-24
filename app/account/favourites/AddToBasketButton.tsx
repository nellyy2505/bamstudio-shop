"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import type { Product } from "@/lib/types";

export function AddToBasketButton({ product }: { product: Product }) {
  const { add } = useCart();
  const router = useRouter();
  const [added, setAdded] = useState(false);

  // Anything with letters to type or a colour to pick goes to the product page
  // rather than us guessing on the shopper's behalf.
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
    <Button type="button" variant="soft" size="sm" full onClick={onClick}>
      {added ? (
        <>
          <Icon name="check" size={15} strokeWidth={2.4} />
          Added
        </>
      ) : (
        <>
          <Icon name={needsChoice ? "arrow" : "plus"} size={15} strokeWidth={2.4} />
          {needsChoice ? "Choose options" : "Add to basket"}
        </>
      )}
      <span className="sr-only"> — {product.short_name}</span>
    </Button>
  );
}
