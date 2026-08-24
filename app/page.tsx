import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { ProductGrid } from "@/components/product/ProductCard";
import { ButtonLink, Icon, Pill, SectionHead } from "@/components/ui";
import { KeycapWord } from "@/components/builder/Keycap";
import { getCollections, getProducts } from "@/lib/queries";
import { PRINT_LEAD_TIME, SHIPPING, SHOP, transitDays } from "@/lib/config";
import { money } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";

export const revalidate = 300;

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
 * Things that are actually true of a pre-revenue, print-to-order shop. No
 * ratings or review counts live here until customers have written some.
 */
const HERO_FACTS = [
  { icon: "pin" as const, label: `Printed to order in ${SHOP.city}` },
  { icon: "heart" as const, label: "Designed by the family" },
  {
    icon: "truck" as const,
    label: `Free shipping over ${money(SHIPPING.freeThreshold)}`,
  },
  { icon: "sparkle" as const, label: "Original designs only" },
];

/** Carrier transit for standard post — quoted separately from printing. */
const [STANDARD_MIN, STANDARD_MAX] = transitDays("standard");

const PROMISES = [
  {
    icon: "box" as const,
    title: "Printed to order",
    body: "Made fresh for every order, checked and packed by hand.",
  },
  {
    icon: "truck" as const,
    title: `Dispatched in ${PRINT_LEAD_TIME.label}`,
    body: `That's printing time, not delivery — standard post adds ${STANDARD_MIN}–${STANDARD_MAX} business days. Free over ${money(SHIPPING.freeThreshold)}.`,
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
  const [{ products: bestsellers }, { products: fresh }, collections] =
    await Promise.all([
      getProducts({ sort: "popular", perPage: 4 }),
      getProducts({ sort: "new", perPage: 4 }),
      getCollections(),
    ]);

  const hero = bestsellers.slice(0, 4);
  const featured = collections.find((c) => c.is_popular) ?? collections[0];

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
