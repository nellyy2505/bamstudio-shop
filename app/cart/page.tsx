import type { Metadata } from "next";
import { Suspense } from "react";
import { CartView } from "./CartView";
import { getProducts } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Your basket",
  /*
   * Not for the index, and robots.txt is the wrong tool for saying so.
   *
   * The header's basket button links here from every page in the shop.
   *
   * Google therefore finds it whatever /robots.txt says, and a `Disallow`
   * would only stop it FETCHING the page, leaving it free to list the bare
   * URL from those links with no directive it is allowed to read. `noindex`
   * on a page that stays crawlable is what actually keeps it out. The
   * default `follow` is kept, so link equity still flows through to the shop
   * pages linked from here. See `app/robots.ts`.
   */
  robots: { index: false },
  description: "Review your Bam Studio basket and check out securely.",
};

export default async function CartPage() {
  // Suggestions for both the filled and empty states, fetched on the server.
  const { products } = await getProducts({ sort: "popular", perPage: 4 });

  // CartView reads ?cancelled= via useSearchParams, which needs a boundary.
  return (
    <Suspense
      fallback={
        <div className="wrap py-20 text-center text-muted">
          Loading your basket…
        </div>
      }
    >
      <CartView suggestions={products} />
    </Suspense>
  );
}
