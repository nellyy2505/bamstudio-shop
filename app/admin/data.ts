import { createAdminClient } from "@/lib/supabase/server";
import {
  suggestedPrice,
  toPrint,
  unitCost,
  type CostBreakdown,
  type CostSettings,
} from "@/lib/costing";

/**
 * Every read the staff area makes.
 *
 * All of it goes through the service-role client, because most of what the
 * studio looks at — costs, settings, who is staff, how many rolls are on the
 * shelf — is deliberately unreadable with the key that ships to browsers.
 *
 * That makes this module the sharpest edge in the app: it can see everything.
 * Two rules keep it safe.
 *
 *   1. Nothing here takes a user id, a role, or any other authority from an
 *      argument. Callers have already been through `requireStaff()`; this file
 *      answers "what is in the database", never "who is asking".
 *   2. Nothing here is called from a client component. It is server-side only.
 *
 * Counts use `head: true`, which asks Postgres for the count and none of the
 * rows — on a free-tier database that is the difference between a dashboard and
 * a bill.
 */

/*
 * A hand-rolled stand-in for `import "server-only"`, which is deliberately not a
 * dependency of this project. Throwing is the point: answering `false`, or
 * quietly returning nothing, would let a client component import this module
 * and fail at runtime somewhere far away from the mistake.
 */
function assertServer(fn: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${fn}() was called in the browser. Everything in app/admin/data.ts reads ` +
        "with the service-role key and must never reach a client bundle.",
    );
  }
}


/**
 * Reshape a PostgREST row into something indexable.
 *
 * The Supabase client is untyped in this project (no generated Database type),
 * so for a `select()` built by string concatenation — which the ones below are,
 * because they share a column list — it cannot infer a row shape and falls back
 * to `GenericStringError`. Casting straight to Record<string, unknown> is
 * rejected as a mistake, which is fair: the two types genuinely do not overlap.
 *
 * The double cast is the honest spelling of what is happening. Every field is
 * then read through an explicit Number()/String()/Boolean() below, so a column
 * that is renamed or dropped shows up as a null or a zero on screen rather than
 * as a type error the compiler was never in a position to catch.
 */
function asRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/** How many rows a table shows before it pages. */
export const PAGE_SIZE = 25;

/**
 * Statuses that mean a person still has something to do.
 *
 * `pending` is excluded deliberately: those are checkouts that were started and
 * never paid for. They are not orders and must never appear in a queue, a
 * count, or a revenue figure.
 */
export const OPEN_ORDER_STATUSES = ["confirmed", "printing", "packed"] as const;

/**
 * Statuses that count as real, paid demand.
 *
 * The workbook's rule, from `Orders!H`: everything except Done and Cancelled is
 * still owed to someone. `delivered` is her "Done"; `shipped` is not — a parcel
 * in the post is out of the studio but the stock is gone, so it neither needs
 * printing nor sits on the shelf.
 */
const DEMAND_STATUSES = ["confirmed", "printing", "packed"] as const;

/** Statuses that count as a completed sale for money purposes. */
export const SOLD_STATUSES = [
  "confirmed",
  "printing",
  "packed",
  "shipped",
  "delivered",
] as const;

/* ------------------------------------------------------------- settings */

export type Settings = CostSettings & {
  printerModel: string | null;
  defaultBufferStock: number;
  mailerPerOrderCents: number;
};

/**
 * The costing constants.
 *
 * Postgres returns `numeric` as a *string* through PostgREST, to avoid the
 * precision loss of a float. Every one of these goes through Number() for that
 * reason — read `target_margin` straight and you get "0.700", and
 * `1 - "0.700" - 0.016` is NaN, which then propagates silently into every price
 * on the screen.
 */
export async function getSettings(): Promise<Settings> {
  assertServer("getSettings");

  const admin = createAdminClient();
  const { data } = await admin.from("shop_settings").select("*").maybeSingle();

  const row = asRow(data ?? {});
  const num = (key: string, fallback = 0) => {
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    printerModel: (row.printer_model as string | null) ?? null,
    printerPriceCents: num("printer_price_cents"),
    printerLifeHours: num("printer_life_hours", 1),
    powerDrawWatts: num("power_draw_watts"),
    electricityPerKwhCents: num("electricity_per_kwh_cents"),
    filamentPerKgCents: num("filament_per_kg_cents"),
    targetMargin: num("target_margin"),
    cardFeeRate: num("card_fee_rate"),
    roundPriceToCents: num("round_price_to_cents", 1),
    packagingPerUnitCents: num("packaging_per_unit_cents"),
    defaultBufferStock: num("default_buffer_stock", 5),
    mailerPerOrderCents: num("mailer_per_order_cents"),
  };
}

/* ---------------------------------------------------------- accessories */

export type Accessory = {
  id: string;
  name: string;
  costCents: number;
  costNote: string | null;
  active: boolean;
  sortOrder: number;
};

export async function getAccessories(): Promise<Accessory[]> {
  assertServer("getAccessories");

  const admin = createAdminClient();
  const { data } = await admin
    .from("accessories")
    .select("id, name, cost_cents, cost_note, active, sort_order")
    .order("sort_order", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    costCents: Number(row.cost_cents ?? 0),
    costNote: (row.cost_note as string | null) ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

/* -------------------------------------------------------------- colours */

export type ColourRow = {
  id: string;
  name: string;
  hex: string;
  active: boolean;
  sortOrder: number;
  rollsOnHand: number;
};

export async function getColours(): Promise<ColourRow[]> {
  assertServer("getColours");

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("colours")
    .select("id, name, hex, active, sort_order, filament_stock(rolls_on_hand)")
    .order("sort_order", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => {
    // The join comes back as an array for a one-to-many shape even though the
    // foreign key makes it at most one row.
    const stock = Array.isArray(row.filament_stock)
      ? row.filament_stock[0]
      : row.filament_stock;

    return {
      id: row.id as string,
      name: row.name as string,
      hex: row.hex as string,
      active: Boolean(row.active),
      sortOrder: Number(row.sort_order ?? 0),
      rollsOnHand: Number(
        (stock as { rolls_on_hand?: number } | null)?.rolls_on_hand ?? 0,
      ),
    };
  });
}

/* ------------------------------------------------------------- products */

export type ProductPhoto = { path: string; alt: string };

export type FilamentUse = { colourId: string; colourName: string; hex: string; grams: number };

export type ProductRow = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  shortName: string;
  category: string;
  theme: string;
  price: number;
  active: boolean;
  onMarketStall: boolean;
  stockOnHand: number;
  bufferStock: number;
  printTimeHours: number | null;
  accessoryId: string | null;
  photos: ProductPhoto[];
  art: string;
  tint: string;
  filament: FilamentUse[];
  /** Total grams, or null when no colour has been recorded at all. */
  totalGrams: number | null;
};

/** A product with everything the edit screen and the costing need. */
export type ProductDetail = ProductRow & {
  description: string;
  isBestseller: boolean;
  isNew: boolean;
  isPersonalised: boolean;
  personalisationMode: string | null;
  personalisationLabel: string | null;
  weightGrams: number;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  gallery: unknown[];
  colours: unknown[];
  attachments: unknown[];
  details: unknown[];
};

const PRODUCT_COLUMNS =
  "id, sku, slug, name, short_name, category, theme, price, active, " +
  "on_market_stall, stock_on_hand, buffer_stock, print_time_hours, " +
  "accessory_id, photos, art, tint, " +
  "product_filament(grams, colours(id, name, hex))";

type FilamentJoin = {
  grams: number | string;
  colours: { id: string; name: string; hex: string } | { id: string; name: string; hex: string }[] | null;
};

function mapFilament(rows: unknown): FilamentUse[] {
  if (!Array.isArray(rows)) return [];
  return (rows as FilamentJoin[])
    .map((row) => {
      const colour = Array.isArray(row.colours) ? row.colours[0] : row.colours;
      if (!colour) return null;
      return {
        colourId: colour.id,
        colourName: colour.name,
        hex: colour.hex,
        grams: Number(row.grams ?? 0),
      };
    })
    .filter((x): x is FilamentUse => x !== null)
    .sort((a, b) => b.grams - a.grams);
}

function mapPhotos(value: unknown): ProductPhoto[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((p): p is { path?: unknown; alt?: unknown } => typeof p === "object" && p !== null)
    .map((p) => ({ path: String(p.path ?? ""), alt: String(p.alt ?? "") }))
    .filter((p) => p.path.length > 0);
}

function mapProductRow(row: Record<string, unknown>): ProductRow {
  const filament = mapFilament(row.product_filament);
  return {
    id: row.id as string,
    sku: row.sku as string,
    slug: row.slug as string,
    name: row.name as string,
    shortName: (row.short_name as string) ?? "",
    category: (row.category as string) ?? "",
    theme: (row.theme as string) ?? "",
    price: Number(row.price ?? 0),
    active: Boolean(row.active),
    onMarketStall: Boolean(row.on_market_stall),
    stockOnHand: Number(row.stock_on_hand ?? 0),
    bufferStock: Number(row.buffer_stock ?? 0),
    // Null and 0 are different answers and must stay different: null is "never
    // timed", 0 would be "prints instantly".
    printTimeHours:
      row.print_time_hours === null || row.print_time_hours === undefined
        ? null
        : Number(row.print_time_hours),
    accessoryId: (row.accessory_id as string | null) ?? null,
    photos: mapPhotos(row.photos),
    art: (row.art as string) ?? "macaron",
    tint: (row.tint as string) ?? "cream",
    filament,
    totalGrams: filament.length === 0 ? null : filament.reduce((s, f) => s + f.grams, 0),
  };
}

export type ProductListFilters = {
  /** Free text over name and SKU. */
  q?: string;
  category?: string;
  /** "active" | "hidden" | undefined for both. */
  visibility?: string;
};

export type Paged<T> = {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
};

export async function listProducts(
  page: number,
  filters: ProductListFilters = {},
): Promise<Paged<ProductRow>> {
  assertServer("listProducts");

  const admin = createAdminClient();

  let query = admin
    .from("products")
    .select(PRODUCT_COLUMNS, { count: "exact" })
    .order("sku", { ascending: true });

  if (filters.q) {
    // Escaped: a comma or a parenthesis in the search box would otherwise be
    // read as PostgREST filter syntax rather than as text someone typed.
    const safe = filters.q.replace(/[,()\\*]/g, " ").trim();
    if (safe) query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%`);
  }
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.visibility === "active") query = query.eq("active", true);
  if (filters.visibility === "hidden") query = query.eq("active", false);

  // Count first, so the page number can be clamped before the range is asked
  // for. A range past the end returns zero rows rather than an error, which
  // looks exactly like "no products" and is how an empty table gets shipped.
  const probe = await query.range(0, 0);
  const total = probe.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const from = (safePage - 1) * PAGE_SIZE;

  const { data } = await query.range(from, from + PAGE_SIZE - 1);

  return {
    rows: (data ?? []).map((r) => mapProductRow(asRow(r))),
    page: safePage,
    pageCount,
    total,
  };
}

export async function getProduct(id: string): Promise<ProductDetail | null> {
  assertServer("getProduct");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select(
      PRODUCT_COLUMNS +
        ", description, is_bestseller, is_new, is_personalised, " +
        "personalisation_mode, personalisation_label, weight_grams, " +
        "length_mm, width_mm, thickness_mm, gallery, colours, attachments, details",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = asRow(data);
  return {
    ...mapProductRow(row),
    description: (row.description as string) ?? "",
    isBestseller: Boolean(row.is_bestseller),
    isNew: Boolean(row.is_new),
    isPersonalised: Boolean(row.is_personalised),
    personalisationMode: (row.personalisation_mode as string | null) ?? null,
    personalisationLabel: (row.personalisation_label as string | null) ?? null,
    weightGrams: Number(row.weight_grams ?? 0),
    lengthMm: Number(row.length_mm ?? 0),
    widthMm: Number(row.width_mm ?? 0),
    thicknessMm: Number(row.thickness_mm ?? 0),
    gallery: Array.isArray(row.gallery) ? row.gallery : [],
    colours: Array.isArray(row.colours) ? row.colours : [],
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    details: Array.isArray(row.details) ? row.details : [],
  };
}

/** Distinct categories, for the filter on the list. */
export async function getCategories(): Promise<string[]> {
  assertServer("getCategories");
  const admin = createAdminClient();
  const { data } = await admin.from("products").select("category");
  return [...new Set((data ?? []).map((r) => r.category as string))]
    .filter(Boolean)
    .sort();
}

/* ------------------------------------------------------------- costing */

export type CostedProduct = {
  cost: CostBreakdown;
  suggested: number | null;
  accessoryName: string | null;
};

/**
 * The cost of one product, given already-loaded settings and accessories.
 *
 * Takes them as arguments rather than fetching, so a list of 25 products costs
 * one settings read rather than 25.
 */
export function costProduct(
  product: Pick<ProductRow, "printTimeHours" | "totalGrams" | "accessoryId">,
  settings: CostSettings,
  accessories: Accessory[],
): CostedProduct {
  const accessory = accessories.find((a) => a.id === product.accessoryId) ?? null;
  const cost = unitCost(settings, {
    printHours: product.printTimeHours,
    grams: product.totalGrams,
    accessoryCents: accessory?.costCents ?? 0,
  });
  return {
    cost,
    // A partial cost must not produce a price. With no print time and no
    // filament weight, `cost.total` is packaging alone — 13c — and
    // suggestedPrice() turned that into a $0.50 suggestion and a 97% margin on
    // a piece nobody has measured, which is exactly the number she would price
    // from. The guard lives here and not in suggestedPrice() because
    // lib/costing.ts is a line-by-line transcription of the workbook, checked
    // against Excel's own cached values by scripts/check-costing.mjs; the
    // workbook has no notion of an unmeasured input, so teaching one to that
    // file would make the sheet and the shop disagree. Knowing that an input is
    // missing is this layer's job.
    suggested: cost.unknown ? null : suggestedPrice(settings, cost.total),
    accessoryName: accessory?.name ?? null,
  };
}

/* ------------------------------------------------------------- demand */

/**
 * Open (paid but not yet posted) quantity per product id.
 *
 * The workbook's `Orders!H` — "Open qty" — aggregated the way column AC does.
 * One query for the whole catalogue rather than one per product.
 */
export async function getOpenDemand(): Promise<Map<string, number>> {
  assertServer("getOpenDemand");

  const admin = createAdminClient();
  const { data } = await admin
    .from("order_items")
    .select("product_id, quantity, orders!inner(status)")
    .in("orders.status", DEMAND_STATUSES as unknown as string[]);

  const demand = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.product_id as string | null;
    if (!id) continue;
    demand.set(id, (demand.get(id) ?? 0) + Number(row.quantity ?? 0));
  }
  return demand;
}

/* ----------------------------------------------------------- inventory */

export type InventoryRow = {
  product: ProductRow;
  ordered: number;
  toPrint: number;
};

export type FilamentNeed = {
  colourId: string;
  name: string;
  hex: string;
  gramsNeeded: number;
  rollsNeeded: number;
  rollsOnHand: number;
  rollsToBuy: number;
  costToBuyCents: number;
  usedOnProducts: number;
};

export type Inventory = {
  rows: InventoryRow[];
  filament: FilamentNeed[];
  totalToPrint: number;
  totalRollsToBuy: number;
  totalBuyCostCents: number;
  /** Products with no filament recipe at all — invisible to the buy list. */
  unmeasured: number;
};

/**
 * The print queue and the filament it needs.
 *
 * This is the Filament sheet: for every colour, how many grams the queue will
 * consume, how many rolls that is, and how many to buy. It reads the whole
 * catalogue rather than a page of it, because a buy list that only covers the
 * products on screen is worse than none.
 */
export async function getInventory(): Promise<Inventory> {
  assertServer("getInventory");

  const admin = createAdminClient();
  const [{ data: productData }, colours, demand, settings] = await Promise.all([
    admin.from("products").select(PRODUCT_COLUMNS).order("sku", { ascending: true }),
    getColours(),
    getOpenDemand(),
    getSettings(),
  ]);

  const products = (productData ?? []).map((r) => mapProductRow(asRow(r)));

  const rows: InventoryRow[] = products.map((product) => {
    const ordered = demand.get(product.id) ?? 0;
    return {
      product,
      ordered,
      toPrint: toPrint({
        onHand: product.stockOnHand,
        ordered,
        buffer: product.bufferStock,
      }),
    };
  });

  // Grams needed per colour = for each product, its per-colour grams times how
  // many of it are still to print.
  const grams = new Map<string, number>();
  const usedOn = new Map<string, number>();
  for (const row of rows) {
    for (const use of row.product.filament) {
      usedOn.set(use.colourId, (usedOn.get(use.colourId) ?? 0) + 1);
      if (row.toPrint > 0) {
        grams.set(use.colourId, (grams.get(use.colourId) ?? 0) + use.grams * row.toPrint);
      }
    }
  }

  const filament: FilamentNeed[] = colours.map((colour) => {
    const gramsNeeded = grams.get(colour.id) ?? 0;
    const rollsNeeded = Math.ceil(gramsNeeded / 1000);
    const rollsToBuy = Math.max(0, rollsNeeded - colour.rollsOnHand);
    return {
      colourId: colour.id,
      name: colour.name,
      hex: colour.hex,
      gramsNeeded,
      rollsNeeded,
      rollsOnHand: colour.rollsOnHand,
      rollsToBuy,
      costToBuyCents: rollsToBuy * settings.filamentPerKgCents,
      usedOnProducts: usedOn.get(colour.id) ?? 0,
    };
  });

  return {
    rows: rows.filter((r) => r.toPrint > 0).sort((a, b) => b.toPrint - a.toPrint),
    filament,
    totalToPrint: rows.reduce((s, r) => s + r.toPrint, 0),
    totalRollsToBuy: filament.reduce((s, f) => s + f.rollsToBuy, 0),
    totalBuyCostCents: filament.reduce((s, f) => s + f.costToBuyCents, 0),
    unmeasured: products.filter((p) => p.totalGrams === null).length,
  };
}

/* -------------------------------------------------------------- orders */

export type OrderRow = {
  id: string;
  orderNumber: string | null;
  email: string;
  status: string;
  channel: string;
  subtotal: number;
  shipping: number;
  total: number;
  createdAt: string;
  itemCount: number;
};

export type OrderLine = {
  id: string;
  productId: string | null;
  productName: string;
  variantLabel: string;
  unitPrice: number;
  quantity: number;
  unitCostCents: number | null;
  colour: string | null;
  personalisation: unknown;
};

export type OrderDetail = OrderRow & {
  shippingMethod: string;
  trackingNumber: string | null;
  giftNote: string | null;
  shippingAddress: Record<string, unknown>;
  stripePaymentIntent: string | null;
  recordedBy: string | null;
  lines: OrderLine[];
};

const ORDER_COLUMNS =
  "id, order_number, email, status, channel, subtotal, shipping, total, " +
  "created_at, order_items(id)";

function mapOrderRow(row: Record<string, unknown>): OrderRow {
  return {
    id: row.id as string,
    orderNumber: (row.order_number as string | null) ?? null,
    email: (row.email as string) ?? "",
    status: row.status as string,
    channel: (row.channel as string) ?? "website",
    subtotal: Number(row.subtotal ?? 0),
    shipping: Number(row.shipping ?? 0),
    total: Number(row.total ?? 0),
    createdAt: row.created_at as string,
    itemCount: Array.isArray(row.order_items) ? row.order_items.length : 0,
  };
}

export type OrderFilters = { status?: string; channel?: string; q?: string };

export async function listOrders(
  page: number,
  filters: OrderFilters = {},
): Promise<Paged<OrderRow>> {
  assertServer("listOrders");

  const admin = createAdminClient();

  let query = admin
    .from("orders")
    .select(ORDER_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false });

  if (filters.status === "open") {
    query = query.in("status", OPEN_ORDER_STATUSES as unknown as string[]);
  } else if (filters.status) {
    query = query.eq("status", filters.status);
  } else {
    // An abandoned checkout is not an order. It never appears in this list
    // unless somebody deliberately asks for it by status.
    query = query.neq("status", "pending");
  }

  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.q) {
    const safe = filters.q.replace(/[,()\\*]/g, " ").trim();
    if (safe) query = query.or(`order_number.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const probe = await query.range(0, 0);
  const total = probe.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const from = (safePage - 1) * PAGE_SIZE;

  const { data } = await query.range(from, from + PAGE_SIZE - 1);

  return {
    rows: (data ?? []).map((r) => mapOrderRow(asRow(r))),
    page: safePage,
    pageCount,
    total,
  };
}

/** The queue on the overview: what still needs printing, packing or posting. */
export async function getOpenOrders(limit = 8): Promise<OrderRow[]> {
  assertServer("getOpenOrders");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(ORDER_COLUMNS)
    .in("status", OPEN_ORDER_STATUSES as unknown as string[])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error || !data) return [];
  return data.map((r) => mapOrderRow(asRow(r)));
}

export async function getOrder(id: string): Promise<OrderDetail | null> {
  assertServer("getOrder");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, order_number, email, status, channel, subtotal, shipping, total, " +
        "created_at, shipping_method, tracking_number, gift_note, " +
        "shipping_address, stripe_payment_intent, recorded_by, " +
        "order_items(id, product_id, product_name, variant_label, unit_price, " +
        "quantity, unit_cost_cents, colour, personalisation)",
    )
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const row = asRow(data);
  const items = Array.isArray(row.order_items) ? row.order_items : [];

  return {
    ...mapOrderRow({ ...row, order_items: items }),
    shippingMethod: (row.shipping_method as string) ?? "standard",
    trackingNumber: (row.tracking_number as string | null) ?? null,
    giftNote: (row.gift_note as string | null) ?? null,
    shippingAddress: (row.shipping_address as Record<string, unknown> | null) ?? {},
    stripePaymentIntent: (row.stripe_payment_intent as string | null) ?? null,
    recordedBy: (row.recorded_by as string | null) ?? null,
    lines: items.map((raw) => { const item = asRow(raw); return {
      id: item.id as string,
      productId: (item.product_id as string | null) ?? null,
      productName: (item.product_name as string) ?? "",
      variantLabel: (item.variant_label as string) ?? "",
      unitPrice: Number(item.unit_price ?? 0),
      quantity: Number(item.quantity ?? 0),
      unitCostCents:
        item.unit_cost_cents === null || item.unit_cost_cents === undefined
          ? null
          : Number(item.unit_cost_cents),
      colour: (item.colour as string | null) ?? null,
      personalisation: item.personalisation ?? null,
    }; }),
  };
}

/* ------------------------------------------------------------- reports */

export type ReportPoint = { label: string; orders: number; revenue: number; profit: number };

export type Reports = {
  /** True when there is not a single sale to report on. */
  empty: boolean;
  orderCount: number;
  unitCount: number;
  revenue: number;
  /** Making cost of everything sold, where it was recorded. */
  cost: number;
  /** Null when no line on any order carries a cost — profit is unknowable. */
  profit: number | null;
  /** How many sold lines have no recorded cost, so profit understates spend. */
  linesWithoutCost: number;
  byMonth: ReportPoint[];
  byChannel: { channel: string; orders: number; revenue: number }[];
  topProducts: { name: string; units: number; revenue: number }[];
};

/**
 * The numbers, over real rows only.
 *
 * There is no sample data, no demo month, and no zero-filled axis. A shop that
 * has taken no orders reports `empty: true` and the screen says so. Inventing a
 * plausible-looking chart is not a placeholder, it is a false statement that
 * somebody eventually makes a decision on.
 *
 * The Finance sheet — the loan account, tax, the split — stays in the workbook
 * on purpose. That is a monthly sit-down with real judgement in it, not a
 * dashboard tile.
 */
export async function getReports(): Promise<Reports> {
  assertServer("getReports");

  const admin = createAdminClient();
  const settings = await getSettings();

  const { data } = await admin
    .from("orders")
    .select(
      "id, status, channel, total, subtotal, created_at, " +
        "order_items(product_name, quantity, unit_price, unit_cost_cents)",
    )
    .in("status", SOLD_STATUSES as unknown as string[])
    .order("created_at", { ascending: true });

  const orders = data ?? [];

  if (orders.length === 0) {
    return {
      empty: true,
      orderCount: 0,
      unitCount: 0,
      revenue: 0,
      cost: 0,
      profit: null,
      linesWithoutCost: 0,
      byMonth: [],
      byChannel: [],
      topProducts: [],
    };
  }

  const monthFmt = new Intl.DateTimeFormat("en-AU", { month: "short", year: "numeric" });

  const months = new Map<string, ReportPoint>();
  const channels = new Map<string, { orders: number; revenue: number }>();
  const products = new Map<string, { units: number; revenue: number }>();

  let revenue = 0;
  let cost = 0;
  let units = 0;
  let linesWithoutCost = 0;
  let anyCost = false;

  for (const raw of orders) {
    const order = asRow(raw);
    const total = Number(order.total ?? 0);
    revenue += total;

    const items = Array.isArray(order.order_items) ? order.order_items : [];
    let orderCost = 0;
    for (const raw of items) {
      const item = asRow(raw);
      const qty = Number(item.quantity ?? 0);
      units += qty;

      const name = (item.product_name as string) ?? "—";
      const p = products.get(name) ?? { units: 0, revenue: 0 };
      p.units += qty;
      p.revenue += qty * Number(item.unit_price ?? 0);
      products.set(name, p);

      if (item.unit_cost_cents === null || item.unit_cost_cents === undefined) {
        linesWithoutCost += 1;
      } else {
        anyCost = true;
        orderCost += qty * Number(item.unit_cost_cents);
      }
    }
    cost += orderCost;

    const when = new Date(order.created_at as string);
    const key = monthFmt.format(when);
    const point = months.get(key) ?? { label: key, orders: 0, revenue: 0, profit: 0 };
    point.orders += 1;
    point.revenue += total;
    point.profit += total * (1 - settings.cardFeeRate) - orderCost;
    months.set(key, point);

    const channel = (order.channel as string) ?? "website";
    const c = channels.get(channel) ?? { orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue += total;
    channels.set(channel, c);
  }

  return {
    empty: false,
    orderCount: orders.length,
    unitCount: units,
    revenue,
    cost,
    // The workbook's trading profit: revenue less the card fee less making
    // cost. Null when nothing carries a cost — a "profit" equal to revenue
    // minus a fee is not a profit, it is a missing subtraction.
    profit: anyCost ? revenue * (1 - settings.cardFeeRate) - cost : null,
    linesWithoutCost,
    byMonth: [...months.values()],
    byChannel: [...channels.entries()]
      .map(([channel, v]) => ({ channel, ...v }))
      .sort((a, b) => b.revenue - a.revenue),
    topProducts: [...products.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 10),
  };
}

/* --------------------------------------------------------------- staff */

export type StaffRow = {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Derived, so the screen never has to work out three timestamps itself. */
  state: "pending" | "accepted" | "revoked" | "expired";
};

export async function listStaff(): Promise<StaffRow[]> {
  assertServer("listStaff");

  const admin = createAdminClient();
  const { data } = await admin
    .from("staff")
    .select("user_id, role, created_at")
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // Emails live in auth.users, which PostgREST does not expose. The admin auth
  // API is the only way to them, and it pages — so ask for one page big enough
  // for a studio and map what comes back.
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  return rows.map((row) => ({
    userId: row.user_id as string,
    email: emails.get(row.user_id as string) ?? "(unknown account)",
    role: row.role as string,
    createdAt: row.created_at as string,
  }));
}

export async function listInvitations(): Promise<InvitationRow[]> {
  assertServer("listInvitations");

  const admin = createAdminClient();
  const { data } = await admin
    .from("staff_invitations")
    .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
    .order("created_at", { ascending: false });

  const now = Date.now();
  return (data ?? []).map((row) => {
    const acceptedAt = (row.accepted_at as string | null) ?? null;
    const revokedAt = (row.revoked_at as string | null) ?? null;
    const expiresAt = row.expires_at as string;

    const state: InvitationRow["state"] = acceptedAt
      ? "accepted"
      : revokedAt
        ? "revoked"
        : new Date(expiresAt).getTime() < now
          ? "expired"
          : "pending";

    return {
      id: row.id as string,
      email: row.email as string,
      role: row.role as string,
      expiresAt,
      acceptedAt,
      revokedAt,
      createdAt: row.created_at as string,
      state,
    };
  });
}

/* ------------------------------------------------------------ overview */

export type StudioSummary = {
  productCount: number;
  colourCount: number;
  activeColourCount: number;
  /** Pieces short of the buffer, across the whole catalogue. */
  toPrint: number;
  rollsToBuy: number;
  ordersNeedingWork: number;
  /** Products with no print time or no filament recipe — cost unknowable. */
  unmeasured: number;
  /** True when the shop has never taken an order — a real state, not an error. */
  noOrdersYet: boolean;
};

export async function getStudioSummary(): Promise<StudioSummary> {
  assertServer("getStudioSummary");

  const admin = createAdminClient();

  const [products, colours, activeColours, openOrders, anyOrder, inventory] =
    await Promise.all([
      admin.from("products").select("id", { count: "exact", head: true }),
      admin.from("colours").select("id", { count: "exact", head: true }),
      admin
        .from("colours")
        .select("id", { count: "exact", head: true })
        .eq("active", true),
      admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .in("status", OPEN_ORDER_STATUSES as unknown as string[]),
      admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .neq("status", "pending"),
      getInventory(),
    ]);

  return {
    productCount: products.count ?? 0,
    colourCount: colours.count ?? 0,
    activeColourCount: activeColours.count ?? 0,
    toPrint: inventory.totalToPrint,
    rollsToBuy: inventory.totalRollsToBuy,
    ordersNeedingWork: openOrders.count ?? 0,
    unmeasured: inventory.unmeasured,
    noOrdersYet: (anyOrder.count ?? 0) === 0,
  };
}
