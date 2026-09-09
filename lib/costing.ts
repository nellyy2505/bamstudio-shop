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
 * The workbook, for reference. Column letters are the Products sheet:
 *
 *   T  filament       = totalGrams * $/kg / 1000 * (1 + waste)
 *   U  machine+power  = printHours * Settings!C12 * (1 + waste)
 *   V  accessory      = the one accessory on the product
 *   W  packaging      = Settings!C37
 *   AH overhead       = Settings!C53, the annual pools over units per year
 *   X  UNIT COST      = T + U + V + W + AH
 *   Y  suggested      = CEILING((X + cardFixed) / (1 - margin - card% - postage%), roundTo)
 *   AG suggested-stall = the same with the stall cut in place of postage
 *   AI ONE PRICE      = MAX(Y, AG)
 *   AP card fee       = price * card% + cardFixed
 *   AQ postage        = price * postage%
 *   AR total cost     = X + AP + AQ
 *   AS profit         = price - AR
 *   AT margin         = AS / price
 *   AJ $ per hour     = AS / printHours
 *
 * and Settings!C12, the machine-and-power hourly rate, is itself
 *
 *   C8  machine  = printerPrice / lifeHours
 *   C11 power    = watts / 1000 * $/kWh
 *   C12          = C8 + C11
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE LEVELS OF COST, AND WHY THEY MUST NOT BE MIXED.
 *
 *   1. Direct per-unit    filament, machine time (both uplifted by waste),
 *                         accessory, packaging.
 *   2. Fixed, allocated   annual pools divided by expected units per year.
 *                         Inside UNIT COST.
 *   3. Channel, % of price  postage absorbed online, or the stall cut at a
 *                         market. NEVER inside UNIT COST.
 *
 * Level 3 cannot go into unit cost because the suggested price is *derived*
 * from unit cost, so a percentage of the answer cannot also be one of the
 * inputs. It goes into the divisor instead. Every earlier version of the
 * workbook got this wrong, and the symptom was a price that would not settle.
 *
 * LABOUR IS DELIBERATELY ABSENT. The workbook models it at $30/hr for three
 * minutes a unit and leaves it switched off; Nelly confirmed on 8 September
 * 2026 that her time is not charged into unit cost. There is therefore no
 * labour term and no toggle here. The consequence is real and worth stating
 * where it can be read: every margin this file computes is optimistic by
 * roughly $1.50 a unit, and the screens that show a margin say so.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING HERE IS IN CENTS, AND MOST OF IT IS FRACTIONAL CENTS.
 *
 * A keyring costs $9.50 per hundred - 9.5 cents each. Packaging is 13 cents.
 * The machine, at $1049 over 10,000 hours, is 10.49 cents an hour. Round any of
 * those to a whole cent as it goes past and a $2.50 product's cost moves by a
 * few per cent, which at a 70% target margin is real money on a market table.
 *
 * So: `number`, not integers, all the way through, and exactly one rounding -
 * at the end, into the price, in the direction the workbook rounds (up, to the
 * nearest 50c). Money that is *charged* is still an integer number of cents;
 * money that is *computed about* is not.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure functions with no imports on purpose: this file is the one piece of the
 * studio that can be checked against a spreadsheet by reading it.
 */

/** The constants row - `shop_settings`, as numbers. */
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

  /**
   * The flat half of a card fee, in cents. Stripe AU is 1.7% + A$0.30.
   *
   * Modelled separately from the rate because it does not scale: 30c is 12% of
   * a $2.50 sale and 0.5% of a $60 one, so a cheap piece cannot be priced from
   * a percentage alone. Workbook Settings!C21.
   */
  cardFeeFixedCents: number;

  /** Waste uplift on print cost. 0.12 is +12%. Workbook Settings!C87. */
  wasteRate: number;

  /** Insurance, permits, website: paid per year regardless of volume. C47:C50. */
  annualFixedCostCents: number;
  /** Assets over their life. The printer is excluded on purpose. C98. */
  annualDepreciationCents: number;
  /** The denominator both pools divide by. Workbook Settings!C52. */
  expectedUnitsPerYear: number;

  /** What a parcel really costs to send. Workbook Settings!C56. */
  parcelCostCents: number;
  /**
   * The basket subtotal at which standard postage becomes free.
   *
   * NOT a stored setting. It is `SHIPPING.freeThreshold` from lib/config.ts,
   * copied in here by whoever assembles a CostSettings, because that is the
   * one place the cart and /api/checkout read it from and a second stored copy
   * would be a second answer. See the note on `onlinePostageShare`.
   */
  freePostageThresholdCents: number;

  /** Stall hire for one market day, and what a day typically takes. C67 / C68. */
  stallFeeCents: number;
  marketDayTakingsCents: number;

  /** The printer-hour bar: hours available a year, contribution wanted. C109 / C110. */
  printerHoursPerYear: number;
  annualContributionTargetCents: number;
};

/** 1 + waste. Multiplies filament and machine time, and nothing else. */
export function wasteMultiplier(s: CostSettings): number {
  return 1 + s.wasteRate;
}

/**
 * The two allocated pools, per unit sold. Workbook Settings!C53, split.
 *
 * Two functions rather than one total because the cost breakdown shows them as
 * two lines ("insurance, permits, web" and "equipment wear"), and because they
 * answer different questions: one is a bill that arrives whether she prints or
 * not, the other is gear wearing out.
 */
export function insuranceSharePerUnit(s: CostSettings): number {
  if (s.expectedUnitsPerYear <= 0) return 0;
  return s.annualFixedCostCents / s.expectedUnitsPerYear;
}

export function depreciationSharePerUnit(s: CostSettings): number {
  if (s.expectedUnitsPerYear <= 0) return 0;
  return s.annualDepreciationCents / s.expectedUnitsPerYear;
}

export function overheadPerUnit(s: CostSettings): number {
  return insuranceSharePerUnit(s) + depreciationSharePerUnit(s);
}

/**
 * The share of a price the studio absorbs in postage online. Workbook C61.
 *
 * The WORST case on purpose, not the typical one: the order that only just
 * crosses the free-postage threshold earns free postage and the studio carries
 * the whole parcel, so $10 over $89 is 11.2%. A typical $70 basket is 7.1%.
 * Pricing off the typical figure would leave the worst-case order unprofitable,
 * and it is not a rare order - it is the one the free-postage line encourages.
 */
export function onlinePostageShare(s: CostSettings): number {
  if (s.freePostageThresholdCents <= 0) return 0;
  return s.parcelCostCents / s.freePostageThresholdCents;
}

/**
 * The stall cut as a share of takings. Workbook Settings!C70.
 *
 * A stall fee is not a per-unit cost: it scales with market days, not with
 * pieces, so allocating it per unit would tax online sales to pay for market
 * days. As a share of a day's takings it lands in the same place postage does,
 * in the pricing divisor for that channel.
 */
export function stallShare(s: CostSettings): number {
  if (s.marketDayTakingsCents <= 0) return 0;
  return s.stallFeeCents / s.marketDayTakingsCents;
}

/**
 * Dollars per printer-hour the year needs. Workbook Settings!C111.
 *
 * Set from the business, deliberately not from a product: when the macaron was
 * cut from $9.00 to $6.50, a bar derived from a product price would have
 * quietly lowered the standard for the whole catalogue at the same moment.
 */
export function targetPerPrinterHour(s: CostSettings): number {
  if (s.printerHoursPerYear <= 0) return 0;
  return s.annualContributionTargetCents / s.printerHoursPerYear;
}

/**
 * What an hour of machine time earns, at a given profit. Workbook column AJ.
 *
 * Null when the piece has never been timed, because dividing by an unknown is
 * not a number - and a product with no print time is exactly the one somebody
 * would otherwise read as infinitely productive.
 */
export function perPrinterHour(
  profitCents: number,
  printHours: number | null,
): number | null {
  if (printHours === null || printHours <= 0) return null;
  return profitCents / printHours;
}

/** Machine depreciation per print hour, in cents. Workbook Settings!C8. */
export function machineCostPerHour(s: CostSettings): number {
  if (s.printerLifeHours <= 0) return 0;
  return s.printerPriceCents / s.printerLifeHours;
}

/** Electricity per print hour, in cents. Workbook Settings!C11. */
export function powerCostPerHour(s: CostSettings): number {
  return (s.powerDrawWatts / 1000) * s.electricityPerKwhCents;
}

/** Workbook Settings!C12 - the single rate the Products sheet multiplies by. */
export function machineAndPowerPerHour(s: CostSettings): number {
  return machineCostPerHour(s) + powerCostPerHour(s);
}

/**
 * What one unit costs to make, broken into the four parts the workbook shows,
 * so the studio can see which one is the problem rather than just the total.
 *
 * `printHours` and `grams` are nullable because most of her catalogue has never
 * been measured. Null is carried through to `unknown: true` rather than
 * substituted with zero - a product nobody has timed is not a product that
 * prints instantly, and a cost of $0.13 (packaging alone) shown as if it were
 * real is how you price a piece at fifty cents.
 */
export type CostBreakdown = {
  /** Already uplifted by waste. Workbook column T. */
  filament: number;
  /** Already uplifted by waste. Workbook column U. */
  machineAndPower: number;
  accessory: number;
  packaging: number;
  /** How much of filament + machine above is the waste uplift. Workbook AK. */
  waste: number;
  /** Workbook AL: the annual bills, per unit. */
  insuranceShare: number;
  /** Workbook AM: gear wearing out, per unit. */
  depreciationShare: number;
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

  // Print cost before waste, kept separate only so the uplift can be reported
  // as its own line. Waste multiplies these two and nothing else: a scrapped
  // print burns filament and machine hours, it does not consume a keyring or a
  // bag, and the prime tower is already inside the grams the slicer reported.
  const rawFilament = ((input.grams ?? 0) * s.filamentPerKgCents) / 1000;
  const rawMachine = (input.printHours ?? 0) * machineAndPowerPerHour(s);
  const uplift = wasteMultiplier(s);

  const filament = rawFilament * uplift;
  const machineAndPower = rawMachine * uplift;
  const waste = (rawFilament + rawMachine) * s.wasteRate;
  const accessory = input.accessoryCents;
  const packaging = s.packagingPerUnitCents;
  const insuranceShare = insuranceSharePerUnit(s);
  const depreciationShare = depreciationSharePerUnit(s);

  return {
    filament,
    machineAndPower,
    accessory,
    packaging,
    waste,
    insuranceShare,
    depreciationShare,
    total:
      filament +
      machineAndPower +
      accessory +
      packaging +
      insuranceShare +
      depreciationShare,
    unknown: missing.length > 0,
    missing,
  };
}

/**
 * The price one channel needs, given its share of the price.
 *
 *   CEILING((cost + cardFixed) / (1 - margin - card% - channel%), roundTo)
 *
 * Note the margin, the card fee and the channel share are subtracted from 1
 * *together*, not compounded. At 67%, 1.7% and 11.2% the divisor is 0.2006, not
 * 0.67 x 0.983 x 0.888. That is how her sheet does it, so that is how this does
 * it; changing it would move every suggested price in the shop and she would
 * have no way of knowing why.
 *
 * The divisor being about 0.20 is the fact to carry away from this function:
 * every extra point of target margin moves the price by roughly 5%.
 *
 * Returns null rather than a number when there is nothing to price from - a
 * cost of zero, or a margin plus fees that leaves nothing to divide by. The
 * workbook returns 0 there, which displays as "$0.00" and reads like a free
 * product; null lets the screen say "not priced yet" instead.
 */
export function suggestedPriceForChannel(
  s: CostSettings,
  costCents: number,
  channelRate: number,
): number | null {
  if (costCents <= 0) return null;

  const divisor = 1 - s.targetMargin - s.cardFeeRate - channelRate;
  if (divisor <= 0) return null;

  const step = s.roundPriceToCents > 0 ? s.roundPriceToCents : 1;
  return Math.ceil((costCents + s.cardFeeFixedCents) / divisor / step) * step;
}

/**
 * ONE price for both channels. Workbook column AI: `MAX(Y, AG)`.
 *
 * Decided during the pricing work: the same price online and at a market
 * stall, set by whichever channel is worse. Two prices for one piece is a
 * promise to mis-label something on a market table.
 *
 * Which channel is worse was itself a correction. The expectation had been that
 * insurance and registration made the market channel the expensive one; in fact
 * insurance is a rounding error and stall hire is the whole of it, so at a $50
 * stall and a $600 day the market costs 8.3% against online's 11.2%. **Online
 * is the worse channel**, so today this returns the online figure. It is
 * written as a max anyway, because a bigger stall fee or a quieter market day
 * flips it and nothing should have to be rewritten when it does.
 */
export function suggestedPrice(s: CostSettings, costCents: number): number | null {
  const online = suggestedPriceForChannel(s, costCents, onlinePostageShare(s));
  const stall = suggestedPriceForChannel(s, costCents, stallShare(s));
  if (online === null) return stall;
  if (stall === null) return online;
  return Math.max(online, stall);
}

/**
 * Where the money actually goes at a price she has chosen. Workbook AO:AT.
 *
 * This is the honest counterpart to `suggestedPrice`: that one asks "what
 * should this cost", this one asks "at the price on the shelf, what is left".
 * The two disagree all over the catalogue and the disagreement is the point -
 * the macaron at $6.50 against a suggestion of $8.50 is a decision, and a
 * screen that only showed the suggestion would hide it.
 *
 * The card fee and the postage come off the *price*, not off the margin,
 * because that is when they are actually charged: Stripe takes its cut of what
 * the customer paid, and the parcel costs what it costs.
 *
 * Known imprecision, inherited from the workbook: the fixed card fee is charged
 * here per *item*, and Stripe charges it per *order*, so a multi-item basket
 * looks slightly worse than it really is. Erring pessimistic on a 30c line was
 * judged better than erring optimistic.
 */
/**
 * The three terms that come off a price, and nothing else.
 *
 * `costAtPrice` used to take a whole `CostSettings`. It takes this instead so
 * the repricing screen can recompute a margin as she types without the printer
 * price, the filament price and the overhead pools being sent to the browser to
 * do it. Those are staff numbers on a staff page, not a secret, but a component
 * that only needs three scalars should be handed three scalars: the smaller the
 * thing crossing to the client, the less there is to keep in step.
 *
 * Build one with `priceTerms()` so there is exactly one place that knows the
 * postage share is derived rather than stored.
 */
export type PriceTerms = {
  cardFeeRate: number;
  cardFeeFixedCents: number;
  /** The share of the price absorbed as postage. See `onlinePostageShare`. */
  postageShare: number;
};

export function priceTerms(s: CostSettings): PriceTerms {
  return {
    cardFeeRate: s.cardFeeRate,
    cardFeeFixedCents: s.cardFeeFixedCents,
    postageShare: onlinePostageShare(s),
  };
}

export type PriceOutcome = {
  price: number;
  unitCost: number;
  /** price * card% + the fixed fee. Workbook AP. */
  cardFee: number;
  /** The postage the studio absorbs at this price. Workbook AQ. */
  postage: number;
  /** unitCost + cardFee + postage. Workbook AR. */
  total: number;
  /** price - total. Workbook AS. */
  profit: number;
  /** profit / price, or null at a price of zero. Workbook AT. */
  margin: number | null;
};

export function costAtPrice(
  t: PriceTerms,
  priceCents: number,
  unitCostCents: number,
): PriceOutcome {
  const cardFee = priceCents * t.cardFeeRate + t.cardFeeFixedCents;
  const postage = priceCents * t.postageShare;
  const total = unitCostCents + cardFee + postage;
  const profit = priceCents - total;

  return {
    price: priceCents,
    unitCost: unitCostCents,
    cardFee,
    postage,
    total,
    profit,
    margin: priceCents > 0 ? profit / priceCents : null,
  };
}

/**
 * How many to print. Workbook column AE:
 *
 *   MAX(0, ordered + buffer - onHand)
 *
 * `ordered` is open demand - quantities on orders that are neither finished nor
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
