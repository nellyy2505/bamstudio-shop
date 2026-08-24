"use client";

import { useEffect } from "react";
import { useCart } from "@/components/cart/CartProvider";

/**
 * Empties the basket once payment has succeeded. Runs on the confirmation
 * page only, so an abandoned checkout leaves the basket intact.
 */
export function ClearCartOnMount() {
  const { clear, ready } = useCart();

  useEffect(() => {
    if (ready) clear();
  }, [ready, clear]);

  return null;
}
