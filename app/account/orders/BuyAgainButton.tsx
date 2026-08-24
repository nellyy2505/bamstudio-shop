"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import type { CartLine } from "@/lib/types";

export function BuyAgainButton({
  lines,
  orderNumber,
}: {
  lines: Omit<CartLine, "key">[];
  orderNumber: string;
}) {
  const { add } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function buyAgain() {
    setBusy(true);
    for (const line of lines) add(line);
    router.push("/cart");
  }

  return (
    <Button
      type="button"
      variant="soft"
      size="sm"
      onClick={buyAgain}
      disabled={busy}
    >
      <Icon name="bag" size={15} />
      Buy again
      <span className="sr-only"> — items from order {orderNumber}</span>
    </Button>
  );
}
