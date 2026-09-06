/**
 * Business rules for the shop. These mirror the Settings sheet of the
 * 3D_Planner workbook — change them here, not inline in components.
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
   * no GST component may be shown — that would misrepresent a tax that is not
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
   * (lib/email.ts) and handed to client components as a prop — see lib/contact.ts.
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
 * a flat rate — 950 and 1450 — and the terms of sale, the FAQ, the tracking
 * page and every product page printed it. Postage is now quoted per basket from
 * Australia Post by `lib/shipping/quoteBasket()`, which for a real basket
 * returns anything from about 340 to well over 2000, so every one of those
 * pages was about to state a price the shop does not charge — in the contract,
 * in one case. The field is gone rather than left unread: a number sitting here
 * called `price` is one a future page will print.
 *
 * What belongs here is what the *shop* decides — its promotion and its service
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
 * The worst order in the model is the one that *just* crosses `freeThreshold` —
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
      /** Carrier transit only — printing happens before this starts. */
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
 * "3–7 business days" — the carrier's transit range alone, with no claim about
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
 * shipped as a parcel — and `letter_eligible` is a checkbox on a product's row
 * in the Supabase table editor, so a single tick, with no deploy and no code
 * review, would have had the shop telling customers that untracked, uninsured
 * mail is tracked. Making it a required argument means the compiler asks the
 * question at every call site.
 *
 * `quoteBasket()` returns the answer as `tracked` on each quote. Pass that.
 * Never pass a literal — a literal is the hardcode again, just moved.
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

/** Printing happens before dispatch — surfaced everywhere we quote delivery. */
export const PRINT_LEAD_TIME = {
  minDays: 2,
  maxDays: 4,
  label: "2–4 business days",
} as const;

/** GST is included in displayed prices (1/11th of a GST-inclusive total). */
export const GST_DIVISOR = 11;

/**
 * Flat bundle pricing for the DIY name charm, by number of letters.
 * Identical across every colourway so the stall never has to price on the fly.
 *
 * $4.00 plus $1.50 a letter. The step was $1.00 until the costing found that
 * **every letter cap carries its own clicker**, not one per name — so a
 * marginal letter costs about 40c in parts and print, not 16c, and a $1.00
 * step was returning under $3/printer-hour at every length.
 *
 * $1.50 is a deliberate part-measure. The workbook's own bar is $3.33 per
 * printer-hour and clearing it needs about $2.00 a letter; this ladder still
 * sits under the bar. It is here because it is the ladder that was chosen, not
 * because the numbers endorse it — see `claude/planner-workbook-fixes.md`.
 */
export const BUILDER_PRICING: Record<number, number> = {
  1: 400,
  2: 550,
  3: 700,
  4: 850,
  5: 1000,
};

export const BUILDER_MAX_LETTERS = 5;

/** Cheapest a builder charm can be — the honest "from" price to advertise. */
export const BUILDER_FROM_PRICE = Math.min(...Object.values(BUILDER_PRICING));

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

/** Charm is included by default; dropping it takes a dollar off. */
export const BUILDER_NO_CHARM_DISCOUNT = 100;

/*
 * There is deliberately no `SLOW_LETTERS` here any more.
 *
 * It listed Q, X, Z and F as "letters we don't keep deep stock of — printed to
 * order, adds a day", and the builder printed that sentence to customers. Both
 * halves were untrue. Nothing in this codebase measures stock per letter, and
 * nothing anywhere adds a day to the lead time for a name that contains one —
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
 * transcribed a third time into `components/cart/limits.ts` — three copies,
 * nothing enforcing that they agreed, and a disagreement would not have failed
 * loudly: the client would happily build a basket the server then refuses with
 * a blanket "Invalid basket.", and the cart's postage call would come back 400
 * and render as "Calculated at checkout" with no total and no reason given.
 * That stopgap file is gone; this is the only copy.
 *
 * Both routes already import this module, and it is safe for them to: it
 * imports nothing at all and reads only NEXT_PUBLIC_ values, so it drags no
 * server-only code — no Supabase client, no Stripe, no secret — into a route
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
   * Most distinct lines in a basket. Counted in lines, not units — twenty of
   * one clicker is one line.
   */
  maxLines: 40,
} as const;

/**
 * What SHARE of the postage the customer pays — never how much the postage is.
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
 * True in the middle band only — the customer pays something, but not all of
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
