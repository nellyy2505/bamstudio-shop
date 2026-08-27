import { createAdminClient, createClient } from "@/lib/supabase/server";
import type {
  Collection,
  Product,
  Review,
  ScoopTier,
  ScoopTierWithPool,
} from "@/lib/types";
import { tierAvailability, type ScoopAvailability } from "@/lib/scoop";
import { FALLBACK_COLLECTIONS, FALLBACK_PRODUCTS } from "./fallback-data";

/**
 * True once the Supabase env vars are present. Until then every query
 * serves the bundled sample catalogue, so `npm run dev` works on a fresh
 * clone with no database.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Load active product rows by slug, keyed by slug.
 *
 * Checkout and the cart's postage quote both need the *server's* copy of a
 * basket's products — for prices in one case and for weights in the other — and
 * they must agree about which rows exist. This lived privately inside
 * `app/api/checkout/route.ts` until postage needed it too; a second copy would
 * have been a second answer to "is this product still buyable", and a basket
 * that quotes on one set of rows and is charged against another is exactly the
 * class of drift `quoteBasket()` being the single entry point is meant to stop.
 *
 * `active` is filtered here, not by the caller, because forgetting it is silent:
 * a retired product would still be weighed and still be priced.
 */
export async function loadProductsBySlug(
  slugs: string[],
): Promise<Map<string, Product>> {
  if (slugs.length === 0) return new Map();

  if (!isDatabaseConfigured()) {
    return new Map(
      FALLBACK_PRODUCTS.filter((p) => slugs.includes(p.slug)).map((p) => [
        p.slug,
        p,
      ]),
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .in("slug", slugs)
    .eq("active", true);

  return new Map(((data ?? []) as Product[]).map((p) => [p.slug, p]));
}

export type ProductFilters = {
  category?: string;
  theme?: string;
  attachment?: string;
  min?: number;
  max?: number;
  /**
   * `"rating"` was a member here, and both sorts below ordered by the `rating`
   * column. Every product in the catalogue is `rating: 0` — the seed emits it
   * and nothing can raise it, because there is no review path — so "Highest
   * rated" ranked the shop by a column with a single value and presented
   * whatever order Postgres returned as a quality ranking, in a shop that
   * suppresses ratings on every other surface. It is gone from the type, from
   * both switches, and from the Sort by menu.
   *
   * It can still ARRIVE: app/shop/page.tsx casts `?sort=` straight out of the
   * URL, so a bookmark or a shared link carrying `?sort=rating` outlives this
   * change. That is handled rather than rejected — an unrecognised value falls
   * through to the `default` branch in both sorts below and the shopper gets
   * Most popular, which is also what the Sort by menu shows for a value it
   * does not know. Keep both switches defaulting; do not make an unknown sort
   * an error, and do not reintroduce this member without a real rating.
   */
  sort?: "popular" | "new" | "price-asc" | "price-desc";
  page?: number;
  perPage?: number;
};

function applyFallbackFilters(filters: ProductFilters) {
  let rows = [...FALLBACK_PRODUCTS];
  if (filters.category) rows = rows.filter((p) => p.category === filters.category);
  if (filters.theme) rows = rows.filter((p) => p.theme === filters.theme);
  if (filters.attachment) {
    rows = rows.filter((p) =>
      p.attachments.some((a) => a.id === filters.attachment),
    );
  }
  if (filters.min !== undefined) rows = rows.filter((p) => p.price >= filters.min!);
  if (filters.max !== undefined) rows = rows.filter((p) => p.price <= filters.max!);

  switch (filters.sort) {
    case "price-asc":
      rows.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      rows.sort((a, b) => b.price - a.price);
      break;
    // No `case "rating"`: see ProductFilters["sort"] above. An unknown value
    // (including a bookmarked ?sort=rating) lands in `default`.
    case "new":
      rows.sort((a, b) => Number(b.is_new) - Number(a.is_new));
      break;
    default:
      rows.sort(
        (a, b) =>
          Number(b.is_bestseller) - Number(a.is_bestseller) ||
          b.review_count - a.review_count,
      );
  }
  return rows;
}

export async function getProducts(
  filters: ProductFilters = {},
): Promise<{ products: Product[]; total: number }> {
  const perPage = filters.perPage ?? 12;
  const page = Math.max(1, filters.page ?? 1);

  if (!isDatabaseConfigured()) {
    const rows = applyFallbackFilters(filters);
    const start = (page - 1) * perPage;
    return { products: rows.slice(start, start + perPage), total: rows.length };
  }

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .eq("active", true);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.theme) query = query.eq("theme", filters.theme);
  // `attachments` is a jsonb array of objects, so the attachment filter is a
  // containment test: `attachments @> '[{"id":"strap"}]'`. jsonb containment
  // is partial for objects, so only the id has to match. This must run before
  // .range() so the exact count and the page window agree — filtering the
  // returned page in JS afterwards would leave `total` counting unfiltered
  // rows, over-reporting the header and inventing empty trailing pages.
  //
  // The value is stringified deliberately: postgrest-js renders a JS array as
  // a Postgres array literal (`cs.{...}`), which mangles objects. A string is
  // passed through as-is, giving PostgREST the JSON it wants.
  if (filters.attachment) {
    query = query.contains(
      "attachments",
      JSON.stringify([{ id: filters.attachment }]),
    );
  }
  if (filters.min !== undefined) query = query.gte("price", filters.min);
  if (filters.max !== undefined) query = query.lte("price", filters.max);

  switch (filters.sort) {
    case "price-asc":
      query = query.order("price", { ascending: true });
      break;
    case "price-desc":
      query = query.order("price", { ascending: false });
      break;
    // No `case "rating"`: see ProductFilters["sort"] above. An unknown value
    // (including a bookmarked ?sort=rating) lands in `default`.
    case "new":
      query = query.order("is_new", { ascending: false }).order("created_at", {
        ascending: false,
      });
      break;
    default:
      query = query
        .order("is_bestseller", { ascending: false })
        .order("review_count", { ascending: false });
  }

  const start = (page - 1) * perPage;
  const { data, count, error } = await query.range(start, start + perPage - 1);

  if (error) {
    console.error("getProducts failed:", error.message);
    return { products: [], total: 0 };
  }

  const products = (data ?? []) as Product[];
  return { products, total: count ?? products.length };
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!isDatabaseConfigured()) {
    return FALLBACK_PRODUCTS.find((p) => p.slug === slug) ?? null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("getProductBySlug failed:", error.message);
    return null;
  }
  return (data as Product) ?? null;
}

export async function getRelatedProducts(
  product: Product,
  limit = 4,
): Promise<Product[]> {
  if (!isDatabaseConfigured()) {
    return FALLBACK_PRODUCTS.filter(
      (p) => p.slug !== product.slug && p.theme === product.theme,
    )
      .concat(FALLBACK_PRODUCTS.filter((p) => p.slug !== product.slug))
      .slice(0, limit);
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .eq("theme", product.theme)
    .neq("slug", product.slug)
    .limit(limit);

  const rows = (data ?? []) as Product[];
  if (rows.length >= limit) return rows;

  // Top up from the wider catalogue so the rail is never half-empty.
  const { data: extra } = await supabase
    .from("products")
    .select("*")
    .eq("active", true)
    .neq("slug", product.slug)
    .order("is_bestseller", { ascending: false })
    .limit(limit * 2);

  const seen = new Set(rows.map((r) => r.slug));
  for (const row of ((extra ?? []) as Product[])) {
    if (rows.length >= limit) break;
    if (!seen.has(row.slug)) {
      rows.push(row);
      seen.add(row.slug);
    }
  }
  return rows.slice(0, limit);
}

export async function searchProducts(term: string): Promise<Product[]> {
  const query = term.trim();
  if (!query) return [];

  if (!isDatabaseConfigured()) {
    const needle = query.toLowerCase();
    return FALLBACK_PRODUCTS.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.theme.toLowerCase().includes(needle) ||
        p.category.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle),
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_products", {
    p_query: query,
  });

  if (error) {
    console.error("searchProducts failed:", error.message);
    return [];
  }
  return (data ?? []) as Product[];
}

/**
 * @param strict when true, a *query error* throws instead of quietly falling
 *   back to the bundled sample list. Checkout validates colourways against
 *   this, so it must never accept one that has been deactivated in the
 *   database — better to fail the checkout than to sell a retired colourway.
 *
 *   Running with no database at all is a different thing: it is the intended
 *   sample-catalogue mode, where the products being validated are themselves
 *   fallback data. Strict mode allows that, or the builder would be unusable
 *   in local development.
 */
export async function getCollections(strict = false): Promise<Collection[]> {
  if (!isDatabaseConfigured()) return FALLBACK_COLLECTIONS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("active", true)
    .order("sort_order");

  if (error) {
    console.error("getCollections failed:", error.message);
    if (strict) throw new Error("Collections are unavailable.");
    return FALLBACK_COLLECTIONS;
  }
  return (data ?? []) as Collection[];
}

export async function getReviews(productId: string): Promise<Review[]> {
  if (!isDatabaseConfigured()) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (data ?? []) as Review[];
}

/** Distinct facet values with counts, for the catalogue sidebar. */
export async function getFacets(): Promise<{
  categories: { value: string; count: number }[];
  themes: { value: string; count: number }[];
}> {
  const rows = isDatabaseConfigured()
    ? await (async () => {
        const supabase = await createClient();
        const { data } = await supabase
          .from("products")
          .select("category, theme")
          .eq("active", true);
        return (data ?? []) as { category: string; theme: string }[];
      })()
    : FALLBACK_PRODUCTS.map((p) => ({ category: p.category, theme: p.theme }));

  const tally = (key: "category" | "theme") => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[key];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  };

  return { categories: tally("category"), themes: tally("theme") };
}

/* --------------------------------------------------- order confirmation */

export type OrderConfirmationSummary = {
  /**
   * Null until the Stripe webhook allocates one. Order numbers are handed out
   * on payment, not at checkout, so a shopper who beats the webhook back to
   * the confirmation page legitimately has none yet.
   */
  orderNumber: string | null;
  status: string | null;
};

/**
 * Three outcomes, kept apart on purpose. "There is no such order" and "we
 * could not look it up" are different facts, and the confirmation page has to
 * say which one it means — telling a customer who has just been charged that
 * no order matches, when really the lookup itself failed, is the same class of
 * false statement this page is being fixed for.
 */
export type OrderConfirmationLookup =
  | { state: "found"; summary: OrderConfirmationSummary }
  /** The database answered and holds no order for this checkout session. */
  | { state: "not_found" }
  /** No database, no service-role key, or the query errored. Nothing known. */
  | { state: "unavailable" };

/**
 * The order number for a Stripe Checkout session.
 *
 * Runs on the ADMIN client by necessity. `orders` RLS is `auth.uid() =
 * user_id`, so a guest — who has no session at all — can never read their own
 * order through the anon client; that is why the guest order was untrackable
 * (WORKLOG §0.1). `order_confirmation_summary` is security definer and granted
 * to `service_role` only, so it is not callable over PostgREST with the public
 * anon key the way `lookup_order` was (§0.2).
 *
 * The Stripe session id is the authorisation. It is unguessable and only ever
 * reaches the browser that completed this checkout. The function returns the
 * order number and status and nothing else, so even a leaked URL cannot yield
 * an address, an email or a total — the column list is the security boundary,
 * which is why this helper asks it for nothing more.
 *
 * **Never throws.** It renders on the page a customer sees immediately after
 * being charged, so a missing service-role key, an absent database or a
 * transient query error must degrade to `unavailable`, not to an error screen.
 */
export async function getOrderConfirmationSummary(
  stripeSessionId: string,
): Promise<OrderConfirmationLookup> {
  if (!stripeSessionId) return { state: "unavailable" };

  // Absence of a database is not a query error (CLAUDE.md): in the bundled
  // sample-catalogue mode there is no orders table to consult, so nothing is
  // known — which is not the same as "no such order", hence `unavailable`.
  // The service-role key is checked here rather than left to
  // createAdminClient()'s throw, so the normal no-key path is a plain return.
  if (!isDatabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { state: "unavailable" };
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("order_confirmation_summary", {
      p_stripe_session_id: stripeSessionId,
    });

    if (error) {
      console.error("getOrderConfirmationSummary failed:", error.message);
      return { state: "unavailable" };
    }

    // A `returns table` function comes back as rows, even with `limit 1`.
    const row = (
      data as { order_number: string | null; status: string | null }[] | null
    )?.[0];
    if (!row) return { state: "not_found" };

    return {
      state: "found",
      summary: {
        orderNumber: row.order_number ?? null,
        status: row.status ?? null,
      },
    };
  } catch (error) {
    // createAdminClient() throws on a malformed URL, and the fetch itself can
    // reject. Either way the customer's page must still render.
    console.error(
      "getOrderConfirmationSummary failed:",
      error instanceof Error ? error.message : error,
    );
    return { state: "unavailable" };
  }
}

/* -------------------------------------------------------------- lucky scoop */

/**
 * A tier as the shopfront needs it: the row, its pool, and how full the bowl
 * happens to be.
 *
 * `availability.sellable` asks ONE thing — is this tier switched on and priced,
 * i.e. for sale at all. It is deliberately blind to stock. It used to gate on
 * the pool's stock as well, and that was wrong: the shop prints to order, so a
 * short bowl is a print job before packing, not a closed listing. See
 * `lib/scoop.ts` for the correction in full, and do not reintroduce it here.
 *
 * `availability.drawable` and `.scoopsAvailable` ride along as facts about the
 * shelf. The studio acts on them. Nothing on the shopfront may hide, disable or
 * cap anything with them.
 */
export type ScoopTierListing = ScoopTierWithPool & {
  availability: ScoopAvailability;
};

/*
 * One PostgREST select for the row and its pool. `scoop_tier_products` is a
 * pure join table, so the pool comes back as an array of wrappers each holding
 * one product; `mapScoopTier` flattens them.
 *
 * Nothing here asks for `active` or `price_cents is not null` — the RLS policy
 * in 0007_lucky_scoop.sql already refuses to publish a draft, and repeating the
 * filter in the query would make it look as though the policy were optional.
 */
const SCOOP_TIER_COLUMNS = "*, scoop_tier_products(products(*))";

type ScoopPoolJoin = { products: Product | Product[] | null };

function mapScoopTier(row: unknown): ScoopTierListing {
  const record = row as ScoopTier & { scoop_tier_products?: ScoopPoolJoin[] };

  const pool: Product[] = (record.scoop_tier_products ?? []).flatMap((entry) => {
    const product = Array.isArray(entry.products) ? entry.products[0] : entry.products;
    return product ? [product] : [];
  });

  const availability = tierAvailability(
    {
      pieceCount: record.piece_count,
      priceCents: record.price_cents,
      packedWeightGrams: record.packed_weight_grams,
      active: record.active,
    },
    pool.map((product) => ({
      productId: product.id,
      stockOnHand: Number(product.stock_on_hand ?? 0),
      // Anything the anon key can see is active by policy; read rather than
      // assumed, so this keeps working if the studio ever reads through here.
      active: product.active !== false,
      // Cost is never published — the costing tables are service_role only —
      // and the shopfront has no use for it. Null keeps that explicit rather
      // than letting a zero look like a measured piece.
      unitCostCents: null,
    })),
  );

  // Rebuilt field by field rather than spread, so the join rows cannot ride
  // along beside the flattened pool — two spellings of one list is two things
  // that can disagree — and so a column that is renamed in the schema shows up
  // here rather than reaching a page as `undefined`.
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    blurb: record.blurb ?? "",
    theme: record.theme,
    piece_count: record.piece_count,
    price_cents: record.price_cents,
    packed_weight_grams: record.packed_weight_grams,
    packed_thickness_mm: record.packed_thickness_mm,
    sort_order: record.sort_order,
    active: record.active,
    created_at: record.created_at,
    pool,
    availability,
  };
}

/**
 * Every published scoop tier, in the studio's own order.
 *
 * Empty when Supabase is unconfigured, like every other read here — and
 * deliberately WITHOUT a bundled fallback. `FALLBACK_PRODUCTS` exists so a
 * fresh clone has a catalogue to render; a fallback tier would need a made-up
 * price, and "nothing is priced in code" is the whole point of this feature.
 * A shop with no database simply has no scoops, which is true.
 */
export async function getScoopTiers(): Promise<ScoopTierListing[]> {
  if (!isDatabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoop_tiers")
    .select(SCOOP_TIER_COLUMNS)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("getScoopTiers failed:", error.message);
    return [];
  }
  return (data ?? []).map(mapScoopTier);
}

/**
 * Published tiers by slug, keyed by slug — the scoop counterpart of
 * `loadProductsBySlug` above, and here for the same reason.
 *
 * Checkout and the cart's postage quote both need the SERVER's copy of a
 * basket's tiers: the price in one case, the packed weight in the other, and in
 * both the question of whether the tier is on sale at all. A second copy of
 * this read would be a second answer to that question, and a basket that quotes
 * on one set of rows and is charged against another is exactly the drift that
 * having one entry point exists to stop.
 *
 * THE ANON CLIENT IS DELIBERATE, not an oversight in a route that also holds
 * the service-role key. Reading through RLS is what makes the policy in
 * 0007_lucky_scoop.sql the first gate: a tier that is inactive or unpriced
 * simply is not in the result, so a slug typed into a checkout body cannot
 * reach a draft. The service-role key would bypass exactly the check that
 * matters. Checkout tests `availability.sellable` as well, so that the answer
 * does not rest on one policy staying exactly as it is — but it is the SAME
 * question asked twice, not a second, stock-flavoured one.
 *
 * Empty when Supabase is unconfigured, matching `getScoopTiers` and for the
 * same reason: there is no bundled fallback tier, because a fallback tier would
 * need a made-up price.
 */
export async function loadScoopTiersBySlug(
  slugs: string[],
): Promise<Map<string, ScoopTierListing>> {
  if (slugs.length === 0 || !isDatabaseConfigured()) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoop_tiers")
    .select(SCOOP_TIER_COLUMNS)
    .in("slug", slugs);

  if (error) {
    // An empty map on a read failure looks identical to "none of these tiers is
    // published", and both callers turn that into a refusal — which is the safe
    // direction, because no money moves on a refusal. The log is the only thing
    // that tells the two apart, so it is not optional.
    console.error("loadScoopTiersBySlug failed:", error.message);
    return new Map();
  }

  return new Map(
    (data ?? []).map(mapScoopTier).map((tier) => [tier.slug, tier] as const),
  );
}

/** One published tier by slug, or null. Null for "no such tier" and for "no database". */
export async function getScoopTierBySlug(
  slug: string,
): Promise<ScoopTierListing | null> {
  if (!slug || !isDatabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scoop_tiers")
    .select(SCOOP_TIER_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("getScoopTierBySlug failed:", error.message);
    return null;
  }
  return data ? mapScoopTier(data) : null;
}
