import type { Product } from "@/lib/types";

/** A photograph uploaded in the studio: a path inside the `product-photos` bucket. */
export type ProductPhoto = { path: string; alt?: string | null };

/**
 * Public URL for a stored product photo.
 *
 * Built from the Supabase project URL at render time, so rows only ever hold a
 * path (see 0003_admin.sql). Returns null when Supabase is not configured,
 * which is the fallback-data mode, so callers fall back to the drawing.
 */
export function photoUrl(path: string): string | null {
  // A path starting with "/" is a photo shipped with the site itself
  // (public/products/...), served from this origin.
  if (path.startsWith("/")) return path;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  if (!base || !path) return null;
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/public/product-photos/${clean}`;
}

/** The product's photos as ready-to-render {src, alt}, in their saved order. */
export function productPhotos(
  product: Pick<Product, "photos" | "short_name">,
): { src: string; thumb: string; alt: string }[] {
  const list = Array.isArray(product.photos) ? product.photos : [];
  const out: { src: string; thumb: string; alt: string }[] = [];
  for (const photo of list) {
    if (!photo || typeof photo.path !== "string") continue;
    const src = photoUrl(photo.path);
    if (src) out.push({ src, thumb: thumbFor(src), alt: photo.alt?.trim() || product.short_name });
  }
  return out;
}

/**
 * The smaller copy used on cards and in the basket. Site photos ship an 800px
 * "-sm" version beside each 1600px one; uploaded photos have only one size.
 */
export function thumbFor(src: string): string {
  return src.startsWith("/") && src.endsWith(".jpg") ? src.replace(/\.jpg$/, "-sm.jpg") : src;
}
