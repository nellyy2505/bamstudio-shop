import type { Metadata } from "next";
import { Suspense } from "react";
import { CartView } from "./CartView";
import { getProducts } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Your basket",
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
