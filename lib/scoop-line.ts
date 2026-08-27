/**
 * A Lucky Scoop as a *line* — in a basket, on a Stripe session, and in
 * `order_items`.
 *
 * `lib/scoop.ts` holds the rules (is this tier sellable, what did a pack cost).
 * This file holds the one thing those rules do not answer: what a scoop looks
 * like once it is something a customer has put in a basket and paid for. It is
 * pure — no Supabase, no Stripe, no `next/*` — so the buy control, the two
 * quote paths, the checkout route and the Stripe webhook can all import it
 * without dragging server-only code across a boundary.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE FACT EVERYTHING BELOW IS DERIVED FROM
 *
 * A SCOOP IS SOLD BEFORE ITS CONTENTS ARE DECIDED. At the moment money changes
 * hands nobody knows which products go in it, so a scoop line:
 *
 *   * carries `scoop_tier_id` and **never** `product_id` — the two are mutually
 *     exclusive in the schema (0007_lucky_scoop.sql), and a product id on a
 *     scoop line is not a cosmetic error: it is what would decrement the shelf
 *     count of a product nobody has drawn yet;
 *   * takes `product_name` from the TIER, because "Pet scoop" is what the
 *     customer bought and what every existing screen already renders;
 *   * leaves `unit_cost_cents` NULL until the studio records the pack. There is
 *     no recipe to cost it from, and a plausible-looking zero here is a 100%
 *     margin on something that has not been made yet;
 *   * moves no stock at sale. Stock comes off in the pack panel, one
 *     `decrement_stock` per piece, guarded by `scoop_packs.stock_applied`.
 * ───────────────────────────────────────────────────────────────────────────
 */

import type { ArtKey, ScoopTheme, ScoopTier, Tint } from "@/lib/types";
import type { ShippingLine } from "@/lib/shipping/weights";

/* ------------------------------------------------------------- what it is */

/**
 * Everything a *line* needs from a tier row. Deliberately narrower than
 * `ScoopTier`: `sort_order`, `blurb` and `created_at` have nothing to do with
 * selling one, and a type that accepted them would invite a caller to think
 * they might.
 */
export type ScoopSellable = Pick<
  ScoopTier,
  | "id"
  | "slug"
  | "name"
  | "theme"
  | "piece_count"
  | "price_cents"
  | "packed_weight_grams"
  | "packed_thickness_mm"
>;

/* ------------------------------------------------------- how it is written */

/**
 * The line's `variant_label` — "5 pieces".
 *
 * The one thing about a scoop that is knowable at sale time and is a term of
 * the sale: how many pieces were promised. It is written onto the order line
 * rather than joined to the tier at read time, for the reason `unit_price` is:
 * `scoop_tiers.piece_count` is editable in the studio, and what THIS customer
 * was promised must not change when she edits the tier next month.
 *
 * Every screen that renders an order — /track, /account/orders/[id], the
 * confirmation email, the studio's packing list — already prints
 * `variant_label` under `product_name`, so "Pet scoop / 5 pieces" reaches all
 * of them with no screen having to learn what a scoop is.
 */
export function scoopVariantLabel(pieceCount: number): string {
  return `${pieceCount} ${pieceCount === 1 ? "piece" : "pieces"}`;
}

/**
 * Illustrated stand-in artwork for a scoop, by theme.
 *
 * `order_items.art` and `order_items.tint` are NOT NULL with no default
 * (0001_init.sql) and a scoop has no product row to take them from, so a value
 * has to come from somewhere. It comes from here, from the theme the customer
 * chose, and this is the ONLY place it is decided — the staged checkout path
 * and the webhook's Stripe-rebuild path both read this map, so a rebuilt scoop
 * line renders identically to the one checkout would have written.
 *
 * This is decoration and nothing else: it is a picture where a photograph
 * would go, exactly as `ProductArt` is for the catalogue. Nothing prices,
 * weighs, costs or picks a piece from it. An unrecognised theme falls to the
 * mixed bowl rather than throwing — a wrong illustration is not worth failing
 * a paid order over, and `scoop_tiers.theme` is CHECK-constrained to these four
 * anyway.
 */
const SCOOP_ART: Record<ScoopTheme, { art: ArtKey; tint: Tint }> = {
  pet: { art: "corgi", tint: "butter" },
  household: { art: "butter", tint: "sage" },
  clickers_keyrings: { art: "macaron", tint: "blush" },
  mixed: { art: "icecream", tint: "lilac" },
};

const SCOOP_ART_FALLBACK = SCOOP_ART.mixed;

export function scoopArt(theme: string | null | undefined): {
  art: ArtKey;
  tint: Tint;
} {
  return SCOOP_ART[theme as ScoopTheme] ?? SCOOP_ART_FALLBACK;
}

/* ------------------------------------------- how it survives a Stripe trip */

/**
 * The keys checkout stamps on a scoop line's inline Stripe product metadata,
 * and the webhook reads back off it.
 *
 * WHY THIS EXISTS AT ALL. When the database was unreachable at checkout no
 * order was staged, and the webhook rebuilds the whole order from the Stripe
 * session (`fillItemsFromStripe`). That path resolves each line to a product
 * row **by slug**, and `scoop_tiers.slug` and `products.slug` are separate
 * unique indexes on separate tables — nothing stops a tier called
 * `mixed-scoop` and a product called `mixed-scoop` existing side by side. A
 * rebuild with no marker would look the tier's slug up in `products`, find a
 * charm, write its `product_id` onto the line, and then take that charm off the
 * shelf for a scoop nobody has drawn. The marker is what makes the rebuild able
 * to tell one kind of line from the other before it looks anything up.
 *
 * `tier` carries the tier's **id**, not its slug, because the id is what
 * `order_items.scoop_tier_id` needs and a slug can be renamed between the
 * session being created and a delayed payment clearing days later.
 *
 * Stripe caps metadata at 50 keys and 500 characters per value; three short
 * strings are comfortably inside both.
 */
export const SCOOP_METADATA = {
  /** `scoop_tiers.id` — what `order_items.scoop_tier_id` is written from. */
  tier: "scoop_tier",
  /** The promised piece count, so the rebuild can write `variant_label`. */
  pieces: "scoop_pieces",
  /** The tier's theme, so the rebuild picks the same artwork checkout would. */
  theme: "scoop_theme",
} as const;

/** The metadata block checkout attaches to a scoop's Stripe line. */
export function scoopLineMetadata(tier: ScoopSellable): Record<string, string> {
  return {
    slug: tier.slug,
    [SCOOP_METADATA.tier]: tier.id,
    [SCOOP_METADATA.pieces]: String(tier.piece_count),
    [SCOOP_METADATA.theme]: tier.theme,
  };
}

/* ---------------------------------------------------------------- postage */

/**
 * A tier's postage line.
 *
 * ## Why a scoop is quoted as a parcel, always
 *
 * `ShippableProduct.letter_eligible` is documented as "absent means false", so
 * leaving it off would already produce a parcel. It is set **explicitly** here
 * anyway, because absent-means-false is a default and this is a decision:
 * 0007_lucky_scoop.sql deliberately gives `scoop_tiers` no `letter_eligible`
 * column at all, and says why — a Large Letter is untracked and uninsured, and
 * a parcel whose contents were chosen at random is the last one the studio
 * should be sending that way. If it went missing there is no reprint to fall
 * back on: the pieces that were in it were drawn from a bowl and are gone.
 * Writing `false` here records that argument at the one line of code where a
 * future reader would otherwise have to guess whether the column had merely
 * been forgotten.
 *
 * It also means a scoop makes the WHOLE basket a parcel — `selectPackaging`
 * rule 1 is "every line's product is letter-eligible", not most of them — which
 * is correct: the scoop is going in the same mailer as the charms.
 *
 * ## Where the numbers come from
 *
 * `packed_weight_grams` is the tier's own worst-case weight, deliberately the
 * heaviest plausible pack rather than the average, so the studio wears the
 * difference rather than the customer. It is treated here as the weight of the
 * scoop's CONTENTS as they go into the mailer: `basketWeight()` then adds the
 * per-item wrap and the mailer itself on top, exactly as it does for a product.
 * That is the direction `lib/shipping/dimensions.ts` requires — every estimate
 * rounds toward the shop paying — and it means a scoop and a charm are weighed
 * by one expression rather than two.
 *
 * A tier with no packed weight cannot be ACTIVATED (0007), and an inactive tier
 * is not sellable, so checkout has already refused it before this is reached.
 * Note the direction: the weight check is a condition of activation, upstream of
 * `sellable`, and NOT one of the questions `sellable` itself asks — it asks two,
 * switched on and priced, and nothing else since the stock gate was removed
 * (`lib/scoop.ts`). This line used to claim an unweighed tier was directly "not
 * sellable"; a reader taking that literally would go looking for a weight test
 * in `tierAvailability` and not find one.
 *
 * Passing the null through rather than substituting a number is still the right
 * shape: `resolveItemDimensions` falls to `DEFAULT_DIMENSIONS`, which is the
 * heaviest, bulkiest entry in the table on purpose. An unmeasured thing quotes
 * as an expensive parcel; it never quotes cheap.
 *
 * Length and width are the same story and there is no dishonesty in the gap: a
 * tier carries no footprint because nobody has measured a packed scoop's
 * outline, so the catch-all applies. Neither dimension can move the price —
 * `lib/shipping/select.ts` records that no cubic weighting was found at any
 * weight tested, and the letter rules that DO read a footprint are unreachable
 * for a line that is never letter-eligible. They exist to make the carrier
 * request valid and plausible, which they are.
 *
 * The category string is deliberately one `CATEGORY_DEFAULTS` does not carry,
 * so the catch-all is what answers. Naming a real category here would borrow a
 * charm's or a bowl's measurements for something that is neither.
 */
export function toScoopShippingLine(
  tier: Pick<ScoopSellable, "packed_weight_grams" | "packed_thickness_mm">,
  quantity: number,
): ShippingLine {
  return {
    product: {
      // Not a key in CATEGORY_DEFAULTS: a scoop borrows nothing's measurements.
      category: "Lucky Scoop",
      // See the note above. A decision, not a default.
      letter_eligible: false,
      weight_grams: tier.packed_weight_grams,
      // No tier carries a footprint. Null falls to DEFAULT_DIMENSIONS, which is
      // the bulkiest row in the table on purpose.
      length_mm: null,
      width_mm: null,
      thickness_mm: tier.packed_thickness_mm,
    },
    quantity,
    // A scoop has no finding and no letters. Both stay absent rather than being
    // spelled as empty values that a reader could mistake for a choice.
    attachment_id: null,
    custom: null,
  };
}

/**
 * The scoop half of a basket, as postage lines.
 *
 * `toShippingLines()` in `lib/shipping/lines.ts` is the equivalent for
 * products, and the rule it exists to enforce holds here too: **the cart's
 * quote route and the checkout route must build this array with the same
 * function.** Two code paths computing postage is how the price a customer
 * agreed to and the price Stripe charges come to differ — silently, and only
 * for some baskets. There is one builder for scoops, and it is this one.
 *
 * A slug with no tier row is skipped rather than guessed at, matching
 * `toShippingLines`. Both callers compare the returned length against what they
 * sent and refuse the basket when it is short, so a dropped line can never
 * quietly become free postage.
 */
export function toScoopShippingLines(
  lines: { slug: string; quantity: number }[],
  tiers: Map<string, ScoopSellable>,
): ShippingLine[] {
  const out: ShippingLine[] = [];

  for (const line of lines) {
    const tier = tiers.get(line.slug);
    if (!tier) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    out.push(toScoopShippingLine(tier, line.quantity));
  }

  return out;
}
