"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Pill } from "@/components/ui";
import { ProductImage } from "@/components/ProductArt";
import { money } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";

type Suggestion = {
  slug: string;
  short_name: string;
  name: string;
  price: number;
  art: ArtKey;
  tint: Tint;
  rating: number;
  review_count: number;
};

const POPULAR = [
  "matcha set",
  "name charm",
  "corgi",
  "macaron",
  "gifts under $10",
];

export function SearchBar({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Debounced suggestion fetch, with in-flight cancellation.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/search/suggest?q=${encodeURIComponent(term)}`,
          { signal: controller.signal },
        );
        if (!res.ok) throw new Error("suggest failed");
        const data = await res.json();
        setResults(Array.isArray(data.products) ? data.products : []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Close the panel on outside click or Escape.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function submit(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
        className="flex h-11 items-center overflow-hidden rounded-full border-2 border-ink bg-surface focus-within:border-accent md:h-[50px]"
      >
        <label htmlFor={listId} className="sr-only">
          Search products
        </label>
        <input
          id={listId}
          type="search"
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search clickers, charms, gifts…"
          className="min-w-0 flex-1 bg-transparent px-4 text-[15px] outline-none placeholder:text-faint md:px-5"
        />
        <button
          type="submit"
          aria-label="Search"
          className="flex h-full w-12 shrink-0 items-center justify-center bg-accent text-white transition-colors hover:bg-accent-dark md:w-[58px]"
        >
          <Icon name="search" size={20} strokeWidth={2.2} />
        </button>
      </form>

      {open && (query.trim().length > 0 || results.length > 0) ? (
        <div className="absolute top-full left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-2xl">
          {results.length > 0 ? (
            <>
              <p className="px-3.5 pt-2.5 pb-2 text-[11.5px] font-extrabold tracking-wider text-faint">
                PRODUCTS
              </p>
              {results.map((item) => (
                <Link
                  key={item.slug}
                  href={`/product/${item.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3.5 rounded-xl px-3.5 py-2.5 hover:bg-cream"
                >
                  <ProductImage
                    art={item.art}
                    tint={item.tint}
                    alt=""
                    size={48}
                    rounded="rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-semibold">
                      {item.short_name}
                    </span>
                    <span className="text-xs text-muted">
                      {money(item.price)} · {item.review_count} reviews
                    </span>
                  </span>
                  <Icon name="arrow" size={16} className="shrink-0 text-faint" />
                </Link>
              ))}
            </>
          ) : query.trim().length >= 2 && !loading ? (
            <p className="px-3.5 py-4 text-sm text-muted">
              No products match “{query.trim()}”. Try a theme like{" "}
              <button
                type="button"
                onClick={() => submit("food")}
                className="font-bold text-accent underline"
              >
                food
              </button>
              .
            </p>
          ) : null}

          <div className="my-2 border-t border-line" />
          <p className="px-3.5 pb-2 text-[11.5px] font-extrabold tracking-wider text-faint">
            POPULAR SEARCHES
          </p>
          <div className="flex flex-wrap gap-2 px-3.5 pb-3">
            {POPULAR.map((term) => (
              <button key={term} type="button" onClick={() => submit(term)}>
                <Pill tone="line">
                  <Icon name="trend" size={13} />
                  {term}
                </Pill>
              </button>
            ))}
          </div>

          {query.trim() ? (
            <button
              type="button"
              onClick={() => submit(query)}
              className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-3 text-sm font-extrabold text-accent-dark hover:bg-cream"
            >
              <Icon name="search" size={16} />
              See all results for “{query.trim()}”
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
