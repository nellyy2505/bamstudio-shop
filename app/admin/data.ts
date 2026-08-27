import { createAdminClient } from "@/lib/supabase/server";
import {
  suggestedPrice,
  toPrint,
  unitCost,
  type CostBreakdown,
  type CostSettings,
} from "@/lib/costing";
/*
 * The cost basis lives in lib/, not here.
 *
 * `unitCostsAtSale()` is imported by /api/checkout and /api/webhooks/stripe as
 * a sale is recorded, and two customer-facing routes must not depend on the
 * staff area to know what a piece cost. It took the settings and accessory
 * reads it is built on down with it, so there is one copy of each rather than
 * two. They are re-exported below because the studio screens have always
 * imported them from this module and nothing about where they live changes what
 * they answer.
 */
import { getSettings, unitCostsAtSale, type Accessory } from "@/lib/cost-basis";
import {
  activationBlockers,
  packCost,
  packPieceCount,
  scoopCostBasis,
  suggestedTierPrice,
  tierAvailability,
  type ScoopAvailability,
  type ScoopCostBasis,
} from "@/lib/scoop";
import type { ScoopTheme } from "@/lib/types";
import { SERVICE_CODES } from "@/lib/shipping/quote";
import { isEmailConfigured } from "@/lib/email";

export {
  getAccessories,
  getSettings,
  unitCostsAtSale,
  type Accessory,
  type Settings,
} from "@/lib/cost-basis";

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
  /**
   * Units sold that the ready-to-ship buffer did not have.
   *
   * A running total, never decremented automatically (0005_sale_integrity.sql).
   * The shop prints to order, so an oversell is allowed and is not an error —
   * it is somebody who has already paid, waiting for a piece that was not on
   * the shelf. That makes it a print-this-first signal, which is why the
   * inventory screen reads it.
   */
  oversoldUnits: number;
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
  "accessory_id, photos, art, tint, oversold_units, " +
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
    // `not null default 0` in the schema, so a 0 here is a real count and not
    // a stand-in for an absent one.
    oversoldUnits: Number(row.oversold_units ?? 0),
  };
}

/* --------------------------------------------------------- measuring up */

/**
 * How many colour slots the measuring screen offers on one row.
 *
 * The workbook's Products sheet has four fixed Colour/g pairs, so four is the
 * most any real piece in this catalogue uses. `product_filament` deliberately
 * has no such ceiling (see 0003_admin.sql) — rows, not columns — and a piece
 * that outgrows four is still perfectly legal. The measuring screen simply
 * refuses to edit one, and sends the person to the full product form instead,
 * rather than quietly writing back the four it could see and dropping the rest.
 *
 * Here rather than in actions.ts because every export from a "use server" file
 * has to be an async function; a number cannot be one.
 */
export const MEASURE_COLOUR_SLOTS = 4;

/**
 * Which costing inputs a product is still missing, in words.
 *
 * The same two strings, in the same order, as `unitCost()`'s `missing` in
 * lib/costing.ts — that function decides whether a cost is `unknown`, and this
 * one decides whether a product appears on the measuring screen. They are two
 * readings of one fact and must move together. It is spelled out again here
 * rather than derived from `unitCost()` because `unitCost()` needs a settings
 * row it has no use for, and a screen should not have to load the costing
 * constants to ask "has anybody measured this yet".
 *
 * Note what is NOT here: a zero. A print time of 0 or a recipe totalling 0 g
 * would both read as measured, which is why `optionalNumber()` in actions.ts
 * keeps blank as null all the way to the column and why a grams field with no
 * colour beside it is refused rather than rounded down to nothing.
 */
export function missingCostInputs(
  product: Pick<ProductRow, "printTimeHours" | "totalGrams">,
): string[] {
  const missing: string[] = [];
  if (product.printTimeHours === null) missing.push("print time");
  if (product.totalGrams === null) missing.push("filament weight");
  return missing;
}

export type MeasureRow = {
  product: ProductRow;
  /** Empty when the product has both a print time and a filament recipe. */
  missing: string[];
};

export type MeasureQueue = {
  rows: MeasureRow[];
  /** Every product in the catalogue, measured or not. */
  total: number;
  measured: number;
  unmeasured: number;
};

/**
 * The whole catalogue, ordered by SKU, marked with what each product is missing.
 *
 * Deliberately unpaged, and it is the one table in the studio that is. The job
 * this feeds is "sit down and measure forty-four things", and a pager turns
 * that into "measure twenty-five things, then notice there is a page two". The
 * count is bounded by the catalogue — forty-four rows today — so the cost of
 * reading all of it is a fraction of the cost of the person's evening. If the
 * catalogue ever grows past a few hundred, use `Pagination` from components/ui
 * like every other table here; do not grow a second pager.
 */
export async function getMeasureQueue(includeMeasured: boolean): Promise<MeasureQueue> {
  assertServer("getMeasureQueue");

  const admin = createAdminClient();
  const { data } = await admin
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("sku", { ascending: true });

  const all: MeasureRow[] = (data ?? [])
    .map((r) => mapProductRow(asRow(r)))
    .map((product) => ({ product, missing: missingCostInputs(product) }));

  const unmeasured = all.filter((r) => r.missing.length > 0);

  return {
    rows: includeMeasured ? all : unmeasured,
    total: all.length,
    measured: all.length - unmeasured.length,
    unmeasured: unmeasured.length,
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

/** A product carrying an unprinted oversell, for a screen to name. */
export type OversoldProduct = { id: string; name: string; units: number };

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
  /**
   * Units sold that the shelf did not have, across the whole catalogue.
   *
   * 0 is a real answer — nothing has been oversold — and must be rendered as
   * "nothing to report", never as a figure.
   */
  oversoldUnits: number;
  /**
   * Oversold products the print queue does not list.
   *
   * `rows` only carries products with something to print, so a piece that was
   * oversold and has since been printed and counted back up drops out of it
   * while its counter is still standing. Nothing decrements `oversold_units`
   * automatically (0005_sale_integrity.sql), so those would otherwise vanish
   * from the one screen that is meant to show them.
   */
  oversoldOffQueue: OversoldProduct[];
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

  /*
   * Oversold first, then by how much there is to print.
   *
   * This is the one ordering change the oversell counter earns. An oversold
   * piece is not "more to print" — it is somebody who has already paid and is
   * waiting for a piece that was not on the shelf when they bought it, so it
   * outranks a product that is merely below its buffer however large the gap.
   * Within each group the old rule stands, so the queue reads the same way it
   * always did on a day when nothing has been oversold.
   */
  const queue = rows
    .filter((r) => r.toPrint > 0)
    .sort(
      (a, b) =>
        b.product.oversoldUnits - a.product.oversoldUnits ||
        b.toPrint - a.toPrint,
    );

  const queued = new Set(queue.map((r) => r.product.id));

  return {
    rows: queue,
    filament,
    totalToPrint: rows.reduce((s, r) => s + r.toPrint, 0),
    totalRollsToBuy: filament.reduce((s, f) => s + f.rollsToBuy, 0),
    totalBuyCostCents: filament.reduce((s, f) => s + f.costToBuyCents, 0),
    unmeasured: products.filter((p) => p.totalGrams === null).length,
    oversoldUnits: products.reduce((s, p) => s + p.oversoldUnits, 0),
    oversoldOffQueue: products
      .filter((p) => p.oversoldUnits > 0 && !queued.has(p.id))
      .sort((a, b) => b.oversoldUnits - a.oversoldUnits)
      .map((p) => ({ id: p.id, name: p.name, units: p.oversoldUnits })),
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
  /**
   * The Australia Post service the postage on this order was quoted for, e.g.
   * `AUS_PARCEL_REGULAR`. Null for orders taken before postage was quoted, and
   * for a sale typed in at a market — `0002_shipping.sql` says a null here
   * means "flat-rate era", not "missing data".
   */
  quotedServiceCode: string | null;
  /**
   * Whether the customer was *sold* tracking: true for a parcel service, false
   * for a Large Letter, **null when we cannot tell**. See `wasSoldTracked`.
   */
  soldAsTracked: boolean | null;
  lines: OrderLine[];
  /**
   * Open payment incidents recorded against this order — money the shop has
   * taken and owes back.
   *
   * Today there is one kind: a payment that cleared for an order somebody had
   * already cancelled (0005_sale_integrity.sql). It showed on the studio
   * overview and nowhere else, so the order itself — the screen a person is
   * looking at when they decide whether to print and post it — said nothing
   * about the fact that it was paid for and must not be fulfilled.
   *
   * An array rather than one row: `payment_incidents` is keyed on the Stripe
   * session, and one order can be paid for through more than one session.
   * Empty is the ordinary case.
   */
  openIncidents: PaymentIncident[];
};

/**
 * Was this order's postage sold as a tracked service?
 *
 * `lib/shipping/quote.ts` owns the real mapping (its private `TRACKED` table)
 * and defaults an unrecognised code to `true`, which is the right way round
 * when the answer is feeding a *price*. It is the wrong way round here: this
 * answer decides what the dispatch screen tells the person packing to expect,
 * and guessing "tracked" would have her hunting for a number that was never
 * going to exist. So an unknown code is `null` — Unknown — and the screen says
 * so instead of choosing for her.
 *
 * Keyed off the exported `SERVICE_CODES` rather than the literal strings, so a
 * renamed code is a compile error here rather than a silent "unknown" on every
 * order.
 */
export function wasSoldTracked(serviceCode: string | null): boolean | null {
  switch (serviceCode) {
    case SERVICE_CODES.parcelRegular:
    case SERVICE_CODES.parcelExpress:
      return true;
    case SERVICE_CODES.letterLarge125:
    case SERVICE_CODES.letterLarge250:
    case SERVICE_CODES.letterLarge500:
      // A regular Large Letter carries no tracking. Free standard post on a
      // light basket goes this way, so "no number at all" is a real, correct
      // outcome for a real order — not a gap someone forgot to fill in.
      return false;
    default:
      return null;
  }
}

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
  // Two reads, not an embed: `payment_incidents.order_id` is nullable and set
  // null if the order is ever removed, so it is a fact about a *payment* that
  // happens to point here — not a child of the order. Read alongside rather
  // than nested, so a failure to read incidents cannot lose the order.
  const [{ data, error }, incidents] = await Promise.all([
    admin
      .from("orders")
      .select(
        "id, order_number, email, status, channel, subtotal, shipping, total, " +
          "created_at, shipping_method, tracking_number, quoted_service_code, " +
          "gift_note, shipping_address, stripe_payment_intent, recorded_by, " +
          "order_items(id, product_id, product_name, variant_label, unit_price, " +
          "quantity, unit_cost_cents, colour, personalisation)",
      )
      .eq("id", id)
      .maybeSingle(),
    admin
      .from("payment_incidents")
      .select(
        "id, order_id, stripe_session_id, amount_cents, order_status, detail, noticed_at",
      )
      .eq("order_id", id)
      .is("resolved_at", null)
      .order("noticed_at", { ascending: false }),
  ]);

  if (error || !data) return null;

  const row = asRow(data);
  const items = Array.isArray(row.order_items) ? row.order_items : [];
  const quotedServiceCode = (row.quoted_service_code as string | null) ?? null;

  return {
    ...mapOrderRow({ ...row, order_items: items }),
    shippingMethod: (row.shipping_method as string) ?? "standard",
    trackingNumber: (row.tracking_number as string | null) ?? null,
    quotedServiceCode,
    soldAsTracked: wasSoldTracked(quotedServiceCode),
    giftNote: (row.gift_note as string | null) ?? null,
    shippingAddress: (row.shipping_address as Record<string, unknown> | null) ?? {},
    stripePaymentIntent: (row.stripe_payment_intent as string | null) ?? null,
    recordedBy: (row.recorded_by as string | null) ?? null,
    openIncidents: (incidents.data ?? []).map((incident) => ({
      id: incident.id as string,
      orderId: (incident.order_id as string | null) ?? null,
      stripeSessionId: incident.stripe_session_id as string,
      amountCents: Number(incident.amount_cents ?? 0),
      orderStatus: (incident.order_status as string | null) ?? null,
      detail: (incident.detail as string | null) ?? null,
      noticedAt: incident.noticed_at as string,
    })),
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
  /**
   * Products with no filament recipe — invisible to the buy list.
   *
   * This is `Inventory.unmeasured`, which counts a missing recipe and nothing
   * else, because that is the one that makes the buy list wrong. The comment
   * here used to say "no print time or no filament recipe", which is the wider
   * costing question `missingCostInputs()` answers and a different number.
   */
  unmeasured: number;
  /** True when the shop has never taken an order — a real state, not an error. */
  noOrdersYet: boolean;
};

/** A payment that took money the shop cannot honour, still awaiting a refund. */
export type PaymentIncident = {
  id: string;
  orderId: string | null;
  stripeSessionId: string;
  amountCents: number;
  orderStatus: string | null;
  detail: string | null;
  noticedAt: string;
};

/**
 * The three things on the overview that mean somebody has been charged, or
 * somebody has been left waiting, and only a person can put it right.
 *
 * All three used to be invisible. A payment landing on a cancelled order was a
 * `console.error` on a platform log nobody reads. A confirmation email that
 * never went out left no trace anywhere. An oversell was clamped to zero and
 * never mentioned. None of them can be fixed by code; all of them have to be
 * seen.
 */
export type StudioAttention = {
  /** Money the shop owes back. Manual refunds, but she finds out. */
  refundsOwed: PaymentIncident[];
  /**
   * Whether this deployment can send email at all, read from the one predicate
   * that decides it. On a shop with no mail provider the count below is
   * meaningless — silence is expected, every page already says no order email
   * is coming — so the overview says nothing rather than reporting every order
   * as overdue.
   */
  emailConfigured: boolean;
  /** Paid, numbered website orders with no confirmation email recorded. */
  ordersAwaitingConfirmation: number;
  /** Units sold that the ready-to-ship buffer did not have — print these first. */
  oversoldUnits: number;
  oversoldProducts: { id: string; name: string; units: number }[];
};

export async function getStudioAttention(): Promise<StudioAttention> {
  assertServer("getStudioAttention");

  const admin = createAdminClient();
  // Read once, here, from lib/email's own predicate. Mirroring "can this shop
  // send" into a column or a second boolean is how the claim and the capability
  // drift apart.
  const emailConfigured = isEmailConfigured();

  const [incidents, awaiting, oversold] = await Promise.all([
    admin
      .from("payment_incidents")
      .select(
        "id, order_id, stripe_session_id, amount_cents, order_status, detail, noticed_at",
      )
      .is("resolved_at", null)
      .order("noticed_at", { ascending: false })
      .limit(20),
    emailConfigured
      ? admin
          .from("orders")
          .select("id", { count: "exact", head: true })
          // Website orders only: a sale typed in at a market never had a
          // confirmation email to send, so counting those would report a
          // backlog that does not exist.
          .eq("channel", "website")
          .not("order_number", "is", null)
          .is("confirmation_email_sent_at", null)
          .not("status", "in", '("pending","cancelled")')
      : Promise.resolve({ count: 0 }),
    admin
      .from("products")
      .select("id, name, oversold_units")
      .gt("oversold_units", 0)
      .order("oversold_units", { ascending: false })
      .limit(10),
  ]);

  const oversoldProducts = (oversold.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    units: Number(row.oversold_units ?? 0),
  }));

  return {
    refundsOwed: (incidents.data ?? []).map((row) => ({
      id: row.id as string,
      orderId: (row.order_id as string | null) ?? null,
      stripeSessionId: row.stripe_session_id as string,
      amountCents: Number(row.amount_cents ?? 0),
      orderStatus: (row.order_status as string | null) ?? null,
      detail: (row.detail as string | null) ?? null,
      noticedAt: row.noticed_at as string,
    })),
    emailConfigured,
    ordersAwaitingConfirmation: awaiting.count ?? 0,
    oversoldUnits: oversoldProducts.reduce((sum, p) => sum + p.units, 0),
    oversoldProducts,
  };
}

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

/* --------------------------------------------------------- lucky scoop */

/** One product in a tier's pool, as the studio needs to see it. */
export type ScoopPoolProduct = {
  productId: string;
  sku: string;
  name: string;
  /**
   * `products.active`. A retired product stays in the pool — deleting it is
   * refused (0007_lucky_scoop.sql) so that a tier's promise cannot silently
   * shrink — so the studio has to be able to see that it is no longer drawable.
   */
  active: boolean;
  stockOnHand: number;
  /**
   * What one costs to make right now, in whole cents, or null when nobody has
   * measured it. Same definition and same source as the cost stamped on a sale
   * (`unitCostsAtSale`), so the suggestion below and the margin on a packed
   * scoop are computed from one number rather than two.
   */
  unitCostCents: number | null;
};

/**
 * A tier with everything the studio's tier screen shows: its pool, whether the
 * pool can fill it today, whether it could be activated at all, and what it
 * might be worth.
 */
export type ScoopTierRow = {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  theme: ScoopTheme;
  pieceCount: number;
  priceCents: number | null;
  packedWeightGrams: number | null;
  packedThicknessMm: number | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  pool: ScoopPoolProduct[];
  /** Stock-aware: can this be sold right now, and how many scoops are in it. */
  availability: ScoopAvailability;
  /**
   * Why the database would refuse to switch this tier on, in words. Empty when
   * it would be allowed. Deliberately about the pool's SIZE rather than its
   * stock — a tier is not un-activated by selling out.
   */
  activationBlockers: string[];
  /** How much of the pool has ever been costed. */
  costBasis: ScoopCostBasis;
  /**
   * A suggestion for the price field, never a value written into it — the same
   * rule `costProduct()` follows for a product.
   *
   * NULL until every product in the pool has been measured, which today is
   * every pool: 0 of 44 products have a cost. That null is the honest answer,
   * and `costBasis` is what the screen shows instead ("3 of 12 pieces
   * measured"). See lib/scoop.ts for why a partial average is refused.
   */
  suggestedPriceCents: number | null;
};

const SCOOP_TIER_COLUMNS =
  "id, slug, name, blurb, theme, piece_count, price_cents, " +
  "packed_weight_grams, packed_thickness_mm, sort_order, active, created_at, " +
  "scoop_tier_products(products(id, sku, name, active, stock_on_hand))";

type ScoopPoolJoin = {
  products:
    | { id: string; sku: string; name: string; active: boolean; stock_on_hand: number }
    | { id: string; sku: string; name: string; active: boolean; stock_on_hand: number }[]
    | null;
};

function mapScoopTier(
  row: Record<string, unknown>,
  settings: CostSettings,
  costs: Map<string, number | null>,
): ScoopTierRow {
  const pool: ScoopPoolProduct[] = ((row.scoop_tier_products ?? []) as ScoopPoolJoin[])
    .flatMap((entry) => {
      const product = Array.isArray(entry.products) ? entry.products[0] : entry.products;
      return product ? [product] : [];
    })
    .map((product) => ({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      active: Boolean(product.active),
      stockOnHand: Number(product.stock_on_hand ?? 0),
      // `?? null` rather than `?? 0`: an id the cost read did not answer for is
      // an unmeasured product, and a 0 there would make the pool look costed.
      unitCostCents: costs.get(product.id) ?? null,
    }));

  const pieceCount = Number(row.piece_count ?? 0);
  const priceCents = row.price_cents === null || row.price_cents === undefined
    ? null
    : Number(row.price_cents);
  const packedWeightGrams =
    row.packed_weight_grams === null || row.packed_weight_grams === undefined
      ? null
      : Number(row.packed_weight_grams);

  const rules = {
    pieceCount,
    priceCents,
    packedWeightGrams,
    active: Boolean(row.active),
  };

  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    blurb: (row.blurb as string) ?? "",
    theme: (row.theme as ScoopTheme) ?? "mixed",
    pieceCount,
    priceCents,
    packedWeightGrams,
    packedThicknessMm:
      row.packed_thickness_mm === null || row.packed_thickness_mm === undefined
        ? null
        : Number(row.packed_thickness_mm),
    sortOrder: Number(row.sort_order ?? 0),
    active: Boolean(row.active),
    createdAt: row.created_at as string,
    pool,
    availability: tierAvailability(rules, pool),
    activationBlockers: activationBlockers(rules, pool.length),
    costBasis: scoopCostBasis(pool, pieceCount),
    suggestedPriceCents: suggestedTierPrice(settings, pool, pieceCount),
  };
}

/**
 * Every scoop tier, drafts included, in the order the studio sorted them.
 *
 * Unpaged for the reason `getMeasureQueue` is: there will be a handful of
 * tiers, not a catalogue, and a pager over four rows is a pager that hides one
 * of them. One settings read, one cost read and one query for all of it — not
 * one per tier.
 */
export async function listScoopTiers(): Promise<ScoopTierRow[]> {
  assertServer("listScoopTiers");

  const admin = createAdminClient();
  const [{ data, error }, settings] = await Promise.all([
    admin.from("scoop_tiers").select(SCOOP_TIER_COLUMNS).order("sort_order", {
      ascending: true,
    }),
    getSettings(),
  ]);

  if (error || !data) return [];

  const rows = data.map((row) => asRow(row));
  const productIds = rows.flatMap((row) =>
    ((row.scoop_tier_products ?? []) as ScoopPoolJoin[]).flatMap((entry) => {
      const product = Array.isArray(entry.products) ? entry.products[0] : entry.products;
      return product ? [product.id] : [];
    }),
  );

  const costs = await unitCostsAtSale(productIds);
  return rows.map((row) => mapScoopTier(row, settings, costs));
}

/** One tier by id, drafts included. Null when there is no such tier. */
export async function getScoopTier(id: string): Promise<ScoopTierRow | null> {
  assertServer("getScoopTier");
  if (!id) return null;

  const admin = createAdminClient();
  const [{ data, error }, settings] = await Promise.all([
    admin.from("scoop_tiers").select(SCOOP_TIER_COLUMNS).eq("id", id).maybeSingle(),
    getSettings(),
  ]);

  if (error || !data) return null;

  const row = asRow(data);
  const productIds = ((row.scoop_tier_products ?? []) as ScoopPoolJoin[]).flatMap(
    (entry) => {
      const product = Array.isArray(entry.products) ? entry.products[0] : entry.products;
      return product ? [product.id] : [];
    },
  );

  const costs = await unitCostsAtSale(productIds);
  return mapScoopTier(row, settings, costs);
}

/**
 * Every product a tier's pool could be built from, with the two facts the
 * owner is actually deciding on: what one costs to make, and how many are on
 * the shelf.
 *
 * ONE ROW PER PRODUCT, AND NOT A `ProductRow`. The picker on the tier screen
 * renders all forty-four of these at once, so what it is handed matters: a
 * `ProductRow` carries the gallery, the colour list, the attachments, the
 * description and the photographs, none of which a checkbox needs, and the
 * measure screen's own defect (round 14 — 1.2 MB of HTML because every row
 * shipped a whole palette) is what a fat picker turns into here. Six columns
 * and one cost lookup.
 *
 * Retired products are included on purpose: a pool row survives its product
 * being switched off (deleting the product is refused, 0007), so the picker has
 * to be able to show and un-tick one. `active` is what says it is no longer
 * drawable.
 */
export type PoolCandidate = ScoopPoolProduct & { category: string };

export async function listPoolCandidates(): Promise<PoolCandidate[]> {
  assertServer("listPoolCandidates");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select("id, sku, name, category, active, stock_on_hand")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error || !data) return [];

  const rows = data.map((row) => asRow(row));
  const costs = await unitCostsAtSale(rows.map((row) => row.id as string));

  return rows.map((row) => ({
    productId: row.id as string,
    sku: (row.sku as string) ?? "",
    name: (row.name as string) ?? "",
    category: (row.category as string) ?? "",
    active: Boolean(row.active),
    stockOnHand: Number(row.stock_on_hand ?? 0),
    // `?? null`, never `?? 0`: an id the cost read did not answer for has never
    // been measured, and a zero there makes an unmeasured pool look costed.
    unitCostCents: costs.get(row.id as string) ?? null,
  }));
}

/* ------------------------------------------------- scoops on one order */

/** One piece recorded as having gone into a scoop — a `scoop_pack_items` row. */
export type ScoopPackPieceRow = {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  /**
   * What one cost AT THE MOMENT IT WAS PACKED, read off the stamped column and
   * never recomputed. A cost derived at read time rewrites every historical
   * margin the next time filament changes price — the reason
   * `order_items.unit_cost_cents` exists (0003) and the reason this column does
   * (0007). Null for a piece nobody had measured when it was packed.
   */
  unitCostCents: number | null;
  /** The product is not in this tier's pool today. A fact, not a violation. */
  offPool: boolean;
};

/**
 * One physical scoop: either what was recorded, or the empty slot where a
 * recording is still owed.
 *
 * A line of quantity 2 is two of these — two draws, two videos, two bags — and
 * `packIndex` numbers them, which is what makes saving the panel twice produce
 * one record rather than two (the unique constraint on
 * `order_item_id, pack_index`).
 */
export type ScoopPackRow = {
  /** Null when nothing has been recorded for this scoop yet. */
  id: string | null;
  packIndex: number;
  /**
   * The pieces promised. Copied onto the pack when it is recorded, so it is the
   * promise as it stood then; for a scoop not yet recorded there is nothing to
   * read but the tier's count as it is today.
   */
  pieceCount: number;
  /** True once the stock for this scoop has come off. The claim flag. */
  stockApplied: boolean;
  videoUrl: string | null;
  note: string | null;
  packedAt: string | null;
  items: ScoopPackPieceRow[];
  /** Pieces actually recorded, so a short pack can be seen. */
  recordedPieces: number;
  /**
   * What this scoop cost to make — the sum of its pieces, or null the moment
   * one of them was never measured. `packCost()` in lib/scoop.ts, never a
   * partial sum.
   */
  costCents: number | null;
};

/** One scoop line on an order, with its tier, its pool and its packs. */
export type OrderScoopLine = {
  orderItemId: string;
  tierId: string;
  tierName: string;
  /** How many scoops this line sold. Each one is a separate draw. */
  quantity: number;
  /** The tier's piece count as it stands today. */
  pieceCount: number;
  /** What may be drawn into it, with cost and shelf stock. */
  pool: ScoopPoolProduct[];
  /** Exactly `quantity` entries, recorded or not, in pack_index order. */
  packs: ScoopPackRow[];
};

export type OrderScoops = {
  lines: OrderScoopLine[];
  /**
   * Scoops on this order whose contents nobody has recorded yet, in words.
   * Empty when there is nothing outstanding — including on an order with no
   * scoops on it at all.
   */
  outstanding: string[];
  /**
   * The read itself failed, so `outstanding` is not a statement about this
   * order. Callers that use this to REFUSE something must refuse on this too:
   * "we could not check" is not "there is nothing to check".
   */
  unreadable: boolean;
};

const ORDER_SCOOP_COLUMNS =
  "id, product_name, quantity, scoop_tier_id, " +
  "scoop_tiers(name, piece_count, " +
  "scoop_tier_products(products(id, sku, name, active, stock_on_hand))), " +
  "scoop_packs(id, pack_index, piece_count, stock_applied, video_url, note, " +
  "packed_at, scoop_pack_items(product_id, quantity, unit_cost_cents, " +
  "products(sku, name)))";

/** PostgREST answers a to-one embed as an object or, sometimes, a one-element array. */
function embedded<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

/**
 * The Lucky Scoop lines on one order, and what is still owed on them.
 *
 * ONE DEFINITION OF "RECORDED", used by both the pack panel and the guard in
 * `markShipped`. Two would be one too many: a panel that says the order is
 * ready and an action that refuses to post it disagree about the same fact, and
 * the person in the middle has no way to tell which is right.
 *
 * A scoop counts as recorded when it has at least one piece against it. Not
 * "the promised number of pieces" — a short pack is a real thing that happens
 * (a charm broke, the last one was already gone) and refusing to post the
 * parcel over it would be the schema deciding something only she can. The panel
 * shows the count beside the promise so a genuinely short pack is visible.
 */
export async function getOrderScoops(orderId: string): Promise<OrderScoops> {
  assertServer("getOrderScoops");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("order_items")
    .select(ORDER_SCOOP_COLUMNS)
    .eq("order_id", orderId)
    .not("scoop_tier_id", "is", null);

  // Fails closed. An unreadable table is not an order with no scoops on it, and
  // the difference decides whether a parcel may be posted.
  if (error) return { lines: [], outstanding: [], unreadable: true };
  if (!data) return { lines: [], outstanding: [], unreadable: false };

  const lines: OrderScoopLine[] = data.map((raw) => {
    const item = asRow(raw);
    const tier = embedded<Record<string, unknown>>(item.scoop_tiers);
    const tierName =
      (tier?.name as string) || (item.product_name as string) || "Lucky Scoop";
    const pieceCount = Number(tier?.piece_count ?? 0);

    const pool: ScoopPoolProduct[] = ((tier?.scoop_tier_products ?? []) as unknown[])
      .flatMap((entry) => {
        const product = embedded<Record<string, unknown>>(asRow(entry).products);
        return product ? [product] : [];
      })
      .map((product) => ({
        productId: product.id as string,
        sku: (product.sku as string) ?? "",
        name: (product.name as string) ?? "",
        active: Boolean(product.active),
        stockOnHand: Number(product.stock_on_hand ?? 0),
        // The pool's costs are filled in below, in one lookup for the whole
        // order rather than one per line.
        unitCostCents: null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const inPool = new Set(pool.map((piece) => piece.productId));

    const recorded = new Map<number, ScoopPackRow>();
    for (const rawPack of (item.scoop_packs ?? []) as unknown[]) {
      const pack = asRow(rawPack);
      const items: ScoopPackPieceRow[] = ((pack.scoop_pack_items ?? []) as unknown[]).map(
        (rawPiece) => {
          const piece = asRow(rawPiece);
          const product = embedded<Record<string, unknown>>(piece.products);
          const productId = piece.product_id as string;
          return {
            productId,
            sku: (product?.sku as string) ?? "",
            name: (product?.name as string) ?? "This product has been removed",
            quantity: Number(piece.quantity ?? 0),
            unitCostCents:
              piece.unit_cost_cents === null || piece.unit_cost_cents === undefined
                ? null
                : Number(piece.unit_cost_cents),
            offPool: !inPool.has(productId),
          };
        },
      );

      const packIndex = Number(pack.pack_index ?? 1);
      recorded.set(packIndex, {
        id: pack.id as string,
        packIndex,
        pieceCount: Number(pack.piece_count ?? pieceCount),
        stockApplied: Boolean(pack.stock_applied),
        videoUrl: (pack.video_url as string | null) ?? null,
        note: (pack.note as string | null) ?? null,
        packedAt: (pack.packed_at as string | null) ?? null,
        items,
        recordedPieces: packPieceCount(items),
        costCents: packCost(items),
      });
    }

    const quantity = Math.max(1, Number(item.quantity ?? 1));
    /*
     * Never fewer slots than there are recorded packs. The line's quantity is
     * what the customer bought and is normally the answer, but a row edited by
     * hand — a quantity corrected downwards after a scoop was already packed —
     * would otherwise hide a real record and report it as still owed.
     */
    const slots = Math.max(quantity, ...[...recorded.keys()], 1);
    const packs: ScoopPackRow[] = Array.from({ length: slots }, (_, i) => {
      const index = i + 1;
      return (
        recorded.get(index) ?? {
          id: null,
          packIndex: index,
          pieceCount,
          stockApplied: false,
          videoUrl: null,
          note: null,
          packedAt: null,
          items: [],
          recordedPieces: 0,
          costCents: null,
        }
      );
    });

    return {
      orderItemId: item.id as string,
      tierId: (item.scoop_tier_id as string) ?? "",
      tierName,
      quantity,
      pieceCount,
      pool,
      packs,
    };
  });

  // One cost read for every pool product across the whole order, not one per
  // line — the same rule `listScoopTiers` follows.
  const costs = await unitCostsAtSale(
    lines.flatMap((line) => line.pool.map((piece) => piece.productId)),
  );
  for (const line of lines) {
    for (const piece of line.pool) {
      piece.unitCostCents = costs.get(piece.productId) ?? null;
    }
  }

  const outstanding: string[] = [];
  for (const line of lines) {
    for (const pack of line.packs) {
      if (pack.recordedPieces === 0) {
        outstanding.push(
          line.packs.length > 1
            ? `${line.tierName} — scoop ${pack.packIndex} of ${line.packs.length}`
            : line.tierName,
        );
      }
    }
  }

  return { lines, outstanding, unreadable: false };
}
