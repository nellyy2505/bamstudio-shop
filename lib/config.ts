/**
 * Business rules for the shop. These mirror the Settings sheet of the
 * 3D_Planner workbook - change them here, not inline in components.
 * All money is in cents (AUD) to avoid float drift.
 */

export const SHOP = {
  name: "Bam Studio",
  tagline: "Cute, clicky little things you'll never put down.",
  city: "Wollongong",
  country: "Australia",
  currency: "AUD",
  /** TODO: replace once the ABN application clears. */
  abn: process.env.NEXT_PUBLIC_ABN ?? null,
  /**
   * GST registration is only required above $75,000 turnover, and the shop is
   * below it. While this is false, prices must NOT claim to include GST and
   * no GST component may be shown - that would misrepresent a tax that is not
   * being collected. Flip it (and set the ABN) on the day you register.
   */
  gstRegistered: process.env.NEXT_PUBLIC_GST_REGISTERED === "true",
  /**
   * Falls back to a bracketed placeholder rather than a plausible-looking
   * address like hello@example.com, which reads as real and silently swallows
   * customer mail. Guard live mailto: links with `hasSupportEmail`.
   */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "[HELLO@YOURDOMAIN]",
  hasSupportEmail: Boolean(process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
  /*
   * There is deliberately no `canSendEmail` here any more.
   *
   * It used to read the public build flag `NEXT_PUBLIC_EMAIL_ENABLED` while
   * every actual send checked the `RESEND_API_KEY` / `EMAIL_FROM` secrets via
   * `isEmailConfigured()`. Two switches for one fact means they can disagree,
   * and both disagreeing states shipped a lie: flag on with no secrets offered
   * a contact form whose enquiries reached nobody, and secrets set with the
   * flag off hid a working form while the legal pages denied sending mail the
   * shop was in fact sending.
   *
   * The capability is now read once, on the server, from `isEmailConfigured()`
   * (lib/email.ts) and handed to client components as a prop - see lib/contact.ts.
   * Do not reintroduce a public mirror of a server fact.
   */
  socials: {
    instagram: process.env.NEXT_PUBLIC_INSTAGRAM_URL || null,
    tiktok: process.env.NEXT_PUBLIC_TIKTOK_URL || null,
  },
} as const;

/**
 * Payment methods advertised in the footer and basket. Only list what Stripe
 * will actually offer: cards are always available, but PayPal, Apple Pay and
 * Afterpay each need switching on in the Stripe dashboard first. Advertising
 * one that isn't enabled is a false claim on the checkout page.
 */
export const PAYMENT_BADGES: string[] = ["VISA", "MASTERCARD", "AMEX"];

/**
 * The shop's delivery options.
 *
 * There is deliberately **no `price` here any more.** Each method used to carry
 * a flat rate - 950 and 1450 - and the terms of sale, the FAQ, the tracking
 * page and every product page printed it. Postage is now quoted per basket from
 * Australia Post by `lib/shipping/quoteBasket()`, which for a real basket
 * returns anything from about 340 to well over 2000, so every one of those
 * pages was about to state a price the shop does not charge - in the contract,
 * in one case. The field is gone rather than left unread: a number sitting here
 * called `price` is one a future page will print.
 *
 * What belongs here is what the *shop* decides - its promotion and its service
 * names. What the carrier charges belongs to `lib/shipping/`.
 *
 * ## Postage is charged in three bands over the basket subtotal
 *
 *   below `subsidyThreshold` .... the customer pays the whole quoted rate
 *   up to `freeThreshold` ....... the studio pays `subsidisedShare` of it
 *   at or above `freeThreshold` . standard post is free
 *
 * This is the policy the pricing model in 3D_Planner is built on. Only standard
 * post is subsidised: express is a service the customer chose to upgrade to,
 * and waiving part of it would mean the studio paying for speed it never
 * promised.
 *
 * The worst order in the model is the one that *just* crosses `freeThreshold` -
 * it carries the full rate against the smallest subtotal that earns free post.
 * Two narrow cliffs exist by construction and are harmless: a basket just under
 * `subsidyThreshold` nets more than one just over, and a basket just under
 * `freeThreshold` nets the same as one at it.
 */
export const SHIPPING = {
  /** Below this subtotal the customer pays the full quoted rate. */
  subsidyThreshold: 4900,
  /** Free standard shipping at or above this basket subtotal. */
  freeThreshold: 8900,
  /** The share of the quoted standard rate the customer pays in between. */
  subsidisedShare: 0.5,
  methods: [
    {
      id: "standard",
      label: "Standard",
      /** Carrier transit only - printing happens before this starts. */
      transitDays: [3, 7],
    },
    {
      id: "express",
      label: "Express",
      transitDays: [1, 3],
    },
  ],
} as const;

/**
 * "3–7 business days" - the carrier's transit range alone, with no claim about
 * tracking.
 *
 * Pages that describe postage in general cannot know whether a given basket
 * will go as a tracked parcel or as an untracked Large Letter, so they must not
 * say. Use this there. Where a real quote is in hand, use transitLabel().
 */
export function transitRangeLabel(methodId: string): string {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  if (!method) return "";
  const [min, max] = method.transitDays;
  return `${min}–${max} business days`;
}

/**
 * "3–7 business days · tracked", derived so the numbers can't drift.
 *
 * `tracked` is required and deliberately not defaulted. This function used to
 * hardcode the word "tracked", which was accurate only while every product
 * shipped as a parcel - and `letter_eligible` is a checkbox on a product's row
 * in the Supabase table editor, so a single tick, with no deploy and no code
 * review, would have had the shop telling customers that untracked, uninsured
 * mail is tracked. Making it a required argument means the compiler asks the
 * question at every call site.
 *
 * `quoteBasket()` returns the answer as `tracked` on each quote. Pass that.
 * Never pass a literal - a literal is the hardcode again, just moved.
 */
export function transitLabel(methodId: string, tracked: boolean): string {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  if (!method) return "";
  return `${transitRangeLabel(methodId)} · ${tracked ? "tracked" : "untracked"}`;
}

/** Transit range for a method, defaulting to standard. */
export function transitDays(methodId: string): readonly [number, number] {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  return (method ?? SHIPPING.methods[0]).transitDays;
}

export type ShippingMethodId = (typeof SHIPPING.methods)[number]["id"];

/** Printing happens before dispatch - surfaced everywhere we quote delivery. */
export const PRINT_LEAD_TIME = {
  minDays: 2,
  maxDays: 4,
  label: "2–4 business days",
} as const;

/** GST is included in displayed prices (1/11th of a GST-inclusive total). */
export const GST_DIVISOR = 11;

/**
 * The letter caps, by how many the customer spelled. **Caps only** - no charm.
 *
 * $3.50 for the first letter, $1.00 for each one after, and 50c for the fifth.
 * Identical across every colourway so the stall never has to price on the fly.
 *
 * WHAT THIS LADDER COSTS, because it is a deliberate choice and the previous
 * one was chosen for the opposite reason.
 *
 * A marginal letter is about 21 minutes of machine time and 40c of filament and
 * clicker. Against the workbook's $3.33 printer-hour bar:
 *
 *   letters        price    margin    $ per printer-hour
 *   1              $3.50    50.2%     $2.60
 *   2              $4.50    49.5%     $2.17
 *   3              $5.50    49.1%     $1.95
 *   4              $6.50    48.8%     $1.83
 *   5              $7.00    45.8%     $1.54
 *
 * and the marginal letter on its own earns $1.34 an hour at $1.00, and **10c an
 * hour at 50c** - three and a half cents of profit for 21 minutes of printing.
 *
 * THE SHAPE IS NOW THE OTHER WAY UP. The ladder this replaced ran 54.7% to
 * 58.0% and $3.24 to $2.77, close to flat, and was built that way on purpose
 * because the one before it earned less per printer-hour the longer the name
 * got, which penalised exactly the customers who spent most. This one does that
 * again and more steeply: margin and dollars per hour both fall with every
 * letter, and a five-letter name is a little over two hours of machine time for
 * $3.20 of profit.
 *
 * Recorded rather than argued. It is a price the owner set, the numbers are
 * here so nobody has to rediscover them, and machine time is what limits the
 * year. See `claude/planner-workbook-fixes.md`.
 *
 * NOTE FOR WHOEVER EDITS THIS: `scripts/generate-seed.mjs` reads this table out
 * of this file with a regular expression, because it cannot import TypeScript.
 * Keep it a plain object literal on these lines or the seed generator will stop
 * finding it and say so rather than guessing.
 */
export const BUILDER_PRICING: Record<number, number> = {
  1: 350,
  2: 450,
  3: 550,
  4: 650,
  5: 700,
};

export const BUILDER_MAX_LETTERS = 5;

/** Cheapest a builder charm can be - the honest "from" price to advertise. */
export const BUILDER_FROM_PRICE = Math.min(...Object.values(BUILDER_PRICING));

/*
 * The ladder, as the three numbers copy actually needs, derived from the table
 * above so a price change cannot leave a sentence behind.
 *
 * This used to be a hardcoded "$3.99 for the first letter, $1.49 for each
 * after" in the builder page's metadata AND a second copy computed in its
 * heading, which is two places to update and one of them somewhere nobody
 * looks. `BUILDER_STEP` reads the first step; `BUILDER_FINAL_STEP` reads the
 * last, and they differ now, which is exactly why copy must not say "each one
 * after" and stop there.
 *
 * `BUILDER_STEP` assumes every step from the second letter to the second-last
 * is the same, which is true of this ladder by construction. If that ever stops
 * being true, the sentence below has to grow a case rather than quietly
 * describing only the first step.
 */
export const BUILDER_FIRST_LETTER = BUILDER_PRICING[1];
export const BUILDER_STEP = BUILDER_PRICING[2] - BUILDER_PRICING[1];
export const BUILDER_FINAL_STEP =
  BUILDER_PRICING[BUILDER_MAX_LETTERS] - BUILDER_PRICING[BUILDER_MAX_LETTERS - 1];

/**
 * The ladder in one sentence, for the places that sell it.
 *
 * The last clause appears only when the final letter really is priced
 * differently, so flattening the ladder later drops it automatically instead of
 * leaving a claim about a discount that no longer exists.
 */
export function builderLadderSentence(): string {
  const dollars = (cents: number) =>
    cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

  const base = `${dollars(BUILDER_FIRST_LETTER)} for the first letter, ${dollars(
    BUILDER_STEP,
  )} for each one after`;

  return BUILDER_FINAL_STEP === BUILDER_STEP
    ? base
    : `${base}, and just ${dollars(BUILDER_FINAL_STEP)} for the last one`;
}

/**
 * How a product collects its personalisation.
 *  - "builder": the keycap letter builder, priced by BUILDER_PRICING.
 *  - "text":    a single free-text field on the product page, priced at the
 *               product's own price (a pet bowl, a date chain).
 *  - null:      not personalised.
 */
export type PersonalisationMode = "builder" | "text" | null;

/** Free-text personalisation must stay printable and short enough to print. */
export const PERSONALISATION_TEXT_MAX = 20;
export const PERSONALISATION_TEXT_PATTERN = /^[A-Za-z0-9 '&.\-/]+$/;

/**
 * What comes off a charm's own retail price when it is bought with letter caps.
 *
 * The charm is **not** included and is off by default - the customer designs
 * caps, and adds a charm only if they want one. Adding it charges that
 * product's real price less this, so a charm never carries a second price of
 * its own to drift from the first: reprice the macaron in the Studio and the
 * builder follows in the same breath. The pointer to that product is
 * `collections.charm_slug` (migration 0009).
 *
 * $1.50 is a decision, not a costing. Bundling genuinely saves about $0.44 - no
 * bag of its own, no second fixed card fee - and the rest is bought goodwill
 * and basket size, which the postage bands then pay back, since a bigger basket
 * walks toward `SHIPPING.subsidyThreshold`. Worth knowing before it moves
 * again: at the macaron's $6.49 the standalone earns roughly the
 * $3.33/printer-hour bar and nothing more, so every cent of this comes out of a
 * product with no headroom.
 */
export const BUILDER_CHARM_BUNDLE_DISCOUNT = 150;

/**
 * What the builder charges for a charm, given that charm product's own price.
 *
 * Clamped at zero so a charm cheaper than the discount is free rather than a
 * credit. A negative line would let a basket price itself downward, which is
 * the shape of every "add it twice and get paid" bug - and the cart, which
 * cannot see the database, would have no way to notice.
 */
export function builderCharmPrice(charmProductPrice: number): number {
  return Math.max(0, charmProductPrice - BUILDER_CHARM_BUNDLE_DISCOUNT);
}

/*
 * There is deliberately no `SLOW_LETTERS` here any more.
 *
 * It listed Q, X, Z and F as "letters we don't keep deep stock of - printed to
 * order, adds a day", and the builder printed that sentence to customers. Both
 * halves were untrue. Nothing in this codebase measures stock per letter, and
 * nothing anywhere adds a day to the lead time for a name that contains one -
 * `PRINT_LEAD_TIME` is flat. It also implied the other twenty-two letters are
 * *not* printed to order, which is a stock claim by implication: every keycap
 * is printed for the order it belongs to.
 *
 * The builder's copy was removed first, which left this constant with no
 * readers at all. It is deleted rather than kept: a named list sitting in the
 * business-rules file is one a future screen will find, believe and print.
 */

export const BUILDER_ATTACHMENTS = [
  { id: "cord", label: "Bag charm cord", price_delta: 0 },
  { id: "keyring", label: "Keyring", price_delta: 0 },
  { id: "strap", label: "Phone strap", price_delta: 0 },
] as const;

/**
 * What the shop will accept in one basket.
 *
 * These are business rules in exactly the sense this file exists for: change
 * one and the basket, the postage quote and the Stripe session all have to move
 * together. They were four literals hand-copied into two Zod schemas
 * (`app/api/checkout/route.ts` and `app/api/shipping/quote/route.ts`) and then
 * transcribed a third time into `components/cart/limits.ts` - three copies,
 * nothing enforcing that they agreed, and a disagreement would not have failed
 * loudly: the client would happily build a basket the server then refuses with
 * a blanket "Invalid basket.", and the cart's postage call would come back 400
 * and render as "Calculated at checkout" with no total and no reason given.
 * That stopgap file is gone; this is the only copy.
 *
 * Both routes already import this module, and it is safe for them to: it
 * imports nothing at all and reads only NEXT_PUBLIC_ values, so it drags no
 * server-only code - no Supabase client, no Stripe, no secret - into a route
 * schema, and it stays importable from the client components below.
 *
 * Why the client enforces them too: a basket that breaches either cap is
 * refused wholesale, so the honest thing is to stop the basket being built that
 * way and to say what the limit is at the point it is reached.
 */
export const BASKET_LIMITS = {
  /** Most of any one line. Units, not lines. */
  maxLineQuantity: 20,
  /**
   * Most distinct lines in a basket. Counted in lines, not units - twenty of
   * one clicker is one line.
   */
  maxLines: 40,
} as const;

/**
 * What SHARE of the postage the customer pays - never how much the postage is.
 *
 * This is the shop's own promotion, and it is deliberately separate from what
 * the carrier charges. `quoteBasket()` in `lib/shipping/` answers "what does
 * Australia Post want to carry this basket"; this answers "how much of that
 * does the customer pay". Keeping them apart is what lets the bands move
 * without touching postage, and postage move without touching the bands.
 *
 * Returns 1, `SHIPPING.subsidisedShare` or 0. It returns a share rather than a
 * boolean because the middle band exists: the old `isFreeShipping()` answered
 * yes-or-no, and every caller that trusted it read "not free" as "charge the
 * whole quote". With three bands that is wrong for every basket between
 * `subsidyThreshold` and `freeThreshold`, and wrong in the studio's favour,
 * which is the direction a customer notices. `isFreeShipping()` survives below
 * as a thin wrapper for copy that only needs the top band.
 *
 * Express always returns 1. See the note on SHIPPING.
 *
 * The cart and checkout both run this same expression against the same
 * subtotal, so the two surfaces cannot disagree about who is charged.
 *
 * It replaced `shippingCost()`, which returned a flat per-method price. That
 * function is gone rather than deprecated: once postage is quoted per basket, a
 * second function still shaped like a price is a thing a future call site will
 * reach for by mistake, and the wrong postage is money out of the studio's
 * pocket on every order until someone reconciles a bill.
 */
export function shippingShare(subtotal: number, methodId: string): number {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  if (!method || method.id !== "standard") return 1;
  if (subtotal >= SHIPPING.freeThreshold) return 0;
  if (subtotal >= SHIPPING.subsidyThreshold) return SHIPPING.subsidisedShare;
  return 1;
}

/**
 * What the customer is charged for postage, given the carrier's quote.
 *
 * This is the ONLY place a quoted rate is turned into a charged rate. The cart
 * and the checkout both call it against the same subtotal, so the figure in the
 * basket and the figure Stripe charges cannot drift apart. Halving an odd
 * number of cents rounds to the nearest cent, so the studio and the customer
 * each carry the half-cent about equally often; at 0.5 there is nothing else
 * honest to do, and no basket turns on it.
 */
export function shippingCharge(
  quotedCents: number,
  subtotal: number,
  methodId: string,
): number {
  return Math.round(quotedCents * shippingShare(subtotal, methodId));
}

/** True only in the top band, where the customer pays nothing at all. */
export function isFreeShipping(subtotal: number, methodId: string): boolean {
  return shippingShare(subtotal, methodId) === 0;
}

/**
 * True in the middle band only - the customer pays something, but not all of
 * it. Copy that says "we pay half" must be gated on this and not on
 * `!isFreeShipping()`, which is also true of a basket paying the full rate.
 */
export function isSubsidisedShipping(
  subtotal: number,
  methodId: string,
): boolean {
  const share = shippingShare(subtotal, methodId);
  return share > 0 && share < 1;
}
