export type ArtKey =
  | "macaron"
  | "matcha"
  | "coffee"
  | "cinnamon"
  | "sushi"
  | "icecream"
  | "smore"
  | "butter"
  | "tulip"
  | "cactus"
  | "letters"
  | "corgi"
  | "tennis"
  | "stand"
  | "pancake"
  | "croissant"
  | "bao";

export type Tint =
  | "blush"
  | "butter"
  | "sage"
  | "sky"
  | "lilac"
  | "cream";

/** An attachment option is a separate saleable line (own SKU + accessory cost). */
export type Attachment = {
  id: string;
  label: string;
  /** Price delta in cents, applied on top of the product's base price. */
  price_delta: number;
};

export type ProductImage = {
  art: ArtKey;
  tint: Tint;
  alt: string;
};

export type Product = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  short_name: string;
  category: string;
  theme: string;
  description: string;
  /** Base price in cents (AUD). */
  price: number;
  art: ArtKey;
  tint: Tint;
  gallery: ProductImage[];
  colours: { name: string; hex: string }[];
  attachments: Attachment[];
  details: { title: string; body: string }[];
  rating: number;
  review_count: number;
  /** Units printed and ready to post right now; 0 means made-to-order only. */
  stock_on_hand: number;
  is_bestseller: boolean;
  is_new: boolean;
  /** Personalised items cannot be returned and skip the ready-to-ship path. */
  is_personalised: boolean;
  /** How personalisation is collected — see PersonalisationMode. */
  personalisation_mode: "builder" | "text" | null;
  /** Field label for "text" mode, e.g. "Pet's name". */
  personalisation_label: string | null;
  active: boolean;
};

export type Collection = {
  id: string;
  slug: string;
  name: string;
  cap_colour: string;
  letter_colour: string;
  holder_colour: string;
  charm_art: ArtKey;
  charm_name: string;
  tint: Tint;
  is_popular: boolean;
};

export type Review = {
  id: string;
  product_id: string;
  author_name: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
  verified: boolean;
};

/** A line in the shopper's basket. Personalised lines carry `custom`. */
export type CartLine = {
  /** Stable key: product + colour + attachment (+ personalisation hash). */
  key: string;
  product_id: string;
  slug: string;
  name: string;
  art: ArtKey;
  tint: Tint;
  colour: string | null;
  attachment_id: string | null;
  attachment_label: string | null;
  /** Resolved unit price in cents, deltas already applied. */
  unit_price: number;
  quantity: number;
  is_personalised: boolean;
  /** Builder charms only: the colourway and letters chosen. */
  custom?: {
    collection_slug: string;
    collection_name: string;
    letters: string;
    with_charm: boolean;
  };
  /** "text" mode only: the single line the customer asked us to print. */
  personalisation_text?: string | null;
};

export type OrderStatus =
  /** Staged when the Stripe session opens; never shown to the customer. */
  | "pending"
  | "confirmed"
  | "printing"
  | "packed"
  | "shipped"
  | "delivered"
  | "cancelled";

export const ORDER_STATUS_FLOW: OrderStatus[] = [
  "confirmed",
  "printing",
  "packed",
  "shipped",
];

export type Order = {
  id: string;
  order_number: string;
  user_id: string | null;
  email: string;
  status: OrderStatus;
  subtotal: number;
  shipping: number;
  total: number;
  shipping_method: string;
  gift_note: string | null;
  tracking_number: string | null;
  shipping_address: Address;
  created_at: string;
  items: OrderItem[];
};

export type OrderItem = {
  id: string;
  product_name: string;
  variant_label: string;
  art: ArtKey;
  tint: Tint;
  /** Stored so "buy again" restores the exact variant that was ordered. */
  colour: string | null;
  attachment_id: string | null;
  unit_price: number;
  quantity: number;
};

export type Address = {
  id?: string;
  label?: string;
  first_name: string;
  last_name: string;
  line1: string;
  line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  /**
   * Optional because it is not always sent to the client. The public /track
   * endpoint allow-lists the address it returns and drops the phone number
   * (app/api/track/route.ts) — anyone with an order number and an email can
   * reach that page. The Stripe webhook still *stores* it (the studio may need
   * to ring about a delivery) and /account/orders/[id], which is behind auth,
   * still shows it.
   */
  phone?: string | null;
  is_default?: boolean;
};

/**
 * What the public order-tracking endpoint sends to the browser.
 *
 * Deliberately narrower than the stored row: order numbers are a public
 * sequence plus four hex characters, so someone holding a customer's email can
 * try suffixes. The response therefore carries only what
 * app/track/TrackForm.tsx renders. Adding a field here is deciding that a
 * brute-forcer may have it too.
 */
export type PublicTrackedAddress = {
  first_name: string;
  last_name: string;
  line1: string;
  line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  /** No `phone`: stored, never published. */
};

export type PublicTrackedItem = {
  product_name: string;
  variant_label: string | null;
  art: ArtKey;
  tint: Tint;
  unit_price: number;
  quantity: number;
};

export type PublicTrackedOrder = {
  order_number: string;
  status: OrderStatus;
  total: number;
  shipping_method: string;
  tracking_number: string | null;
  created_at: string;
  shipping_address: PublicTrackedAddress | null;
  items: PublicTrackedItem[];
};

export const AU_STATES = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;
