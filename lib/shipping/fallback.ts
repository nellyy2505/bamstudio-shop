/**
 * The price we quote when Australia Post will not answer.
 *
 * Every figure below was read off the live PAC API on 25 August 2026 and is
 * the real published retail rate, Sydney to Melbourne, GST-inclusive.
 *
 * ## This table is deliberately pessimistic, and the lookup makes it more so
 *
 * `fallbackPostageCents` does not return the band a basket falls in. It
 * returns **the next band up**. A 200 g parcel does not quote at the ≤250 g
 * rate of $10.20; it quotes at the ≤500 g rate of $11.70.
 *
 * That is not a mistake and it is not laziness about band boundaries. This
 * table is only ever reached when the live price is unavailable, which means
 * something is already wrong and the estimate is already less trustworthy than
 * usual. The two ways of being wrong are not symmetric:
 *
 * - Overcharge by a dollar: a customer is mildly annoyed, and if they ask, the
 *   studio refunds a dollar and looks generous. It costs goodwill.
 * - Undercharge by a dollar: the studio pays it, silently, on every order that
 *   goes out while the API is down, and nobody finds out until the month's
 *   postage bill does not match the month's shipping income.
 *
 * One of those is recoverable. So the table rounds toward the shop paying,
 * like everything else in this module.
 *
 * ## Keeping it current
 *
 * Australia Post lifts retail rates most years, usually in July. When they do,
 * these numbers go stale in the direction that costs money. Re-read them from
 * the live API and update this file; the ladder is short enough to check by
 * hand in ten minutes. The `RATES_VERIFIED_ON` date below is the only record
 * of when that last happened.
 *
 * ## No GST line, ever
 *
 * These are GST-inclusive retail prices. The shop is not GST-registered
 * (`SHOP.gstRegistered`), so the total passes through as a total. Nothing here
 * or downstream may display or compute a GST component from it — that would
 * claim a tax the shop does not collect.
 */

/** Bumped by hand whenever the ladder below is re-read from the live API. */
export const RATES_VERIFIED_ON = "2026-08-25";

/** One rung: everything at or under `maxGrams` costs `cents`. */
export type RateBand = { maxGrams: number; cents: number };

/**
 * Parcel Post (`AUS_PARCEL_REGULAR`). Bands are the carrier's own: 250 g,
 * 500 g, 1 kg, 3 kg, 5 kg, then per-kilogram steps.
 */
export const PARCEL_REGULAR_BANDS: RateBand[] = [
  { maxGrams: 250, cents: 1020 },
  { maxGrams: 500, cents: 1170 },
  { maxGrams: 1_000, cents: 1600 },
  { maxGrams: 3_000, cents: 2025 },
  { maxGrams: 5_000, cents: 2445 },
  { maxGrams: 6_000, cents: 2630 },
  { maxGrams: 8_000, cents: 3000 },
  { maxGrams: 10_000, cents: 3370 },
  { maxGrams: 16_000, cents: 4480 },
  { maxGrams: 22_000, cents: 5590 },
];

/** Express Post (`AUS_PARCEL_EXPRESS`). Same bands, steeper past 5 kg. */
export const PARCEL_EXPRESS_BANDS: RateBand[] = [
  { maxGrams: 250, cents: 1320 },
  { maxGrams: 500, cents: 1520 },
  { maxGrams: 1_000, cents: 2000 },
  { maxGrams: 3_000, cents: 2475 },
  { maxGrams: 5_000, cents: 3295 },
  { maxGrams: 6_000, cents: 4050 },
  { maxGrams: 8_000, cents: 5560 },
  { maxGrams: 10_000, cents: 7070 },
  { maxGrams: 16_000, cents: 11_600 },
  { maxGrams: 22_000, cents: 16_130 },
];

/**
 * Large Letter, regular. Three bands and that is the lot — over 500 g it is
 * not a letter at any price.
 */
export const LETTER_LARGE_BANDS: RateBand[] = [
  { maxGrams: 125, cents: 340 },
  { maxGrams: 250, cents: 510 },
  { maxGrams: 500, cents: 850 },
];

/** Service codes this table can price, mapped to their ladder. */
export const FALLBACK_BANDS: Record<string, RateBand[]> = {
  AUS_PARCEL_REGULAR: PARCEL_REGULAR_BANDS,
  AUS_PARCEL_EXPRESS: PARCEL_EXPRESS_BANDS,
  AUS_LETTER_REGULAR_LARGE_125: LETTER_LARGE_BANDS,
  AUS_LETTER_REGULAR_LARGE_250: LETTER_LARGE_BANDS,
  AUS_LETTER_REGULAR_LARGE_500: LETTER_LARGE_BANDS,
};

/**
 * The band a weight genuinely falls in — the honest rate, exported so a test
 * or an audit can show exactly how much the pessimism above is costing.
 * `quote.ts` does not call this.
 */
export function trueBandCents(
  serviceCode: string,
  weightGrams: number,
): number | null {
  const bands = FALLBACK_BANDS[serviceCode];
  if (!bands || bands.length === 0) return null;
  const index = bands.findIndex((band) => weightGrams <= band.maxGrams);
  // Over the top band means over what the service carries. Quote the dearest
  // rung rather than nothing: a caller with no price at all tends to invent
  // zero, and zero postage is the one answer that is never safe.
  return index === -1 ? bands[bands.length - 1].cents : bands[index].cents;
}

/**
 * What to charge when the live price is unavailable: **one band above** the
 * one this weight falls in, clamped at the top of the ladder.
 *
 * Returns `null` for a service code this table does not know, so the caller
 * has to decide rather than being handed a fabricated number.
 */
export function fallbackPostageCents(
  serviceCode: string,
  weightGrams: number,
): number | null {
  const bands = FALLBACK_BANDS[serviceCode];
  if (!bands || bands.length === 0) return null;

  const index = bands.findIndex((band) => weightGrams <= band.maxGrams);
  if (index === -1) return bands[bands.length - 1].cents;

  // Deliberately +1. See the file comment.
  const pessimistic = Math.min(index + 1, bands.length - 1);
  return bands[pessimistic].cents;
}
