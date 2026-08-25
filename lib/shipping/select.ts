/**
 * Large Letter or parcel?
 *
 * This is the decision that actually moves money. A Large Letter under 125 g
 * is $3.40 nationally; the cheapest parcel is $10.20. Getting it right on a
 * basket of two keycap charms is the difference between postage costing more
 * than the charms and postage being an afterthought.
 *
 * A basket is letter-eligible only if **all four** rules below hold. They are
 * evaluated together, not short-circuited, so the caller can see which one
 * bound — that is what makes this debuggable when the studio disagrees with a
 * quote.
 *
 *   1. Every line's product is marked `letter_eligible`.
 *   2. Basket weight ≤ 110 g (the carrier's limit is 125; see LETTER_MARGIN).
 *   3. The footprint fits one flat layer, with packing slack.
 *   4. Thickness is the **maximum** item thickness, not the sum.
 *
 * ## Why rule 4 is allowed to use `max()`
 *
 * Taking the maximum thickness rather than the sum looks like the sort of
 * shortcut that undercharges an entire basket at once, and on its own it would
 * be. Six 12 mm charms stacked are 72 mm thick, not 12.
 *
 * It is defensible **only because rule 3 exists**. Rule 3 requires the total
 * footprint — every item's length × width, times quantity, times a packing
 * factor — to fit inside a single 240 × 340 mm rectangle. If it fits, the
 * items can be laid out side by side in one layer, and a single layer is one
 * item deep everywhere: the thickest item sets the thickness. If it does not
 * fit, rule 3 has already failed and the basket is a parcel, so `max()` is
 * never applied to a stack. The two rules are one rule wearing two hats and
 * **must not be separated**. Weakening rule 3 silently makes rule 4 wrong.
 *
 * ## What this assumes about the studio
 *
 * That the owner packs flat, single-layer: items laid out beside each other in
 * the mailer, never piled. If orders start being stacked to save an envelope,
 * rule 4 stops describing reality and letter quotes start coming back as
 * parcels at the counter. That is a packing-bench convention this file depends
 * on, and it is worth saying out loud to whoever packs.
 */

import {
  FOOTPRINT_PACKING_FACTOR,
  LETTER_LIMITS,
  LETTER_WORKING,
  PACKAGING,
  PARCEL_LIMITS,
  PARCEL_MIN,
} from "./dimensions";
import {
  basketWeight,
  lineUnitDimensionsMm,
  type ShippingLine,
} from "./weights";

export type PackagingKind = "letter" | "parcel";

/** Which of the four rules held, so a surprising verdict can be explained. */
export type LetterRuleChecks = {
  /** Rule 1: every product row is flagged letter-eligible. */
  allProductsEligible: boolean;
  /** Rule 2: weight, weighed in the letter mailer, is within the working limit. */
  withinWeight: boolean;
  /** Rule 3: the padded footprint fits one flat layer, and no item overhangs. */
  withinFootprint: boolean;
  /** Rule 4: thickest item plus mailer is within the working limit. */
  withinThickness: boolean;
};

export type PackagingSelection = {
  kind: PackagingKind;
  /** Weight in the mailer actually chosen — letter and parcel mailers differ. */
  weightGrams: number;
  /** Σ(length × width × qty) × packing factor, in mm². */
  footprintMm2: number;
  /** The single-layer budget: (260−20) × (360−20). */
  footprintBudgetMm2: number;
  /** `max(thickness)` over the basket, plus the mailer. */
  thicknessMm: number;
  /** Largest single-item length and width, for the overhang half of rule 3. */
  maxItemLengthMm: number;
  maxItemWidthMm: number;
  checks: LetterRuleChecks;
  /** Human-readable reasons a letter was refused. Empty when `kind` is "letter". */
  reasons: string[];
  /** Outer dimensions to quote a parcel with. Present for both kinds. */
  parcelDimensionsMm: { lengthMm: number; widthMm: number; heightMm: number };
};

/** The one-flat-layer budget in mm²: 240 × 340 = 81,600. */
export const FOOTPRINT_BUDGET_MM2 =
  LETTER_WORKING.lengthMm * LETTER_WORKING.widthMm;

function safeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  return Math.max(0, Math.floor(quantity));
}

/**
 * Outer dimensions for a parcel quote.
 *
 * Thickness **sums** here — the opposite of rule 4 — because a parcel is
 * exactly the case where the single-layer argument does not apply. The numbers
 * are then clamped into the range Australia Post will accept: below the
 * minimum the API is quoting something it would not carry, above 105 cm it
 * refuses outright ("The length cannot exceed 105cm").
 *
 * None of this changes the price. No cubic weighting was found at any weight
 * tested, and a 100 × 60 × 20 mm parcel and a 220 × 160 × 70 mm parcel at the
 * same weight quote identically. These dimensions exist to make the request
 * valid and honest, not to move the number.
 */
function parcelDimensions(lines: ShippingLine[]): {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
} {
  let maxLength = 0;
  let maxWidth = 0;
  let stackedThickness = 0;

  for (const line of lines) {
    const qty = safeQuantity(line.quantity);
    if (qty === 0) continue;
    const dims = lineUnitDimensionsMm(line);
    maxLength = Math.max(maxLength, dims.lengthMm);
    maxWidth = Math.max(maxWidth, dims.widthMm);
    stackedThickness += dims.thicknessMm * qty;
  }

  const maxMm = PARCEL_LIMITS.lengthCm * 10;
  const clamp = (value: number, min: number) =>
    Math.min(maxMm, Math.max(min, Math.ceil(value)));

  return {
    lengthMm: clamp(maxLength + PACKAGING.parcelWallMm, PARCEL_MIN.lengthMm),
    widthMm: clamp(maxWidth + PACKAGING.parcelWallMm, PARCEL_MIN.widthMm),
    heightMm: clamp(
      stackedThickness + PACKAGING.parcelWallMm,
      PARCEL_MIN.heightMm,
    ),
  };
}

/**
 * Decide how this basket travels.
 *
 * Pure and synchronous: no network, no database, no clock. Given the same
 * lines it always returns the same verdict, which is what lets the cart and
 * the checkout route agree without coordinating.
 */
export function selectPackaging(lines: ShippingLine[]): PackagingSelection {
  const active = lines.filter((line) => safeQuantity(line.quantity) > 0);
  const parcelDims = parcelDimensions(active);

  // An empty basket has no shape and no weight worth arguing about. Call it a
  // parcel so no caller can talk itself into a $3.40 quote for nothing.
  if (active.length === 0) {
    return {
      kind: "parcel",
      weightGrams: basketWeight(active, "parcel"),
      footprintMm2: 0,
      footprintBudgetMm2: FOOTPRINT_BUDGET_MM2,
      thicknessMm: PACKAGING.mailerThicknessMm,
      maxItemLengthMm: 0,
      maxItemWidthMm: 0,
      checks: {
        allProductsEligible: false,
        withinWeight: true,
        withinFootprint: true,
        withinThickness: true,
      },
      reasons: ["basket is empty"],
      parcelDimensionsMm: parcelDims,
    };
  }

  // Rule 1 — every product, not most of them. One pet bowl makes the whole
  // order a parcel however many charms are riding along with it.
  const allProductsEligible = active.every(
    (line) => line.product.letter_eligible === true,
  );

  // Rule 2 — weighed in the *letter* mailer, because that is the package we
  // would actually be posting if the answer turns out to be yes.
  const letterWeight = basketWeight(active, "letter");
  const withinWeight = letterWeight <= LETTER_WORKING.weightGrams;

  // Rule 3 — one flat layer. Two halves: the total area has to fit the
  // rectangle, and no single item may overhang it however small the basket.
  let footprintRaw = 0;
  let maxItemLengthMm = 0;
  let maxItemWidthMm = 0;
  let maxThicknessMm = 0;

  for (const line of active) {
    const qty = safeQuantity(line.quantity);
    const dims = lineUnitDimensionsMm(line);
    footprintRaw += dims.lengthMm * dims.widthMm * qty;
    maxItemLengthMm = Math.max(maxItemLengthMm, dims.lengthMm);
    maxItemWidthMm = Math.max(maxItemWidthMm, dims.widthMm);
    maxThicknessMm = Math.max(maxThicknessMm, dims.thicknessMm);
  }

  const footprintMm2 = footprintRaw * FOOTPRINT_PACKING_FACTOR;
  const withinFootprint =
    footprintMm2 <= FOOTPRINT_BUDGET_MM2 &&
    maxItemLengthMm <= LETTER_WORKING.lengthMm &&
    maxItemWidthMm <= LETTER_WORKING.widthMm;

  // Rule 4 — max, not sum. Legitimate only while rule 3 holds; see the file
  // comment. The verdict below ANDs them, so `max()` never survives a
  // footprint failure.
  const thicknessMm = maxThicknessMm + PACKAGING.mailerThicknessMm;
  const withinThickness = thicknessMm <= LETTER_WORKING.thicknessMm;

  const isLetter =
    allProductsEligible && withinWeight && withinFootprint && withinThickness;

  const reasons: string[] = [];
  if (!allProductsEligible) {
    reasons.push("a product in the basket is not letter-eligible");
  }
  if (!withinWeight) {
    reasons.push(
      `weight ${letterWeight} g exceeds the ${LETTER_WORKING.weightGrams} g working limit ` +
        `(carrier limit ${LETTER_LIMITS.weightGrams} g)`,
    );
  }
  if (!withinFootprint) {
    if (footprintMm2 > FOOTPRINT_BUDGET_MM2) {
      reasons.push(
        `footprint ${Math.round(footprintMm2)} mm² exceeds the single-layer budget ` +
          `of ${FOOTPRINT_BUDGET_MM2} mm²`,
      );
    }
    if (maxItemLengthMm > LETTER_WORKING.lengthMm) {
      reasons.push(
        `an item is ${maxItemLengthMm} mm long, over the ${LETTER_WORKING.lengthMm} mm working limit`,
      );
    }
    if (maxItemWidthMm > LETTER_WORKING.widthMm) {
      reasons.push(
        `an item is ${maxItemWidthMm} mm wide, over the ${LETTER_WORKING.widthMm} mm working limit`,
      );
    }
  }
  if (!withinThickness) {
    reasons.push(
      `thickness ${thicknessMm} mm exceeds the ${LETTER_WORKING.thicknessMm} mm working limit ` +
        `(carrier limit ${LETTER_LIMITS.thicknessMm} mm)`,
    );
  }

  return {
    kind: isLetter ? "letter" : "parcel",
    weightGrams: isLetter ? letterWeight : basketWeight(active, "parcel"),
    footprintMm2,
    footprintBudgetMm2: FOOTPRINT_BUDGET_MM2,
    thicknessMm,
    maxItemLengthMm,
    maxItemWidthMm,
    checks: {
      allProductsEligible,
      withinWeight,
      withinFootprint,
      withinThickness,
    },
    reasons: isLetter ? [] : reasons,
    parcelDimensionsMm: parcelDims,
  };
}
