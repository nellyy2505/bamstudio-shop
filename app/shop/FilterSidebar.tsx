"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon, Pill, cx } from "@/components/ui";

type Facet = { value: string; count: number };

const ATTACHMENTS = [
  { id: "keyring", label: "Keyring" },
  { id: "strap", label: "Phone strap" },
  { id: "cord", label: "Bag charm cord" },
  { id: "none", label: "No attachment" },
];

const PRICE_BANDS = [
  { label: "Under $10", max: 1000 },
  { label: "Under $15", max: 1500 },
  { label: "Under $20", max: 2000 },
];

export function FilterSidebar({
  facets,
  activeCategory,
  activeTheme,
  activeAttachment,
  activeMax,
  activeCount,
}: {
  facets: { categories: Facet[]; themes: Facet[] };
  activeCategory?: string;
  activeTheme?: string;
  activeAttachment?: string;
  activeMax?: number;
  activeCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [openOnMobile, setOpenOnMobile] = useState(false);

  /** Toggling a filter always resets pagination. */
  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value === null || next.get(key) === value) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    const query = next.toString();
    router.push(query ? `/shop?${query}` : "/shop");
  }

  const group = (
    title: string,
    items: { value: string; label: string; count?: number }[],
    activeValue: string | undefined,
    key: string,
  ) => (
    <div className="border-t border-line py-5">
      <h3 className="mb-3.5 text-sm font-extrabold">{title}</h3>
      <div className="flex flex-col gap-2.5">
        {items.map((item) => {
          const on = activeValue === item.value;
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(key, item.value)}
              aria-pressed={on}
              className={cx(
                "flex items-center gap-2.5 text-left text-sm",
                on ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              <span
                className={cx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  on ? "border-ink bg-ink text-white" : "border-line2 bg-surface",
                )}
              >
                {on ? <Icon name="check" size={13} strokeWidth={2.8} /> : null}
              </span>
              <span className="flex-1">{item.label}</span>
              {item.count !== undefined ? (
                <span className="text-xs text-faint">{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <aside>
      <div className="flex items-center justify-between pb-3.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-extrabold">Filters</h2>
          {activeCount > 0 ? (
            <Pill tone="accent">{activeCount}</Pill>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {activeCount > 0 ? (
            <button
              type="button"
              onClick={() => router.push("/shop")}
              className="text-[13px] text-accent underline underline-offset-2"
            >
              Clear all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setOpenOnMobile((open) => !open)}
            aria-expanded={openOnMobile}
            className="flex items-center gap-1.5 rounded-full border border-line2 px-3 py-1.5 text-[13px] font-bold lg:hidden"
          >
            {openOnMobile ? "Hide" : "Show"}
            <Icon name={openOnMobile ? "chevUp" : "chev"} size={14} />
          </button>
        </div>
      </div>

      <div className={cx(openOnMobile ? "block" : "hidden", "lg:block")}>
        {group(
          "Category",
          facets.categories.map((f) => ({
            value: f.value,
            label: f.value,
            count: f.count,
          })),
          activeCategory,
          "category",
        )}
        {group(
          "Theme",
          facets.themes.map((f) => ({
            value: f.value,
            label: f.value,
            count: f.count,
          })),
          activeTheme,
          "theme",
        )}
        {group(
          "Attachment",
          ATTACHMENTS.map((a) => ({ value: a.id, label: a.label })),
          activeAttachment,
          "attachment",
        )}
        {group(
          "Price",
          PRICE_BANDS.map((b) => ({ value: String(b.max), label: b.label })),
          activeMax ? String(activeMax) : undefined,
          "max",
        )}

        <div className="mt-3 rounded-2xl bg-lilac p-4">
          <b className="text-[13.5px]">Can&apos;t find their name?</b>
          <p className="mt-1.5 mb-2.5 text-[12.5px] text-muted">
            Build a custom charm letter by letter.
          </p>
          <a
            href="/builder"
            className="inline-flex items-center gap-1.5 text-[13px] font-extrabold text-accent underline underline-offset-2"
          >
            Design Your Own
            <Icon name="arrow" size={14} />
          </a>
        </div>
      </div>
    </aside>
  );
}
