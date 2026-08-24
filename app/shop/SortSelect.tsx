"use client";

import { useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "popular", label: "Most popular" },
  { value: "new", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "rating", label: "Highest rated" },
];

export function SortSelect({ current }: { current: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "popular") next.delete("sort");
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
        value={current}
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
