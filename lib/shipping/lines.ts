import type { Product } from "@/lib/types";
import type { ShippingLine } from "./weights";

/**
 * Building the `ShippingLine[]` that `quoteBasket()` takes, from a request body
 * and the product rows the server loaded for it.
 *
 * This module exists so that the cart's quote route and the checkout route
 * cannot build that array differently. Two code paths computing postage is how
 * the price a customer agreed to and the price Stripe charges come to differ —
 * silently, and only for some baskets. There is one builder, and it is here.
 *
 * Weights come from the `Product` row, never from the request: the browser says
 * which product and how many, and nothing else. A basket that could name its
 * own weight could name its own postage.
 */

/**
 * The subset of a basket line that postage actually depends on. Deliberately
 * narrower than checkout's `LineSchema` — colour and personalisation text do
 * not change what a parcel weighs, and a type that accepted them would invite a
 * caller to think they might.
 */
export type QuotableLine = {
  slug: string;
  quantity: number;
  attachment_id?: string | null;
  custom?: { letters: string; with_charm: boolean } | null;
};

export function toShippingLines(
  lines: QuotableLine[],
  products: Map<string, Product>,
): ShippingLine[] {
  const out: ShippingLine[] = [];

  for (const line of lines) {
    const product = products.get(line.slug);
    // A slug with no row is skipped rather than guessed at. Checkout has
    // already rejected an unknown slug with a 409 before it quotes, so this is
    // reachable only from the cart route, where under-reporting a basket the
    // server cannot measure beats inventing a weight for it.
    if (!product) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;

    out.push({
      product,
      quantity: line.quantity,
      attachment_id: line.attachment_id ?? null,
      custom: line.custom ?? null,
    });
  }

  return out;
}
