/**
 * What a piece costs to make, and what it should therefore sell for.
 *
 * This is the planner workbook's Products sheet, columns T through AA, moved
 * into code. The formulas are hers; the arithmetic below is a transcription,
 * not an improvement, and where it differs from the workbook the difference is
 * called out in a comment. Anything else would mean her spreadsheet and her
 * website disagree about her margins, and she would have no way to tell which
 * one was lying.
 *
 * The workbook, for reference:
 *
 *   T  filament       = totalGrams * $/kg / 1000
 *   U  machine+power  = printHours * Settings!C12
 *   V  accessory      = the one accessory on the product
 *   W  packaging      = Settings!C37
 *   X  UNIT COST      = T + U + V + W
 *   Y  suggested      = CEILING(X / (1 - margin - cardFee), roundTo)
 *   AA profit/unit    = (myPrice or suggested) * (1 - cardFee) - X
 *
 * and Settings!C12, the machine-and-power hourly rate, is itself
 *
 *   C8  machine  = printerPrice / lifeHours
 *   C11 power    = watts / 1000 * $/kWh
 *   C12          = C8 + C11
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING HERE IS IN CENTS, AND MOST OF IT IS FRACTIONAL CENTS.
 *
 * A keyring costs $9.50 per hundred — 9.5 cents each. Packaging is 13 cents.
 * The machine, at $1049 over 10,000 hours, is 10.49 cents an hour. Round any of
 * those to a whole cent as it goes past and a $2.50 product's cost moves by a
 * few per cent, which at a 70% target margin is real money on a market table.
 *
 * So: `number`, not integers, all the way through, and exactly one rounding —
 * at the end, into the price, in the direction the workbook rounds (up, to the
 * nearest 50c). Money that is *charged* is still an integer number of cents;
 * money that is *computed about* is not.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure functions with no imports on purpose: this file is the one piece of the
 * studio that can be checked against a spreadsheet by reading it.
 */

/** The constants row — `shop_settings`, as numbers. */
export type CostSettings = {
  printerPriceCents: number;
  printerLifeHours: number;
  powerDrawWatts: number;
  /** Cents per kWh. 32.7 is $0.327. */
  electricityPerKwhCents: number;
  /** Cents per 1kg roll. 1600 is $16. */
  filamentPerKgCents: number;
  /** 0.7 is 70%. */
  targetMargin: number;
  /** 0.016 is 1.6%. */
  cardFeeRate: number;
  /** Round the suggested price up to this many cents. 50 is "to the nearest 50c". */
  roundPriceToCents: number;
  packagingPerUnitCents: number;
};

/** Machine depreciation per print hour, in cents. Workbook Settings!C8. */
export function machineCostPerHour(s: CostSettings): number {
  if (s.printerLifeHours <= 0) return 0;
  return s.printerPriceCents / s.printerLifeHours;
}

/** Electricity per print hour, in cents. Workbook Settings!C11. */
export function powerCostPerHour(s: CostSettings): number {
  return (s.powerDrawWatts / 1000) * s.electricityPerKwhCents;
}

/** Workbook Settings!C12 — the single rate the Products sheet multiplies by. */
export function machineAndPowerPerHour(s: CostSettings): number {
  return machineCostPerHour(s) + powerCostPerHour(s);
}

/**
 * What one unit costs to make, broken into the four parts the workbook shows,
 * so the studio can see which one is the problem rather than just the total.
 *
 * `printHours` and `grams` are nullable because most of her catalogue has never
 * been measured. Null is carried through to `unknown: true` rather than
 * substituted with zero — a product nobody has timed is not a product that
 * prints instantly, and a cost of $0.13 (packaging alone) shown as if it were
 * real is how you price a piece at fifty cents.
 */
export type CostBreakdown = {
  filament: number;
  machineAndPower: number;
  accessory: number;
  packaging: number;
  total: number;
  /**
   * True when an input is missing, so `total` is a floor rather than a cost.
   * Every screen that shows a cost must branch on this.
   */
  unknown: boolean;
  /** Which inputs are missing, in words, for the studio to go and fill in. */
  missing: string[];
};

export function unitCost(
  s: CostSettings,
  input: {
    printHours: number | null;
    /** Total grams across every colour the piece uses. */
    grams: number | null;
    /** The one accessory on this product, in cents. Zero if it has none. */
    accessoryCents: number;
  },
): CostBreakdown {
  const missing: string[] = [];
  if (input.printHours === null) missing.push("print time");
  if (input.grams === null) missing.push("filament weight");

  const filament = ((input.grams ?? 0) * s.filamentPerKgCents) / 1000;
  const machineAndPower = (input.printHours ?? 0) * machineAndPowerPerHour(s);
  const accessory = input.accessoryCents;
  const packaging = s.packagingPerUnitCents;

  return {
    filament,
    machineAndPower,
    accessory,
    packaging,
    total: filament + machineAndPower + accessory + packaging,
    unknown: missing.length > 0,
    missing,
  };
}

/**
 * The price the workbook suggests: cover the cost, the target margin and the
 * card fee, then round up to the nearest 50c.
 *
 *   CEILING(cost / (1 - margin - cardFee), roundTo)
 *
 * Note the margin and the card fee are subtracted from 1 *together*, not
 * compounded. At 70% and 1.6% the divisor is 0.284, not 0.7 × 0.984. That is
 * how her sheet does it, so that is how this does it; changing it would move
 * every suggested price in the shop by about half a per cent and she would have
 * no idea why.
 *
 * Returns null rather than a number when there is nothing to price from —
 * a cost of zero, or a margin plus fee that leaves nothing to divide by. The
 * workbook returns 0 there, which then displays as "$0.00" and reads like a
 * free product; null lets the screen say "not priced yet" instead.
 */
export function suggestedPrice(s: CostSettings, costCents: number): number | null {
  if (costCents <= 0) return null;

  const divisor = 1 - s.targetMargin - s.cardFeeRate;
  if (divisor <= 0) return null;

  const step = s.roundPriceToCents > 0 ? s.roundPriceToCents : 1;
  return Math.ceil(costCents / divisor / step) * step;
}

/**
 * Profit on one unit at a given price. Workbook column AA.
 *
 * The card fee comes off the *price*, not off the margin, because that is when
 * it is actually charged — Stripe takes its cut of what the customer paid.
 */
export function profitPerUnit(
  s: CostSettings,
  priceCents: number,
  costCents: number,
): number {
  return priceCents * (1 - s.cardFeeRate) - costCents;
}

/** Realised margin on a price, as a fraction. Null when the price is zero. */
export function marginAt(
  s: CostSettings,
  priceCents: number,
  costCents: number,
): number | null {
  if (priceCents <= 0) return null;
  return profitPerUnit(s, priceCents, costCents) / priceCents;
}

/**
 * How many to print. Workbook column AE:
 *
 *   MAX(0, ordered + buffer - onHand)
 *
 * `ordered` is open demand — quantities on orders that are neither finished nor
 * cancelled. It belongs in here rather than being netted off elsewhere: a piece
 * with four on the shelf and five sold is short by one *plus* whatever buffer
 * she wants to keep, and a queue that ignores sold-but-unposted stock sends her
 * to a market with an empty box.
 */
export function toPrint(input: {
  onHand: number;
  ordered: number;
  buffer: number;
}): number {
  return Math.max(0, input.ordered + input.buffer - input.onHand);
}
