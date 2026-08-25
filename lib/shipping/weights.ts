/**
 * Turning a basket into a number of grams.
 *
 * Two things matter here.
 *
 * 1. **Input is product rows, not client JSON.** The browser tells us *which*
 *    product and how many; it does not tell us how much the thing weighs.
 *    Everything a price depends on is read from a row the server loaded. A
 *    basket that could name its own weight could name its own postage.
 * 2. **Rounding is one-directional.** Every estimate here rounds up and the
 *    total rounds up again to the next 5 g. See `dimensions.ts` for why.
 */

import {
  BUILDER_DIMENSIONS,
  BUILDER_WEIGHT,
  CATEGORY_DEFAULTS,
  DEFAULT_DIMENSIONS,
  PACKAGING,
  WEIGHT_ROUNDING_GRAMS,
  attachmentWeightGrams,
  roundUpGrams,
  type ItemDimensions,
} from "./dimensions";

/**
 * The slice of a product row this module needs.
 *
 * Declared structurally rather than imported from `lib/types.ts` on purpose.
 * The shipping columns (`letter_eligible` and the optional measurements) are
 * being added to `Product` and to the `products` table by separate work; a
 * structural type means this module compiles and behaves correctly both before
 * and after that lands, and any `Product` carrying these fields satisfies it
 * without a cast.
 */
export type ShippableProduct = {
  category: string;
  /**
   * Whether this product may travel as a Large Letter *at all* — flat enough,
   * robust enough, and not something a sorting machine would crush.
   *
   * **Absent means false.** An unmeasured product is quoted as a parcel. That
   * is the safe direction, and it means the whole module behaves correctly
   * before the column exists: everything quotes as a parcel, nobody is
   * undercharged, and letter pricing switches itself on per product as the
   * studio measures them.
   */
  letter_eligible?: boolean | null;
  /** Measured weight in grams. Falls back to the category default. */
  weight_grams?: number | null;
  /** Measured dimensions in millimetres. Fall back to the category default. */
  length_mm?: number | null;
  width_mm?: number | null;
  thickness_mm?: number | null;
};

/**
 * One line of the basket as the server sees it: a loaded product row, how many
 * of it, and the personalisation that changes its physical form.
 *
 * `custom` mirrors `CartLine["custom"]` in `lib/types.ts` — a builder charm's
 * weight and length both depend on how many letters were chosen.
 */
export type ShippingLine = {
  product: ShippableProduct;
  quantity: number;
  attachment_id?: string | null;
  custom?: {
    letters: string;
    with_charm: boolean;
  } | null;
};

/** Which mailer the order goes in. Chosen by `select.ts`, not here. */
export type MailerKind = "letter" | "parcel";

/** A product's own measurements if it has them, else its category's, else the catch-all. */
export function resolveItemDimensions(
  product: ShippableProduct,
): ItemDimensions {
  const base = CATEGORY_DEFAULTS[product.category] ?? DEFAULT_DIMENSIONS;
  return {
    weightGrams: product.weight_grams ?? base.weightGrams,
    lengthMm: product.length_mm ?? base.lengthMm,
    widthMm: product.width_mm ?? base.widthMm,
    thicknessMm: product.thickness_mm ?? base.thicknessMm,
  };
}

/** True when this line is an assembled keycap name charm. */
export function isBuilderLine(line: ShippingLine): boolean {
  return Boolean(line.custom);
}

/**
 * Weight of **one** unit of a line, attachment included.
 *
 * A builder charm is computed from its parts because there is no such thing as
 * a stock weight for it — a one-letter charm and a five-letter charm are
 * different objects. Everything else uses its measured or assumed weight.
 *
 * The attachment is added in both branches. It is a separate physical part
 * that goes in the same mailer; forgetting it is the easiest way to under-read
 * a basket by 5 g per line.
 */
export function lineUnitWeightGrams(line: ShippingLine): number {
  const attachment = attachmentWeightGrams(line.attachment_id);

  if (line.custom) {
    const letters = line.custom.letters.length;
    return (
      BUILDER_WEIGHT.baseGrams +
      letters * BUILDER_WEIGHT.perLetterGrams +
      (line.custom.with_charm ? BUILDER_WEIGHT.charmGrams : 0) +
      attachment
    );
  }

  return resolveItemDimensions(line.product).weightGrams + attachment;
}

/**
 * Footprint and thickness of **one** unit of a line.
 *
 * A builder charm's length grows with the name: the caps sit in a row, so a
 * five-letter charm is genuinely longer than a two-letter one, and a basket of
 * long names stops fitting a letter mailer sooner than a basket of short ones.
 */
export function lineUnitDimensionsMm(line: ShippingLine): {
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
} {
  if (line.custom) {
    const letters = line.custom.letters.length;
    return {
      lengthMm:
        BUILDER_DIMENSIONS.baseLengthMm +
        letters * BUILDER_DIMENSIONS.perLetterLengthMm,
      widthMm: BUILDER_DIMENSIONS.widthMm,
      thicknessMm: BUILDER_DIMENSIONS.thicknessMm,
    };
  }
  const dims = resolveItemDimensions(line.product);
  return {
    lengthMm: dims.lengthMm,
    widthMm: dims.widthMm,
    thicknessMm: dims.thicknessMm,
  };
}

/** Quantities are the one number the client supplies; treat them defensively. */
function safeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.floor(quantity));
}

/** The weight of the contents alone, before any packaging. */
export function contentsWeightGrams(lines: ShippingLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += lineUnitWeightGrams(line) * safeQuantity(line.quantity);
  }
  return total;
}

/**
 * What the counter's scale will read: contents, plus a share of wrapping for
 * every item, plus the mailer, rounded **up** to the next 5 g.
 *
 * The mailer defaults to `"parcel"` because that is the heavier of the two and
 * therefore the safe answer for any caller that has not yet decided. In
 * practice `select.ts` calls this twice — once as a letter to test eligibility,
 * once as a parcel once it knows — which is why the mailer is a parameter
 * rather than something this function works out for itself. It cannot: whether
 * a basket fits a letter depends on the weight, and the weight depends on the
 * mailer.
 */
export function basketWeight(
  lines: ShippingLine[],
  mailer: MailerKind = "parcel",
): number {
  let padding = 0;
  for (const line of lines) {
    padding += PACKAGING.perItemPaddingGrams * safeQuantity(line.quantity);
  }

  const mailerGrams =
    mailer === "letter"
      ? PACKAGING.letterMailerGrams
      : PACKAGING.parcelMailerGrams;

  const total = contentsWeightGrams(lines) + padding + mailerGrams;
  return roundUpGrams(total, WEIGHT_ROUNDING_GRAMS);
}
