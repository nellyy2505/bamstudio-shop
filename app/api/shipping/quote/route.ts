import { NextResponse } from "next/server";
import { z } from "zod";
import { BASKET_LIMITS, BUILDER_MAX_LETTERS, SHIPPING } from "@/lib/config";
import { loadProductsBySlug, loadScoopTiersBySlug } from "@/lib/queries";
import { clientKey, rateLimitDurable } from "@/lib/rate-limit";
import { toShippingLines } from "@/lib/shipping/lines";
import { toScoopShippingLines } from "@/lib/scoop-line";
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

/**
 * A Lucky Scoop line. Slug and quantity, and nothing else — a scoop has no
 * colour, no finding and no letters, and its weight comes from the TIER row the
 * server loads, never from the browser.
 *
 * Separate from `LineSchema` rather than folded into it, because the two
 * resolve against different tables. `scoop_tiers.slug` and `products.slug` are
 * separate unique indexes; the same string can legitimately exist in both, and
 * a single array of bare slugs would leave this route guessing which table a
 * line meant — with "guessed wrong" costing a weight, and therefore a postage
 * price, taken from the wrong object.
 */
const ScoopLineSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
});

const BodySchema = z
  .object({
    // The same two caps checkout enforces, from the same place — see
    // BASKET_LIMITS in lib/config.ts. If this schema and checkout's ever
    // disagreed, a basket would quote here and then be refused at payment, or
    // quote as "Calculated at checkout" and then go through.
    //
    // `min(1)` has moved off the array and onto the refinement below: a basket
    // holding only scoops has no product lines at all, and neither array being
    // required to be non-empty on its own is what lets that basket quote. The
    // cap is on the TOTAL for the same reason — forty of each is eighty lines,
    // which checkout would refuse after the customer had been shown a price.
    lines: z.array(LineSchema).default([]),
    scoop_lines: z.array(ScoopLineSchema).default([]),
  })
  .refine(
    (body) =>
      body.lines.length + body.scoop_lines.length >= 1 &&
      body.lines.length + body.scoop_lines.length <= BASKET_LIMITS.maxLines,
  );

export async function POST(request: Request) {
  // A cart re-quotes on every basket edit, so this is looser than checkout's
  // 10/60s. It reads no customer data and returns no customer data — the only
  // thing being protected is the carrier call underneath, which is cached.
  //
  // Durable, and `await`ed: the carrier call is a paid third-party request, and
  // an allowance that resets on every deploy is not much of a budget. Without
  // the `await` this reads a Promise, `!limit.ok` is true, and the cart shows
  // "calculated at checkout" to everyone — nothing in the lint config catches
  // it, so it is checked by reading. lib/rate-limit.ts bounds the store call.
  const limit = await rateLimitDurable(
    clientKey(request, "shipping-quote"),
    60,
    60_000,
  );
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

  const [products, tiers] = await Promise.all([
    loadProductsBySlug(body.lines.map((l) => l.slug)),
    loadScoopTiersBySlug(body.scoop_lines.map((l) => l.slug)),
  ]);

  /*
   * One basket, weighed as one package. The two builders differ only in which
   * table a line's weight comes from — `toScoopShippingLines` explains why a
   * scoop is always quoted as a parcel — and both hand back the same
   * `ShippingLine` shape, so `quoteBasket()` remains the single entry point
   * that checkout also calls.
   *
   * A SCOOP THAT HAS STOPPED BEING SELLABLE STILL QUOTES HERE, deliberately.
   * `availability.sellable` is a decision about whether the shop may take money
   * for a tier — switched on, and priced — and it is not a fact about what the
   * parcel weighs. Refusing to weigh a tier the owner has since switched off
   * would replace a real postage figure with "calculated at checkout" and tell
   * the customer nothing about the actual problem, which checkout then states
   * plainly when they try to pay. Products behave the same way — an oversold
   * one still quotes.
   *
   * This used to read "refusing to weigh an emptied bowl", from the days when
   * `sellable` folded in whether the pool could fill a scoop off the shelf.
   * That gate is gone: the shop prints to order, so a short bowl is printed up
   * before packing and never reaches this route as a refusal at all. Nothing
   * about stock has quoted, or should quote, differently from any other product
   * (lib/scoop.ts).
   */
  const lines = [
    ...toShippingLines(body.lines, products),
    ...toScoopShippingLines(body.scoop_lines, tiers),
  ];

  /*
   * A line the server has no row for is dropped by the builders, and a basket
   * that loses every line is an *empty* basket to quoteBasket() — which
   * correctly prices nothing at zero. That combination would have shown a
   * customer FREE postage for a basket of retired products, so refuse instead:
   * this basket cannot be measured, and "calculated at checkout" is the honest
   * thing for the cart to show.
   *
   * A tier that RLS no longer publishes — deactivated, or unpriced again — is
   * dropped by exactly the same arithmetic, which is the intended answer: an
   * unpublished tier is not a thing whose postage can be quoted.
   *
   * Checkout answers the same case with a 409 naming the product, and is the
   * surface that matters — no money can be taken here. Matching the status
   * keeps the two routes telling the same story about the same basket.
   */
  if (lines.length !== body.lines.length + body.scoop_lines.length) {
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
