import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/queries";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * Longest query we will hand to the database. The header search box sends a
 * few words at most, and the longest product name in the catalogue is well
 * under this. Anything longer is a paste or a probe, so it is rejected rather
 * than truncated: truncating would still run the scan on 64 attacker-chosen
 * characters and would silently return results for a term the caller never
 * typed, which reads as a bug from the client's side.
 */
const MAX_QUERY_LENGTH = 64;

/**
 * The client debounces at 180ms and only fires at 2+ characters, so one typed
 * search costs well under ten requests, and a request only leaves the browser
 * after the shopper pauses. 30 in 10 seconds covers three back-to-back
 * searches — or a couple of shoppers sharing an office/household NAT, since
 * clientKey() buckets by IP — while capping a scripted loop at 3 requests a
 * second instead of as fast as the socket allows. The window is short (rather
 * than the 60s used by /api/track and /api/checkout) so a shared address that
 * does trip it gets its typeahead back within seconds; nothing here is
 * sensitive, the cost being defended is the sequential scan behind it.
 */
const SUGGEST_LIMIT = 30;
const SUGGEST_WINDOW_MS = 10_000;

/** Typeahead suggestions for the header search. */
export async function GET(request: Request) {
  const limit = rateLimit(
    clientKey(request, "suggest"),
    SUGGEST_LIMIT,
    SUGGEST_WINDOW_MS,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { products: [] },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const term = new URL(request.url).searchParams.get("q")?.trim() ?? "";

  if (term.length < 2) {
    return NextResponse.json({ products: [] });
  }

  // The route cannot trust the client to have kept the box short.
  if (term.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { products: [] },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const products = await searchProducts(term);
    return NextResponse.json(
      {
        // `rating` and `review_count` are published so the client can decide
        // whether there is anything to show, NOT so it can print them: every
        // product in the catalogue is rating 0 / review_count 0 and there is
        // no review-submission path, so a suggestion that renders either one
        // unconditionally states a fact the shop does not have. SearchBar did
        // exactly that ("$9.00 · 0 reviews") until it was gated on
        // `review_count > 0`, the same way ProductCard and the product page
        // already gate theirs. Any new consumer of this route gates too.
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
