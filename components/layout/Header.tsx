"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, cx } from "@/components/ui";
import { SearchBar } from "./SearchBar";
import { useCart } from "@/components/cart/CartProvider";
import { isFreeShipping, SHIPPING } from "@/lib/config";
import { money } from "@/lib/format";

/**
 * §0.10: the promo bar used to promise "Free AU shipping from $49" flat, but
 * shippingCost() only waives the standard rate — express is charged at every
 * basket size — so the bar names the method. Which method that is is asked of
 * shippingCost() rather than written here, so the claim cannot outlive a
 * pricing change; if no method is ever free, the claim is simply not made.
 */
const FREE_RATE_METHOD = SHIPPING.methods.find(
  (option) => isFreeShipping(SHIPPING.freeThreshold, option.id),
);

const NAV = [
  { href: "/shop", label: "All categories" },
  { href: "/shop?category=Clicker+keychain", label: "Clicker keychains" },
  { href: "/shop?theme=Plants+%26+flowers", label: "Plants & flowers" },
  { href: "/shop?theme=Letters+%26+names", label: "Letters & names" },
  { href: "/builder", label: "Design Your Own", accent: true },
  { href: "/shop?category=Phone+%26+bag", label: "Phone & bag" },
  { href: "/shop?max=1500", label: "Gifts under $15" },
  { href: "/about", label: "Our story" },
];

export function Header({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const { count, ready } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The drawer closes from the links themselves rather than an effect on
  // `pathname`, so no render is wasted reacting to navigation after the fact.
  const closeDrawer = () => setMobileOpen(false);

  return (
    <>
      <div className="bg-ink px-4 py-2.5 text-center text-[13px] font-semibold text-[#F6F2EA]">
        {FREE_RATE_METHOD ? (
          <>
            Free AU {FREE_RATE_METHOD.label.toLowerCase()} post from{" "}
            <b className="text-[#F3C89B]">{money(SHIPPING.freeThreshold)}</b>
            <span className="hidden sm:inline"> ·</span>
          </>
        ) : null}
        <span className={FREE_RATE_METHOD ? "hidden sm:inline" : undefined}>
          {" "}
          Every piece 3D-printed to order in Sydney
        </span>
      </div>

      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="wrap flex h-16 items-center gap-3 md:h-[84px] md:gap-7">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            aria-label="Menu"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl lg:hidden"
          >
            <Icon name={mobileOpen ? "x" : "menu"} size={22} />
          </button>

          <Link
            href="/"
            className="font-display text-[22px] font-bold tracking-tight whitespace-nowrap md:text-[27px]"
          >
            Bam<span className="text-accent">Studio</span>
          </Link>

          <div className="hidden flex-1 md:block">
            <SearchBar />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <Link
              href={signedIn ? "/account/orders" : "/login"}
              className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11.5px] font-bold text-muted hover:text-ink md:px-3"
            >
              <Icon name="user" size={22} />
              <span className="hidden sm:block">
                {signedIn ? "Account" : "Sign in"}
              </span>
            </Link>
            <Link
              href="/account/favourites"
              className="hidden flex-col items-center gap-0.5 rounded-xl px-3 py-2 text-[11.5px] font-bold text-muted hover:text-ink sm:flex"
            >
              <Icon name="heart" size={22} />
              <span>Favourites</span>
            </Link>
            <Link
              href="/cart"
              className="relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11.5px] font-bold text-ink md:px-3"
            >
              <Icon name="bag" size={22} />
              <span className="hidden sm:block">Basket</span>
              {ready && count > 0 ? (
                <span className="absolute top-0.5 right-0 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-extrabold text-white">
                  {count}
                  <span className="sr-only"> items in basket</span>
                </span>
              ) : null}
            </Link>
          </div>
        </div>

        <div className="wrap pb-3 md:hidden">
          <SearchBar />
        </div>

        <nav className="hidden border-t border-line lg:block">
          <div className="wrap flex h-[50px] items-center justify-center gap-1.5 text-sm font-bold">
            {NAV.map((item) => {
              const active =
                pathname === item.href.split("?")[0] &&
                (item.href.includes("?") ? false : true);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cx(
                    "flex items-center gap-1.5 rounded-full px-3.5 py-2",
                    item.accent ? "text-accent" : "text-ink",
                    active && "bg-cream",
                  )}
                >
                  {item.accent ? <Icon name="sparkle" size={16} /> : null}
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {mobileOpen ? (
          <nav className="border-t border-line bg-surface lg:hidden">
            <div className="wrap flex flex-col py-2">
              {NAV.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={closeDrawer}
                  className={cx(
                    "flex items-center gap-2 rounded-xl px-2 py-3 text-[15px] font-bold",
                    item.accent ? "text-accent" : "text-ink",
                  )}
                >
                  {item.accent ? <Icon name="sparkle" size={17} /> : null}
                  {item.label}
                </Link>
              ))}
              <Link
                href="/track"
                onClick={closeDrawer}
                className="flex items-center gap-2 rounded-xl border-t border-line px-2 py-3 text-[15px] font-bold text-muted"
              >
                <Icon name="truck" size={17} />
                Track an order
              </Link>
            </div>
          </nav>
        ) : null}
      </header>
    </>
  );
}
