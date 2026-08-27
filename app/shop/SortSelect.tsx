"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * "Highest rated" was here and is gone. It sorted `products.rating`, which is
 * 0 for every product in the catalogue and cannot be anything else — there is
 * no review path — so it offered the customer a quality ranking that was
 * really an arbitrary order, in a shop that hides ratings everywhere else.
 * `lib/queries.ts` dropped the matching case from both sorts.
 */
const OPTIONS = [
  { value: "popular", label: "Most popular" },
  { value: "new", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

const DEFAULT_SORT = "popular";

export function SortSelect({ current }: { current: string }) {
  const router = useRouter();
  const params = useSearchParams();

  /*
   * `current` comes from `?sort=` in the URL, uncontrolled and unvalidated
   * (app/shop/page.tsx casts it), so a bookmark or a shared link from before
   * this change can still say `sort=rating` — and any other string can be
   * typed in by hand. A <select> whose value matches no <option> renders
   * blank in some browsers and silently shows the first option in others,
   * either way disagreeing with the grid underneath it. getProducts() sends an
   * unrecognised sort to its default branch, i.e. Most popular, so showing
   * Most popular here is not a guess: it names the order actually on screen.
   */
  const selected = OPTIONS.some((option) => option.value === current)
    ? current
    : DEFAULT_SORT;

  function onChange(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === DEFAULT_SORT) next.delete("sort");
    else next.set("sort", value);
    next.delete("page");
    const query = next.toString();
    router.push(query ? `/shop?${query}` : "/shop");
  }

  return (
    <div className="flex items-center gap-2.5">
      <label htmlFor="sort" className="text-[13.5px] text-muted">
        Sort by
      </label>
      <select
        id="sort"
        value={selected}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-full border border-line2 bg-surface px-4 text-sm font-extrabold focus:border-accent focus:outline-none"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
