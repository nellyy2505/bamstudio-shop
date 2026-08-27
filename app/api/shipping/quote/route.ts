import { NextResponse } from "next/server";
import { z } from "zod";
import { BASKET_LIMITS, BUILDER_MAX_LETTERS, SHIPPING } from "@/lib/config";
import { loadProductsBySlug } from "@/lib/queries";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { toShippingLines } from "@/lib/shipping/lines";
import { quoteBasket } from "@/lib/shipping/quote";

export const runtime = "nodejs";

/**
 * Postage for a basket, for the cart to display before checkout.
 *
 * The rules this route exists to keep:
 *
 *  - **It calls `quoteBasket()` and nothing else.** So does checkout. Two code
 *    paths computing postage is how the price a customer agreed to and the
 *    price Stripe charges come to differ — silently, and only for some baskets.
 *  - **It takes slugs and quantities, never weights or prices.** Product rows
 *    are loaded server-side. A basket that could name its own weight could name
 *    its own postage.
 *  - **It does not decide who pays.** It answers what Australia Post charges.
 *    Whether the customer is charged it is `isFreeShipping()` in `lib/config.ts`,
 *    which the cart and checkout both apply to the same subtotal.
 *  - **It never fails the cart.** `quoteBasket()` does not throw and does not
 *    return zero for a non-empty basket; the worst case is a pessimistic
 *    `source: "fallback"` figure, which the cart labels as an estimate.
 *
 * Both methods are quoted in one call because the cart shows a price against
 * each option in the delivery picker. Quoting them separately would be two
 * round trips for one decision, and would let the picker and the summary
 * disagree while the second was in flight.
 */
const LineSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
  attachment_id: z.string().max(60).nullable().optional(),
  custom: z
    .object({
      letters: z
        .string()
        .min(1)
        .max(BUILDER_MAX_LETTERS)
        .regex(/^[A-Za-z]+$/, "Letters only."),
      with_charm: z.boolean(),
    })
    .nullable()
    .optional(),
});

const BodySchema = z.object({
  // The same two caps checkout enforces, from the same place — see
  // BASKET_LIMITS in lib/config.ts. If this schema and checkout's ever
  // disagreed, a basket would quote here and then be refused at payment, or
  // quote as "Calculated at checkout" and then go through.
  lines: z.array(LineSchema).min(1).max(BASKET_LIMITS.maxLines),
});

export async function POST(request: Request) {
  // A cart re-quotes on every basket edit, so this is looser than checkout's
  // 10/60s. It reads no customer data and returns no customer data — the only
  // thing being protected is the carrier call underneath, which is cached.
  const limit = rateLimit(clientKey(request, "shipping-quote"), 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "We could not read that basket." },
      { status: 400 },
    );
  }

  const products = await loadProductsBySlug(body.lines.map((l) => l.slug));
  const lines = toShippingLines(body.lines, products);

  /*
   * A line the server has no row for is dropped by toShippingLines(), and a
   * basket that loses every line is an *empty* basket to quoteBasket() — which
   * correctly prices nothing at zero. That combination would have shown a
   * customer FREE postage for a basket of retired products, so refuse instead:
   * this basket cannot be measured, and "calculated at checkout" is the honest
   * thing for the cart to show.
   *
   * Checkout answers the same case with a 409 naming the product, and is the
   * surface that matters — no money can be taken here. Matching the status
   * keeps the two routes telling the same story about the same basket.
   */
  if (lines.length !== body.lines.length) {
    return NextResponse.json(
      { error: "Something in your basket is no longer available." },
      { status: 409 },
    );
  }

  // Every method the shop offers, quoted from the same lines.
  const entries = await Promise.all(
    SHIPPING.methods.map(async (method) => {
      const quote = await quoteBasket(lines, method.id);
      return [
        method.id,
        {
          amountCents: quote.amountCents,
          tracked: quote.tracked,
          weightGrams: quote.weightGrams,
          // "fallback" means the carrier could not be reached and the figure
          // came from the built-in table, which deliberately returns the band
          // above the one the basket falls in. The cart says "estimated" on it.
          estimated: quote.source === "fallback",
        },
      ] as const;
    }),
  );

  return NextResponse.json({ ok: true, quotes: Object.fromEntries(entries) });
}
