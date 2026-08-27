import type { Metadata } from "next";
import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { ProductGrid } from "@/components/product/ProductCard";
import { ButtonLink, Icon, Pill, SectionHead } from "@/components/ui";
import { KeycapWord } from "@/components/builder/Keycap";
import { ScoopArt } from "@/components/scoop/ScoopArt";
import { getCollections, getProducts, getScoopTiers } from "@/lib/queries";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  SHOP,
  isFreeShipping,
  transitDays,
} from "@/lib/config";
import { money, pluralise } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";
import { selfCanonical } from "./seo";

export const revalidate = 300;

/**
 * Title and description are inherited from the root layout; this exists only
 * to declare the home page's own address. Without it the shop served no
 * rel=canonical anywhere, so `/?utm_source=…` and `/` were two pages.
 */
export const metadata: Metadata = selfCanonical("/");

/** Tailwind scans source statically, so tint classes must appear literally. */
const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

const CATEGORY_TILES: { label: string; art: ArtKey; tint: Tint; href: string }[] =
  [
    { label: "Food", art: "cinnamon", tint: "butter", href: "/shop?theme=Food" },
    { label: "Drinks", art: "coffee", tint: "cream", href: "/shop?theme=Drinks" },
    {
      label: "Plants",
      art: "tulip",
      tint: "sage",
      href: "/shop?theme=Plants+%26+flowers",
    },
    {
      label: "Names",
      art: "letters",
      tint: "lilac",
      href: "/shop?theme=Letters+%26+names",
    },
    { label: "Animals", art: "corgi", tint: "blush", href: "/shop?theme=Animals" },
    { label: "Sport", art: "tennis", tint: "sky", href: "/shop?theme=Sport" },
    {
      label: "Phone & bag",
      art: "stand",
      tint: "cream",
      href: "/shop?category=Phone+%26+bag",
    },
  ];

/**
 * §0.10: free postage is the standard rate only — shippingCost() charges
 * express at every basket size — so nothing here may promise "free shipping"
 * flat. Which method goes free (and which stay paid) is asked of
 * shippingCost() rather than named here, so the copy tracks the pricing.
 */
const FREE_RATE_METHOD = SHIPPING.methods.find(
  (option) => isFreeShipping(SHIPPING.freeThreshold, option.id),
);
const PAID_METHOD_LABELS = SHIPPING.methods
  .filter((option) => option.id !== FREE_RATE_METHOD?.id)
  .map((option) => option.label.toLowerCase())
  .join(" and ");
const PAID_METHOD_COUNT = SHIPPING.methods.length - (FREE_RATE_METHOD ? 1 : 0);

/**
 * Things that are actually true of a pre-revenue, print-to-order shop. No
 * ratings or review counts live here until customers have written some.
 */
const HERO_FACTS = [
  { icon: "pin" as const, label: `Printed to order in ${SHOP.city}` },
  { icon: "heart" as const, label: "Designed by the family" },
  ...(FREE_RATE_METHOD
    ? [
        {
          icon: "truck" as const,
          label: `Free ${FREE_RATE_METHOD.label.toLowerCase()} post from ${money(SHIPPING.freeThreshold)}`,
        },
      ]
    : []),
  { icon: "sparkle" as const, label: "Original designs only" },
];

/** Carrier transit for standard post — quoted separately from printing. */
const [STANDARD_MIN, STANDARD_MAX] = transitDays("standard");

/**
 * Print lead time and carrier transit stay separate here — "2–4 business days"
 * is printing only — and the free rate is named for the method it applies to.
 */
const DELIVERY_PROMISE = FREE_RATE_METHOD
  ? `That's printing time, not delivery — ${FREE_RATE_METHOD.label.toLowerCase()} post adds ${FREE_RATE_METHOD.transitDays[0]}–${FREE_RATE_METHOD.transitDays[1]} business days and is free from ${money(SHIPPING.freeThreshold)}` +
    (PAID_METHOD_COUNT > 0
      ? `; ${PAID_METHOD_LABELS} ${PAID_METHOD_COUNT === 1 ? "is" : "are"} always charged.`
      : ".")
  : `That's printing time, not delivery — standard post adds ${STANDARD_MIN}–${STANDARD_MAX} business days.`;

const PROMISES = [
  {
    icon: "box" as const,
    title: "Printed to order",
    body: "Made fresh for every order, checked and packed by hand.",
  },
  {
    icon: "truck" as const,
    title: `Dispatched in ${PRINT_LEAD_TIME.label}`,
    body: DELIVERY_PROMISE,
  },
  {
    icon: "shield" as const,
    title: "Secure checkout",
    body: "Payments run through Stripe — your card details never touch us.",
  },
  {
    icon: "gift" as const,
    title: "Gift-ready",
    body: "Every order arrives bagged with a backing card. Add a note free.",
  },
];

export default async function HomePage() {
  const [{ products: bestsellers }, { products: fresh }, collections, tiers] =
    await Promise.all([
      getProducts({ sort: "popular", perPage: 4 }),
      getProducts({ sort: "new", perPage: 4 }),
      getCollections(),
      getScoopTiers(),
    ]);

  const hero = bestsellers.slice(0, 4);
  const featured = collections.find((c) => c.is_popular) ?? collections[0];

  /*
   * The Lucky Scoop is advertised here ONLY when there is a tier on sale.
   *
   * `sellable` is the whole gate (lib/scoop.ts) and it now asks two things
   * only: is the tier switched on, and is it priced. A tier nobody has priced
   * is not something to send a shopper to from the home page.
   *
   * IT IS BLIND TO STOCK, deliberately. This comment used to exclude a tier
   * "whose pool cannot currently fill it" as well. That gate existed and the
   * owner removed it: **the shop prints to order**, so a short bowl is a print
   * job she does before packing, never a reason to stop offering a paid
   * product. A scoop follows the same rule as everything else in the catalogue.
   * If you are about to filter this strip on `scoopsAvailable` because a
   * comment somewhere still describes the old behaviour — don't; that number is
   * studio information and lib/scoop.ts records the correction at length.
   * ("Unweighed" has gone from the list for a different reason: a packed weight
   * is required to ACTIVATE a tier, 0007_lucky_scoop.sql, so it sits upstream
   * of `sellable` rather than inside it.)
   *
   * Nothing is seeded, so this is empty on every
   * environment right now and the section below simply does not render — which
   * is the honest answer, not a placeholder. `/scoop` itself stays a real page
   * either way; it is just not promoted from here until it has something to
   * sell.
   */
  const scoopTiers = tiers.filter((tier) => tier.availability.sellable);
  const scoopPrices = scoopTiers
    .map((tier) => tier.price_cents)
    .filter((cents): cents is number => cents !== null);
  const scoopFrom = scoopPrices.length > 0 ? Math.min(...scoopPrices) : null;

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="border-b border-line bg-gradient-to-br from-butter via-blush to-sage">
        <div className="wrap grid items-center gap-10 py-14 lg:grid-cols-2 lg:py-16">
          <div>
            <Pill tone="surface" className="text-accent-dark">
              Handmade in {SHOP.city} · Printed to order
            </Pill>
            <h1 className="mt-4 mb-4 text-[38px] leading-[1.08] font-bold sm:text-[46px] lg:text-[52px]">
              {SHOP.tagline}
            </h1>
            <p className="mb-7 max-w-[460px] text-[17px] text-[#5C564C]">
              Fidget clickers, name charms and desk pieces, 3D-printed just for
              you — from matcha sets to macarons.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <ButtonLink href="/shop" size="lg">
                Shop bestsellers
              </ButtonLink>
              <ButtonLink href="/builder" variant="ghost" size="lg">
                <Icon name="sparkle" size={18} />
                Design your own
              </ButtonLink>
            </div>
            <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-[#5C564C]">
              {HERO_FACTS.map((fact) => (
                <li key={fact.label} className="flex items-center gap-1.5">
                  <Icon
                    name={fact.icon}
                    size={15}
                    className="shrink-0 text-accent-dark"
                  />
                  {fact.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {hero.map((product, i) => (
              <Link
                key={product.id}
                href={`/product/${product.slug}`}
                className={`flex h-[180px] items-center justify-center rounded-[22px] bg-surface shadow-[0_14px_34px_rgba(34,31,26,0.10)] transition-transform hover:-translate-y-1 sm:h-[225px] ${
                  i % 2 === 1 ? "mt-6 sm:mt-8" : ""
                }`}
              >
                <ProductArt art={product.art} size={130} />
                <span className="sr-only">{product.short_name}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- categories */}
      <section className="wrap pt-14">
        <SectionHead title="Shop by category" href="/shop" linkText="All categories" />
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {CATEGORY_TILES.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="flex flex-col items-center gap-2.5"
            >
              <span
                className={`flex aspect-square w-full items-center justify-center rounded-full ${TINT_BG[tile.tint]} transition-transform hover:scale-105`}
              >
                <ProductArt art={tile.art} size={64} />
              </span>
              <span className="text-center text-[13.5px] font-extrabold">
                {tile.label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- bestsellers */}
      <section className="wrap pt-16">
        <SectionHead title="Bestsellers" href="/shop" linkText="Shop all products" />
        <ProductGrid products={bestsellers} />
      </section>

      {/* -------------------------------------------------- builder promo */}
      <section className="wrap pt-16">
        <div className="grid items-center gap-10 rounded-[26px] bg-ink px-8 py-14 text-[#F6F2EA] lg:grid-cols-[1.1fr_1fr] lg:px-16">
          <div>
            <Pill className="bg-[#3B3630] text-[#F3C89B]">
              The market favourite, now online
            </Pill>
            <h2 className="mt-4 mb-3 text-[32px] leading-tight text-[#F6F2EA] lg:text-[38px]">
              Spell it out. Click it together.
            </h2>
            <p className="mb-7 max-w-[420px] text-[#BDB6AA]">
              Pick a collection, spell a name in printed letter caps, and
              we&apos;ll thread it with a matching charm. One flat price by name
              length.
            </p>
            <ButtonLink
              href="/builder"
              className="bg-[#F6F2EA] text-ink hover:bg-white"
            >
              <Icon name="sparkle" size={18} />
              Start designing
            </ButtonLink>
          </div>
          {featured ? (
            <div className="flex flex-col items-center gap-4">
              <KeycapWord word="MIA" collection={featured} size={72} withCharm />
              <span className="text-[12.5px] text-[#948D80]">
                {collections.length} colourway collections · 1–5 letters
              </span>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------------------------------------------- scoop promo */}
      {/*
        The shop's second "not an ordinary product", in the same register as
        Design your own above: one card, one idea, one way in.

        What it may NOT do is sell the surprise on its own. The line that earns
        the click here is the same line that makes the sale honest — every bowl
        lists what it can draw — so it is in the card rather than saved for the
        page. Rendered only when `scoopTiers` has something sellable in it; see
        the gate above.
      */}
      {scoopTiers.length > 0 ? (
        <section className="wrap pt-16">
          <div className="grid items-center gap-10 rounded-[26px] bg-sky px-8 py-14 lg:grid-cols-[1.1fr_1fr] lg:px-16">
            <div>
              <Pill tone="surface" className="text-accent-dark">
                Also from the stall
              </Pill>
              <h2 className="mt-4 mb-3 text-[32px] leading-tight lg:text-[38px]">
                The Lucky Scoop.
              </h2>
              <p className="mb-7 max-w-[440px] text-[#4F5A63]">
                A bowl of little printed pieces. You pick the bowl and how many
                come out of it; we draw them by hand when we pack your order.
                Every bowl lists the whole pool it draws from, so the only
                surprise is which pieces you get.
              </p>
              <ButtonLink href="/scoop" size="lg">
                <Icon name="gift" size={18} />
                See the bowls
              </ButtonLink>
            </div>
            <div className="flex flex-col items-center gap-4">
              <ScoopArt size={150} />
              <span className="text-[12.5px] text-[#5C6670]">
                {pluralise(scoopTiers.length, "bowl")}
                {scoopFrom !== null ? ` · from ${money(scoopFrom)}` : ""}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------------- new in */}
      {fresh.length > 0 ? (
        <section className="wrap pt-16">
          <SectionHead
            title="New this month"
            href="/shop?sort=new"
            linkText="See what's new"
          />
          <ProductGrid products={fresh} />
        </section>
      ) : null}

      {/* ------------------------------------------------------- promises */}
      <section className="wrap pt-16">
        <div className="grid gap-5 border-t border-line pt-9 sm:grid-cols-2 lg:grid-cols-4">
          {PROMISES.map((item) => (
            <div key={item.title} className="flex items-start gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cream">
                <Icon name={item.icon} size={22} />
              </span>
              <div>
                <b className="text-sm">{item.title}</b>
                <p className="mt-0.5 text-[12.5px] text-muted">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
