/**
 * Business rules for the shop. These mirror the Settings sheet of the
 * 3D_Planner workbook — change them here, not inline in components.
 * All money is in cents (AUD) to avoid float drift.
 */

export const SHOP = {
  name: "Bam Studio",
  tagline: "Cute, clicky little things you'll never put down.",
  city: "Sydney",
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
 */
export const SHIPPING = {
  /** Free standard shipping at or above this basket subtotal. */
  freeThreshold: 4900,
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
 */
export const BUILDER_PRICING: Record<number, number> = {
  1: 400,
  2: 500,
  3: 600,
  4: 700,
  5: 800,
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

/** Letters we don't keep deep stock of — printed to order, adds a day. */
export const SLOW_LETTERS = ["Q", "X", "Z", "F"];

export const BUILDER_ATTACHMENTS = [
  { id: "cord", label: "Bag charm cord", price_delta: 0 },
  { id: "keyring", label: "Keyring", price_delta: 0 },
  { id: "strap", label: "Phone strap", price_delta: 0 },
] as const;

/**
 * Who pays the postage — never how much the postage is.
 *
 * This is the shop's own free-standard-post promotion, and it is deliberately
 * separate from what the carrier charges. `quoteBasket()` in `lib/shipping/`
 * answers "what does Australia Post want to carry this basket"; this answers
 * "does the customer pay it". Keeping them apart is what lets the threshold
 * move without touching postage, and postage move without touching the
 * threshold.
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
export function isFreeShipping(subtotal: number, methodId: string): boolean {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  if (!method) return false;
  return method.id === "standard" && subtotal >= SHIPPING.freeThreshold;
}
