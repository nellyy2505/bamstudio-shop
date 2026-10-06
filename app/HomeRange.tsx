"use client";

import { useState } from "react";
import { ProductGrid } from "@/components/product/ProductCard";
import { cx } from "@/components/ui";
import type { Product } from "@/lib/types";

/**
 * The home page's one product grid, with filter chips in place of the separate
 * sections it used to have. Filtering is presentation only: every product here
 * was loaded and priced by the server.
 */
type FilterId = "all" | "keychains" | "cake" | "desk";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "keychains", label: "Keychains" },
  { id: "cake", label: "Cake box" },
  { id: "desk", label: "Desk & home" },
];

function groupOf(product: Product): FilterId {
  if (product.personalisation_mode === "bakery") return "cake";
  if (product.category === "Clicker keychain" || product.personalisation_mode === "builder") {
    return "keychains";
  }
  return "desk";
}

export function HomeRange({ products }: { products: Product[] }) {
  const [filter, setFilter] = useState<FilterId>("all");
  // Only offer a chip that has something behind it.
  const present = new Set(products.map(groupOf));
  const chips = FILTERS.filter((f) => f.id === "all" || present.has(f.id));
  const shown = filter === "all" ? products : products.filter((p) => groupOf(p) === filter);

  return (
    <>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[13px] font-extrabold tracking-[0.12em] text-accent uppercase">
            The range
          </p>
          <h2 className="text-[32px] leading-tight md:text-[42px]">Little things, big clicks</h2>
        </div>
        {chips.length > 2 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the range">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFilter(chip.id)}
                aria-pressed={filter === chip.id}
                className={cx(
                  "h-11 rounded-full border-2 border-ink px-[18px] text-[14px] font-extrabold",
                  filter === chip.id ? "bg-ink text-white" : "bg-transparent text-ink hover:bg-white",
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ProductGrid products={shown} columns={4} />
    </>
  );
}
