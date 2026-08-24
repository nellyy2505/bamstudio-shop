import type { Metadata } from "next";
import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { FavouritesSync } from "@/components/product/FavouriteButton";
import { ButtonLink, EmptyState, Icon, Stars, cx } from "@/components/ui";
import { money, pluralise } from "@/lib/format";
import type { Product, Tint } from "@/lib/types";
import { AddToBasketButton } from "./AddToBasketButton";
import { firstOf, requireAccount } from "../data";

export const metadata: Metadata = {
  title: "Your favourites",
  description: "Everything you've hearted, saved in one place.",
  robots: { index: false, follow: false },
};

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

type FavouriteRow = { products: Product | Product[] | null };

export default async function FavouritesPage() {
  const { supabase, user } = await requireAccount();

  let products: Product[] = [];
  try {
    const { data, error } = await supabase
      .from("favourites")
      .select("created_at, products(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("account favourites query failed:", error.message);
    } else {
      products = ((data ?? []) as FavouriteRow[]).flatMap((row) => {
        const product = firstOf(row.products);
        return product ? [product] : [];
      });
    }
  } catch {
    // Database unreachable — fall through to the empty state below.
  }

  if (products.length === 0) {
    return (
      <>
        {/* A guest list hearted before signing in may still be waiting to be
            pushed up; this re-fetches once it has, so the page doesn't claim
            "nothing saved" while /shop shows filled hearts. */}
        <FavouritesSync />
        <EmptyState
          icon={
            <span className="flex h-32 w-32 items-center justify-center rounded-[32px] bg-blush">
              <Icon name="heart" size={52} strokeWidth={1.4} />
            </span>
          }
          title="Nothing saved yet"
          body="Tap the heart on any product and it lands here — handy for keeping an eye on a colourway before you commit."
        >
          <ButtonLink href="/shop">Browse the range</ButtonLink>
        </EmptyState>
      </>
    );
  }

  return (
    <div>
      <FavouritesSync />
      <h1 className="mb-1.5 text-3xl md:text-4xl">Your favourites</h1>
      <p className="mb-7 text-sm text-muted">
        {pluralise(products.length, "saved item")} · the heart on any product
        adds to this list.
      </p>

      <div className="grid grid-cols-2 gap-5 sm:gap-6 lg:grid-cols-3">
        {products.map((product) => (
          <div key={product.id} className="group flex flex-col gap-2.5">
            <Link
              href={`/product/${product.slug}`}
              aria-label={product.short_name}
              className={cx(
                "flex aspect-square items-center justify-center overflow-hidden rounded-2xl",
                TINT_BG[product.tint] ?? "bg-cream",
              )}
            >
              <ProductArt
                art={product.art}
                size={150}
                className="transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              />
            </Link>

            <div>
              <Link
                href={`/product/${product.slug}`}
                className="text-[14.5px] font-bold hover:text-accent-dark"
              >
                {product.short_name}
              </Link>
              <div className="my-0.5 flex items-center gap-1.5">
                <Stars rating={product.rating} size={13} />
                <span className="text-xs text-muted">
                  ({product.review_count})
                </span>
              </div>
              <b className="text-[15px]">
                {product.personalisation_mode === "builder" ? "From " : ""}
                {money(product.price)}{" "}
                <span className="text-[11.5px] font-semibold text-faint">
                  AUD
                </span>
              </b>
            </div>

            <AddToBasketButton product={product} />
          </div>
        ))}
      </div>
    </div>
  );
}
