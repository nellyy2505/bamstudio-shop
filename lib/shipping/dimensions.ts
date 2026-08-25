/**
 * Every tunable number the postage quoter depends on, in one file.
 *
 * These deliberately do **not** live in `lib/config.ts`. That file is read as
 * *text* by `scripts/generate-seed.mjs`, so an edit there can break seed
 * generation in a way TypeScript will not catch. Nothing in this directory
 * imports from config, precisely so nobody is ever tempted to move a constant
 * back across that line.
 *
 * **The one rule that governs every value below: round toward the shop
 * paying.** A weight guessed 5 g heavy costs nothing. A weight guessed 5 g
 * light turns a Large Letter into a parcel at the counter and the studio eats
 * the difference on every order until somebody notices. So: weights round up,
 * dimensions round up, limits are pulled *in* from the carrier's real maximum,
 * and anything unknown is assumed to be the expensive case.
 *
 * All weights are grams, all lengths millimetres. Money is not in this file —
 * see `fallback.ts`.
 */

/* -------------------------------------------------------------------------
 * Origin and the probe destination
 * ---------------------------------------------------------------------- */

/**
 * Where parcels are lodged. The studio is in Sydney; 2000 is the CBD.
 *
 * Domestic parcel pricing does not vary by origin *zone* the way international
 * does, but the API demands the parameter, so it may as well be true.
 */
export const ORIGIN_POSTCODE = "2000";

/**
 * A destination we send purely because the parcel endpoint refuses to answer
 * without one.
 *
 * **We never ask the customer where they live in order to price postage.**
 * Domestic parcel price was verified constant across eight destinations from
 * 3000 (Melbourne CBD) to 6798 (Christmas Island) — postcode affects which
 * services are *available*, never what they cost. Sydney → Melbourne is the
 * densest, most-serviced lane in the country, so it is the destination least
 * likely to have a service missing from the list. Quoting before the address
 * form is the whole point: the basket can show a real price on page one.
 */
export const PROBE_POSTCODE = "3000";

/* -------------------------------------------------------------------------
 * Australia Post's real limits, and the margins we hold back from them
 * ---------------------------------------------------------------------- */

/** The carrier's published Large Letter maximums. Do not edit — these are facts. */
export const LETTER_LIMITS = {
  /** Large Letter is 260 mm × 360 mm. */
  lengthMm: 260,
  widthMm: 360,
  thicknessMm: 20,
  weightGrams: 125,
} as const;

/**
 * How much of each limit we refuse to use.
 *
 * The margin is not timidity, it is the difference between a number we
 * calculated and a number a Post Office scale will read. A heavier mailer than
 * the one modelled here, a card insert the studio adds by hand, a charm that
 * came off the printer denser than the estimate — each is a few grams or a
 * millimetre, and each of them alone can push a "letter" over the counter's
 * limit. At that point the studio pays parcel rates on a letter's postage.
 */
export const LETTER_MARGIN = {
  /** 20 mm off each of the two footprint dimensions. */
  edgeMm: 20,
  /** 4 mm off thickness — one extra fold of bubble wrap. */
  thicknessMm: 4,
  /** 15 g off weight — a thank-you card and a sticker. */
  weightGrams: 15,
} as const;

/** The limits this module actually enforces: 240 × 340 × 16 mm, 110 g. */
export const LETTER_WORKING = {
  lengthMm: LETTER_LIMITS.lengthMm - LETTER_MARGIN.edgeMm,
  widthMm: LETTER_LIMITS.widthMm - LETTER_MARGIN.edgeMm,
  thicknessMm: LETTER_LIMITS.thicknessMm - LETTER_MARGIN.thicknessMm,
  weightGrams: LETTER_LIMITS.weightGrams - LETTER_MARGIN.weightGrams,
} as const;

/**
 * Slack for packing an item footprint into a rectangle.
 *
 * Items are not tessellated. Two 110 × 22 mm charms laid in a mailer occupy
 * more than 2 × (110 × 22) because they do not interlock and nothing is placed
 * hard against an edge. 1.35 is a conventional loose-packing allowance and is
 * the pessimistic direction: a larger factor makes a basket a parcel sooner.
 */
export const FOOTPRINT_PACKING_FACTOR = 1.35;

/** Australia Post's parcel maximums, used only to keep API calls valid. */
export const PARCEL_LIMITS = {
  lengthCm: 105,
  weightKg: 22,
} as const;

/** Smallest parcel Australia Post will accept, in millimetres. */
export const PARCEL_MIN = {
  lengthMm: 160,
  widthMm: 100,
  heightMm: 20,
} as const;

/* -------------------------------------------------------------------------
 * Per-category fallbacks
 * ---------------------------------------------------------------------- */

export type ItemDimensions = {
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
};

/**
 * What we assume about a product when its own row does not say.
 *
 * Keys are `Product.category` values as they appear in the catalogue. Once the
 * `products` table carries real per-product measurements, those win and these
 * only cover rows nobody has measured yet — which is exactly why they are
 * generous. Measure a product and the guess stops applying to it.
 *
 * `DEFAULT_DIMENSIONS` catches a category nobody has added here. It is the
 * heaviest, bulkiest entry on purpose: an unrecognised category is an
 * unmeasured product, and an unmeasured product should quote as a parcel.
 */
export const CATEGORY_DEFAULTS: Record<string, ItemDimensions> = {
  /**
   * A clicker keychain has a steel spring mechanism inside a printed shell.
   * 22 mm thick is what kills letter eligibility for these, and correctly so —
   * you cannot post a spring-loaded clicker flat under a 20 mm gauge.
   */
  "Clicker keychain": {
    weightGrams: 25,
    lengthMm: 60,
    widthMm: 60,
    thicknessMm: 22,
  },
  /** Phone stands, popsockets, strap charms — small but three-dimensional. */
  "Phone & bag": {
    weightGrams: 30,
    lengthMm: 90,
    widthMm: 60,
    thicknessMm: 20,
  },
  /** Pet bowls. Solid printed vessels; nothing about these is letter-shaped. */
  Pet: {
    weightGrams: 180,
    lengthMm: 160,
    widthMm: 160,
    thicknessMm: 60,
  },
};

/** Applied to any category missing from `CATEGORY_DEFAULTS`. See above. */
export const DEFAULT_DIMENSIONS: ItemDimensions = {
  weightGrams: 120,
  lengthMm: 150,
  widthMm: 150,
  thicknessMm: 50,
};

/* -------------------------------------------------------------------------
 * Attachments
 * ---------------------------------------------------------------------- */

/**
 * Attachments are separate physical parts that go in the same mailer, so their
 * weight is **added**, never substituted.
 *
 * The ids match `BUILDER_ATTACHMENTS` in `lib/config.ts` (`cord`, `keyring`,
 * `strap`) plus `none`, which the catalogue also uses on non-builder products.
 * A line with no attachment and a line with `none` both add zero.
 *
 * Values are the metal-and-cord parts weighed generously: a split ring and its
 * jump ring, a woven phone-strap loop, a length of bag-charm cord.
 */
export const ATTACHMENT_WEIGHTS_G: Record<string, number> = {
  cord: 2,
  keyring: 4,
  strap: 5,
  none: 0,
};

/** Weight of an attachment id, defaulting to the heaviest known part. */
export function attachmentWeightGrams(id: string | null | undefined): number {
  if (!id) return 0;
  const known = ATTACHMENT_WEIGHTS_G[id];
  if (known !== undefined) return known;
  // An id we have never seen is an accessory somebody added without telling
  // this file. Charge for the heaviest one rather than for nothing.
  return Math.max(...Object.values(ATTACHMENT_WEIGHTS_G));
}

/* -------------------------------------------------------------------------
 * Builder charms
 * ---------------------------------------------------------------------- */

/**
 * A builder line is assembled, not stocked, so its weight is computed:
 *
 *   base + letters.length × perLetter + (with_charm ? charm : 0) + attachment
 *
 * `baseGrams` is the hardware that exists regardless of name length — the
 * split ring, the jump rings joining the caps, the cord tail. `perLetterGrams`
 * is one printed keycap letter (measured around 1.2 g in PLA, rounded up).
 * `charmGrams` is the little dangling food charm, included by default.
 */
export const BUILDER_WEIGHT = {
  baseGrams: 3,
  perLetterGrams: 2,
  charmGrams: 4,
} as const;

/**
 * A builder charm's footprint grows with the name, so it cannot come from a
 * category default. Caps sit in a row; the base length covers the ring at one
 * end and the hanging charm at the other.
 *
 * 12 mm thick is a keycap on its side. With the mailer's 3 mm that is 15 mm,
 * inside the 16 mm working limit with a millimetre to spare — deliberately not
 * exactly on the line, because a value sitting exactly on a limit fails the
 * first time anything changes.
 */
export const BUILDER_DIMENSIONS = {
  baseLengthMm: 30,
  perLetterLengthMm: 20,
  widthMm: 22,
  thicknessMm: 12,
} as const;

/* -------------------------------------------------------------------------
 * Packaging
 * ---------------------------------------------------------------------- */

/**
 * What the studio wraps an order in. Every one of these is added to the
 * basket weight — the carrier weighs the package, not the contents.
 */
export const PACKAGING = {
  /** Rigid-backed C5 letter mailer. Weighed at 10 g, carried at 12. */
  letterMailerGrams: 12,
  /** Padded poly satchel for anything that is not a letter. */
  parcelMailerGrams: 30,
  /**
   * Tissue, a sticker and a share of the thank-you card, per item rather than
   * per order: a six-item basket really is wrapped six times over.
   */
  perItemPaddingGrams: 3,
  /**
   * The mailer's own thickness, added to the thickest item. Cardboard backing
   * plus both faces of the envelope.
   */
  mailerThicknessMm: 3,
  /**
   * Added to each outer dimension of a parcel for the satchel and its padding.
   * Parcel price does not vary with size at all (no cubic weighting was found
   * at any weight we tested), so this exists to make the dimensions we send
   * the API plausible and valid, not to move the price.
   */
  parcelWallMm: 10,
} as const;

/* -------------------------------------------------------------------------
 * Rounding
 * ---------------------------------------------------------------------- */

/**
 * Basket weight rounds **up** to a multiple of this.
 *
 * 5 g is roughly the resolution of a kitchen scale and well under the smallest
 * gap between price bands, so rounding up costs nothing and removes a class of
 * off-by-a-gram argument with the counter.
 */
export const WEIGHT_ROUNDING_GRAMS = 5;

/**
 * Cache keys round weight **up** to a multiple of this.
 *
 * Coarser than the quote itself on purpose: it collapses the long tail of
 * near-identical baskets onto a handful of keys. Rounding up means the cached
 * price is the price of a slightly heavier basket — never a lighter one.
 */
export const CACHE_WEIGHT_BAND_GRAMS = 50;

/** Round `grams` up to the next multiple of `step`. */
export function roundUpGrams(grams: number, step: number): number {
  if (step <= 0) return Math.ceil(grams);
  return Math.ceil(grams / step) * step;
}
