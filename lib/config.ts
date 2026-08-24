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
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "hello@example.com",
  socials: {
    instagram: process.env.NEXT_PUBLIC_INSTAGRAM_URL ?? "#",
    tiktok: process.env.NEXT_PUBLIC_TIKTOK_URL ?? "#",
  },
} as const;

export const SHIPPING = {
  /** Free standard shipping at or above this basket subtotal. */
  freeThreshold: 4900,
  methods: [
    {
      id: "standard",
      label: "Standard",
      description: "3–7 business days · tracked",
      price: 950,
    },
    {
      id: "express",
      label: "Express",
      description: "1–3 business days · tracked",
      price: 1450,
    },
  ],
} as const;

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

/** Charm is included by default; dropping it takes a dollar off. */
export const BUILDER_NO_CHARM_DISCOUNT = 100;

/** Letters we don't keep deep stock of — printed to order, adds a day. */
export const SLOW_LETTERS = ["Q", "X", "Z", "F"];

export const BUILDER_ATTACHMENTS = [
  { id: "cord", label: "Bag charm cord", price_delta: 0 },
  { id: "keyring", label: "Keyring", price_delta: 0 },
  { id: "strap", label: "Phone strap", price_delta: 0 },
] as const;

export function shippingCost(subtotal: number, methodId: string): number {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  if (!method) return 0;
  if (method.id === "standard" && subtotal >= SHIPPING.freeThreshold) return 0;
  return method.price;
}
