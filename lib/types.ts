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
  /**
   * Packed weight in grams — the only input Australia Post prices a domestic
   * parcel on, so a basket's postage is the sum of these. Non-optional because
   * the column is `not null` with a charm-sized default: a row nobody has put
   * on the scales yet is still quotable, rather than a hole in the checkout.
   */
  weight_grams: number;
  /** Packed length in mm. Not priced on, but the API validates it. */
  length_mm: number;
  /** Packed width in mm. Not priced on, but the API validates it. */
  width_mm: number;
  /** Packed thickness in mm — usually what pushes an item past Large Letter. */
  thickness_mm: number;
  /**
   * Owner's manual override: false forces a parcel quote however small the
   * measurements look. Bulk is not always a bounding box, and Large Letter is
   * untracked and uninsured — a lost one is a loss the studio wears.
   */
  letter_eligible: boolean;
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
  /**
   * How the postage on this order was arrived at. Null on every order placed
   * before postage was quoted — that is "flat rate era", not missing data,
   * which is why these three are nullable rather than defaulted.
   *
   * Stored so a discrepancy found months later (the studio paid parcel rates
   * on something the customer was charged Large Letter for) is diagnosable,
   * and so a future label-printing phase can raise the shipment from what was
   * actually quoted rather than re-deriving it from a basket whose products
   * may have been re-measured or deactivated since.
   */
  shipping_quote_source: "live" | "cache" | "stale" | "fallback" | null;
  /** Basket weight the quote was priced on. See shipping_quote_source. */
  quoted_weight_grams: number | null;
  /** Australia Post service the quote was for — the other half of a label. */
  quoted_service_code: string | null;
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

/* ------------------------------------------------------------ lucky scoop */

/**
 * The topic a scoop tier draws from.
 *
 * THE CUSTOMER PICKS THE THEME; THE DRAW PICKS THE PIECES. At the stall a
 * charm-colour board maps colour to category and the scoop decides which
 * category you get. Online that mechanic sells somebody pet things when they
 * came for clickers, and "goods must match their description" is not waived by
 * calling it lucky — so the theme is chosen, not drawn, and the board stays in
 * the video where it is theatre rather than a term of sale.
 *
 * Kept in step with the CHECK constraint on `scoop_tiers.theme`
 * (0007_lucky_scoop.sql). A value that is not one of these is a value the
 * studio's dropdown cannot produce.
 */
export type ScoopTheme = "pet" | "household" | "clickers_keyrings" | "mixed";

/** The dropdown, in display order. One list for the studio and the shopfront. */
export const SCOOP_THEMES: { value: ScoopTheme; label: string }[] = [
  { value: "pet", label: "Pet" },
  { value: "household", label: "Household" },
  { value: "clickers_keyrings", label: "Clickers & keyrings" },
  { value: "mixed", label: "Mixed" },
];

/**
 * A Lucky Scoop tier — the thing a customer actually buys. "Pet scoop, five
 * pieces, $X".
 *
 * Deliberately not a `Product`: its price starts null, its stock is a property
 * of a pool of other rows, its cost is not knowable until it is packed, and its
 * weight is a worst case somebody chose rather than something that was weighed.
 * See 0007_lucky_scoop.sql for the reasoning in full.
 *
 * Row shape, straight off PostgREST, so the columns keep their snake_case names
 * exactly as `Product` and `Order` do.
 */
export type ScoopTier = {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  theme: ScoopTheme;
  /** How many pieces the tier promises. The owner's starting number is 5. */
  piece_count: number;
  /**
   * Price in cents, or null when nobody has priced it yet. NEVER 0 — the
   * database refuses a zero, because a zero renders as "$0.00" and reads as a
   * free scoop. A tier cannot be activated while this is null.
   */
  price_cents: number | null;
  /**
   * Worst-case packed weight in grams. A scoop has no product row to take a
   * weight from, so postage is quoted from this — set from the heaviest
   * plausible pack, never the average, or the studio wears the difference.
   * Null blocks activation.
   */
  packed_weight_grams: number | null;
  /** Worst-case packed thickness in mm. Null until a test pack is measured. */
  packed_thickness_mm: number | null;
  sort_order: number;
  /** Defaults to false: a tier is a draft until somebody switches it on. */
  active: boolean;
  created_at: string;
};

/**
 * A tier with the products that may be drawn into it.
 *
 * The pool is what turns "random" into a describable promise — the product page
 * can say "five pieces drawn from these twelve" and show them — and it is
 * explicit rows rather than a category filter, so a pet bowl cannot silently
 * join a clicker scoop. Read with the anon key, the pool contains only ACTIVE
 * products: a retired one is still a row in `scoop_tier_products` (deleting the
 * product is refused) but RLS on `products` drops it here, which is also what
 * makes the tier's availability fall as things are retired.
 */
export type ScoopTierWithPool = ScoopTier & { pool: Product[] };
