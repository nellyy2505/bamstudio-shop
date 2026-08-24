import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/queries";

export const runtime = "nodejs";

/** Typeahead suggestions for the header search. */
export async function GET(request: Request) {
  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (term.length < 2) {
    return NextResponse.json({ products: [] });
  }

  try {
    const products = await searchProducts(term);
    return NextResponse.json(
      {
        products: products.slice(0, 5).map((p) => ({
          slug: p.slug,
          short_name: p.short_name,
          name: p.name,
          price: p.price,
          art: p.art,
          tint: p.tint,
          rating: p.rating,
          review_count: p.review_count,
        })),
      },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (error) {
    console.error("suggest failed:", error);
    return NextResponse.json({ products: [] });
  }
}
