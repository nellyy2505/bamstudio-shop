import { createClient } from "@/lib/supabase/server";
import type { Collection, Product, Review } from "@/lib/types";
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

export type ProductFilters = {
  category?: string;
  theme?: string;
  attachment?: string;
  min?: number;
  max?: number;
  sort?: "popular" | "new" | "price-asc" | "price-desc" | "rating";
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
    case "rating":
      rows.sort((a, b) => b.rating - a.rating);
      break;
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
    case "rating":
      query = query.order("rating", { ascending: false });
      break;
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

export async function getCollections(): Promise<Collection[]> {
  if (!isDatabaseConfigured()) return FALLBACK_COLLECTIONS;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("active", true)
    .order("sort_order");

  if (error) {
    console.error("getCollections failed:", error.message);
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
