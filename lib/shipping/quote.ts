/**
 * The one function that answers "what does it cost to post this basket?".
 *
 * **Both the cart and the checkout route must call this and nothing else.** If
 * one of them computed postage a different way, the price a customer agreed to
 * on the cart page and the price Stripe charges could diverge — silently, and
 * only for some baskets. One entry point is what makes that impossible.
 *
 * Resolution order is cache → live → fallback:
 *
 *   1. **L1 cache.** Rates change about once a year; almost every lookup
 *      should land here and cost nothing.
 *   2. **Australia Post PAC.** The real price, at 0.8–1.9 s.
 *   3. **The fallback table.** Transcribed real rates, deliberately rounded up
 *      one band. Reached when the key is unset, or the API is down, slow, or
 *      answering something we cannot read.
 *
 * `quoteBasket` **never throws and never blocks a sale**. Every failure path
 * ends at step 3, which needs no network and cannot fail. The worst outcome is
 * a price a dollar or two high, flagged as `source: "fallback"` so a caller
 * that cares can label it an estimate.
 *
 * ## What this deliberately does not do
 *
 * - **It does not apply the free-shipping threshold.** That is a rule about
 *   the basket *subtotal* and lives in `SHIPPING.freeThreshold` /
 *   `shippingCost()` in `lib/config.ts`. This function answers what the post
 *   office charges; the shop decides who pays it.
 * - **It does not compute or expose GST.** These are GST-inclusive retail
 *   prices and the shop is not GST-registered, so the total is a total. Do not
 *   run `gstComponent()` over the result.
 * - **It does not need the customer's address.** Domestic parcel price was
 *   verified constant across destinations, so a basket can be priced on page
 *   one, before anybody has typed a postcode.
 */

import {
  calculateLetter,
  calculateParcel,
  isPacConfigured,
  type PacCalculation,
  type PacResult,
} from "./client";
import { ORIGIN_POSTCODE, PROBE_POSTCODE } from "./dimensions";
import { fallbackPostageCents } from "./fallback";
import { lookupRate, rateCacheKey, storeRate, weightBandGrams } from "./cache";
import { selectPackaging } from "./select";
import { basketWeight, type ShippingLine } from "./weights";

export type QuoteSource = "live" | "cache" | "fallback";

export type ShippingQuote = {
  /** Postage in integer cents, GST-inclusive, before any free-shipping rule. */
  amountCents: number;
  /** The Australia Post service this price is for, e.g. `AUS_PARCEL_REGULAR`. */
  serviceCode: string;
  /** The shop's method id this was quoted for: `"standard"` or `"express"`. */
  methodId: string;
  /** Whether the chosen service carries tracking. A Large Letter does not. */
  tracked: boolean;
  /** What the counter's scale should read, in grams. */
  weightGrams: number;
  /** Where the number came from. Show "estimated" on `"fallback"` if you like. */
  source: QuoteSource;
};

/** Service codes this module will quote. */
export const SERVICE_CODES = {
  parcelRegular: "AUS_PARCEL_REGULAR",
  parcelExpress: "AUS_PARCEL_EXPRESS",
  letterLarge125: "AUS_LETTER_REGULAR_LARGE_125",
  letterLarge250: "AUS_LETTER_REGULAR_LARGE_250",
  letterLarge500: "AUS_LETTER_REGULAR_LARGE_500",
} as const;

/**
 * Which services carry tracking.
 *
 * A regular Large Letter does **not**. `transitLabel()` in `lib/config.ts`
 * currently says "tracked" for both shop methods, which is true today only
 * because everything ships as a parcel; it stops being true the moment letter
 * quoting is switched on for a product. Whoever wires this into the UI must
 * read this field rather than that label.
 */
const TRACKED: Record<string, boolean> = {
  [SERVICE_CODES.parcelRegular]: true,
  [SERVICE_CODES.parcelExpress]: true,
  [SERVICE_CODES.letterLarge125]: false,
  [SERVICE_CODES.letterLarge250]: false,
  [SERVICE_CODES.letterLarge500]: false,
};

/**
 * The weight assumed when the basket could not be measured at all — reachable
 * only from the outer catch. 500 g is the top of the second parcel band, so
 * the deliberately-one-band-high fallback lookup lands on the ≤1 kg rate.
 * Expensive on purpose: this path means something is broken and the estimate
 * should be generous rather than optimistic.
 */
const UNKNOWN_BASKET_WEIGHT_G = 500;

/**
 * The Large Letter rung for a weight.
 *
 * Our own cap is 110 g, so in practice this always returns the first rung. The
 * ladder exists so that easing `LETTER_MARGIN` some day cannot silently quote
 * a 200 g letter at the 125 g price.
 */
function letterServiceForWeight(weightGrams: number): string {
  if (weightGrams <= 125) return SERVICE_CODES.letterLarge125;
  if (weightGrams <= 250) return SERVICE_CODES.letterLarge250;
  return SERVICE_CODES.letterLarge500;
}

/**
 * The always-available answer. No network, no clock, no way to fail.
 *
 * If the table has no entry for the code — which would mean somebody added a
 * service without adding its rates — this falls through to the dearest ladder
 * it has rather than to zero. Zero postage is the one answer that is never
 * safe.
 */
function fallbackQuote(
  methodId: string,
  serviceCode: string,
  weightGrams: number,
): ShippingQuote {
  const cents =
    fallbackPostageCents(serviceCode, weightGrams) ??
    fallbackPostageCents(SERVICE_CODES.parcelExpress, weightGrams) ??
    0;
  return {
    amountCents: cents,
    serviceCode,
    methodId,
    tracked: TRACKED[serviceCode] ?? true,
    weightGrams,
    source: "fallback",
  };
}

/**
 * Price a basket.
 *
 * @param lines    Basket lines carrying **server-loaded product rows**. The
 *                 browser supplies which product and how many, never a weight.
 * @param methodId `"standard"` or `"express"` — the ids in `SHIPPING.methods`.
 *                 An unrecognised id is treated as standard, because refusing
 *                 to quote would block a sale over a typo.
 */
export async function quoteBasket(
  lines: ShippingLine[],
  methodId: string,
): Promise<ShippingQuote> {
  const method = methodId === "express" ? "express" : "standard";

  // Nothing below may throw. The outer catch is the last line of that promise:
  // an unexpected error still yields a price, and the sale still completes.
  try {
    // An empty basket has no postage. Quoting $3.40 to ship nothing would be
    // worse than quoting nothing at all.
    const hasItems = lines.some(
      (line) => Number.isFinite(line.quantity) && line.quantity > 0,
    );
    if (!hasItems) {
      return {
        amountCents: 0,
        serviceCode: "",
        methodId: method,
        tracked: false,
        weightGrams: 0,
        source: "fallback",
      };
    }

    const selection = selectPackaging(lines);

    /*
     * Express always goes as a parcel, even for a basket that would fit a
     * letter. Express Post envelopes are prepaid stock the studio would have to
     * hold and reconcile, and the saving over an express parcel is about a
     * dollar and a half. Quoting the parcel is simpler at the packing bench and
     * is the dearer of the two, which is the safe direction to be wrong in.
     *
     * When that happens the basket has to be re-weighed: `selectPackaging`
     * weighed it in a letter mailer, and we are about to post it in a parcel
     * satchel. Quoting a parcel at a letter's weight would under-read the
     * package by the difference between the two mailers.
     */
    const asLetter = selection.kind === "letter" && method !== "express";
    const serviceCode = asLetter
      ? letterServiceForWeight(selection.weightGrams)
      : method === "express"
        ? SERVICE_CODES.parcelExpress
        : SERVICE_CODES.parcelRegular;

    const weightGrams = asLetter
      ? selection.weightGrams
      : basketWeight(lines, "parcel");

    const dimensionsMm = asLetter ? undefined : selection.parcelDimensionsMm;
    const key = rateCacheKey({ serviceCode, weightGrams, dimensionsMm });

    // ---- 1. Cache ------------------------------------------------------
    const cached = await lookupRate(key);
    if (cached) {
      return {
        amountCents: cached.amountCents,
        serviceCode: cached.serviceCode,
        methodId: method,
        tracked: TRACKED[cached.serviceCode] ?? true,
        weightGrams,
        source: "cache",
      };
    }

    // ---- 2. Live -------------------------------------------------------
    // `isPacConfigured` is checked only to skip a pointless call; the client
    // reports "not configured" cleanly on its own either way.
    if (isPacConfigured()) {
      const result: PacResult<PacCalculation> = asLetter
        ? await calculateLetter({ serviceCode, weightGrams })
        : await calculateParcel({
            serviceCode,
            fromPostcode: ORIGIN_POSTCODE,
            // A destination is required by the endpoint and does not affect
            // the price — see PROBE_POSTCODE in dimensions.ts.
            toPostcode: PROBE_POSTCODE,
            lengthMm: dimensionsMm?.lengthMm ?? 0,
            widthMm: dimensionsMm?.widthMm ?? 0,
            heightMm: dimensionsMm?.heightMm ?? 0,
            weightGrams,
          });

      // A zero from a successful call is rejected on purpose: free postage is
      // never the right answer for a basket with something in it, and taking
      // it at face value would be the most expensive possible bug here.
      if (result.ok && result.value.totalCents > 0) {
        await storeRate(key, {
          amountCents: result.value.totalCents,
          serviceCode,
          weightBandGrams: weightBandGrams(weightGrams),
        });
        return {
          amountCents: result.value.totalCents,
          serviceCode,
          methodId: method,
          tracked: TRACKED[serviceCode] ?? true,
          weightGrams,
          source: "live",
        };
      }

      if (!result.ok && result.reason !== "not_configured") {
        // Worth one line: a persistent failure here means the shop has been
        // quoting fallback prices for a while without anybody noticing. PAC
        // error text quotes our own request, never customer data.
        console.warn(
          `[shipping] PAC ${result.reason} for ${serviceCode} at ${weightGrams} g — ` +
            `using the fallback table. ${result.detail}`,
        );
      }
    }

    // ---- 3. Fallback ---------------------------------------------------
    return fallbackQuote(method, serviceCode, weightGrams);
  } catch (error) {
    console.warn(
      "[shipping] quoteBasket fell through to the fallback table:",
      error instanceof Error ? error.message : error,
    );
    // There is no trustworthy selection at this point, so quote the parcel
    // service for the method at an assumed-heavy weight. Never zero.
    const serviceCode =
      method === "express"
        ? SERVICE_CODES.parcelExpress
        : SERVICE_CODES.parcelRegular;
    return fallbackQuote(method, serviceCode, UNKNOWN_BASKET_WEIGHT_G);
  }
}
