import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/staff";
import { createAdminClient } from "@/lib/supabase/server";
import { LISTINGS_FORMAT } from "@/lib/listings";

/**
 * The current catalogue as a listings file, for editing and re-importing.
 *
 * Guarded like every other /admin entry point: a route handler is not covered
 * by the admin layout. Only customer-facing fields are exported, never cost,
 * stock or print data, because this file is made to be handed to an assistant.
 */
export async function GET() {
  await requireStaff("catalogue");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("products")
    .select(
      "sku, slug, name, short_name, description, details, category, theme, price, weight_grams, active, is_new, is_bestseller, photos",
    )
    .order("sku");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const products = (data ?? []).map((row) => ({
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    short_name: row.short_name,
    description: row.description,
    details: row.details,
    category: row.category,
    theme: row.theme,
    price: Number(row.price) / 100,
    weight_grams: row.weight_grams,
    active: row.active,
    is_new: row.is_new,
    is_bestseller: row.is_bestseller,
    // Informational: how many photos the product already has. Not re-imported.
    current_photo_count: Array.isArray(row.photos) ? row.photos.length : 0,
  }));

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify({ format: LISTINGS_FORMAT, products }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="bamstudio-listings-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
