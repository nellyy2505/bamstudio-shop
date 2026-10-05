import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductCard";
import { ButtonLink, Icon, Pill, SectionHead } from "@/components/ui";
import { getBakeryFillings, getProducts } from "@/lib/queries";
import { getLadder, priceFor } from "@/lib/pricing/builder";
import { photoUrl, thumbFor } from "@/lib/photos";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  SHOP,
  isFreeShipping,
  transitDays,
} from "@/lib/config";
import { money } from "@/lib/format";
import { selfCanonical } from "./seo";

export const revalidate = 300;

/**
 * Title and description are inherited from the root layout; this exists only
 * to declare the home page's own address. Without it the shop served no
 * rel=canonical anywhere, so `/?utm_source=…` and `/` were two pages.
 */
export const metadata: Metadata = selfCanonical("/");

/**
 * §0.10: free postage is the standard rate only - shippingCost() charges
 * express at every basket size - so nothing here may promise "free shipping"
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
          label: `Free ${FREE_RATE_METHOD.label.toLowerCase()} post from ${money(SHIPPING.freeThreshold)}, half from ${money(SHIPPING.subsidyThreshold)}`,
        },
      ]
    : []),
  { icon: "sparkle" as const, label: "Original designs only" },
];

/** Carrier transit for standard post - quoted separately from printing. */
const [STANDARD_MIN, STANDARD_MAX] = transitDays("standard");

/**
 * Print lead time and carrier transit stay separate here - "2–4 business days"
 * is printing only - and the free rate is named for the method it applies to.
 */
const DELIVERY_PROMISE = FREE_RATE_METHOD
  ? `Printed in ${PRINT_LEAD_TIME.label}, then ${FREE_RATE_METHOD.transitDays[0]}–${FREE_RATE_METHOD.transitDays[1]} business days by ${FREE_RATE_METHOD.label.toLowerCase()} post. Half-price from ${money(SHIPPING.subsidyThreshold)}, free from ${money(SHIPPING.freeThreshold)}` +
    (PAID_METHOD_COUNT > 0
      ? ` (${PAID_METHOD_LABELS} always charged).`
      : ".")
  : `Printed in ${PRINT_LEAD_TIME.label}, then ${STANDARD_MIN}–${STANDARD_MAX} business days by standard post.`;

const PROMISES = [
  {
    icon: "box" as const,
    title: "Printed to order",
    body: "Made fresh for you, checked and packed by hand.",
  },
  {
    icon: "truck" as const,
    title: "Australia Post delivery",
    body: DELIVERY_PROMISE,
  },
  {
    icon: "shield" as const,
    title: "Secure checkout",
    body: "Payments run through Stripe. We never see your card details.",
  },
  {
    icon: "gift" as const,
    title: "Gift-ready",
    body: "Every order arrives bagged with a backing card. Add a note free.",
  },
];

export default async function HomePage() {
  const [{ products }, fillings, boxLadder] = await Promise.all([
    getProducts({ sort: "popular", perPage: 24 }),
    getBakeryFillings(),
    getLadder("bakery_box"),
  ]);
  const boxPrice = priceFor(boxLadder, 4);
  // The cake box has its own section below, so it is not repeated in a grid.
  const keychains = products.filter((p) => p.category === "Clicker keychain");
  const others = products.filter(
    (p) => p.category !== "Clicker keychain" && p.personalisation_mode !== "bakery",
  );
  const fillingPhotos = fillings
    .map((f) => {
      const path = f.photos?.[0]?.path;
      const src = path ? photoUrl(path) : null;
      return src ? { src: thumbFor(src), name: f.short_name || f.name } : null;
    })
    .filter((f): f is { src: string; name: string } => f !== null)
    .slice(0, 6);

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="border-b border-line bg-[#F7EFE6]">
        <div className="wrap grid items-center gap-10 py-12 lg:grid-cols-[1fr_1.1fr] lg:py-16">
          <div>
            <Pill tone="surface" className="text-accent-dark">
              Handmade in {SHOP.city} · Printed to order
            </Pill>
            <h1 className="mt-4 mb-4 text-[38px] leading-[1.08] font-bold sm:text-[46px] lg:text-[52px]">
              {SHOP.tagline}
            </h1>
            <p className="mb-7 max-w-[460px] text-[17px] text-[#5C564C]">
              Clicky keychains, mini cake boxes and desk pieces, designed by our
              family and printed for you.
            </p>
            <div className="flex flex-wrap gap-3.5">
              <ButtonLink href="#shop" size="lg">
                Shop the range
              </ButtonLink>
              <ButtonLink href="/bakery" variant="ghost" size="lg">
                <Icon name="sparkle" size={18} />
                Design a cake box
              </ButtonLink>
            </div>
            <ul className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-[#5C564C]">
              {HERO_FACTS.map((fact) => (
                <li key={fact.label} className="flex items-center gap-1.5">
                  <Icon name={fact.icon} size={15} className="shrink-0 text-accent-dark" />
                  {fact.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-[1.35fr_1fr] gap-3 sm:gap-4">
            <Link href="/bakery" className="row-span-2 overflow-hidden rounded-[22px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
              <img
                src="/products/bakery-box/1.jpg"
                alt="Open mini cake box holding four pastries"
                fetchPriority="high"
                className="h-full w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
              />
            </Link>
            <Link href="/product/macaron" className="overflow-hidden rounded-[22px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
              <img
                src="/products/macaron/1-sm.jpg"
                alt="Macaron keychains"
                className="aspect-square w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
              />
            </Link>
            <Link href="/product/love-cactus-planters" className="overflow-hidden rounded-[22px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
              <img
                src="/products/love-cactus-planters/1-sm.jpg"
                alt="LOVE cactus planters"
                className="aspect-square w-full object-cover transition-transform duration-500 hover:scale-[1.03]"
              />
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ the range */}
      <section id="shop" className="wrap scroll-mt-24 pt-14">
        <SectionHead
          title="Clicky keychains"
          href="/shop?category=Clicker+keychain"
          linkText="See all"
        />
        <ProductGrid products={keychains} columns={keychains.length === 5 ? 5 : 4} />
      </section>

      {/* ------------------------------------------------- cake box promo */}
      <section className="wrap pt-16">
        <div className="grid items-center gap-8 overflow-hidden rounded-[26px] bg-blush lg:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/bakery-box/2-sm.jpg"
            alt="Brown and pink mini cake boxes surrounded by tiny pastries"
            loading="lazy"
            className="aspect-square h-full w-full object-cover lg:aspect-auto"
          />
          <div className="px-7 pb-10 lg:py-12 lg:pr-14 lg:pl-2">
            <Pill tone="surface" className="text-accent-dark">
              <Icon name="sparkle" size={14} />
              Design your own
            </Pill>
            <h2 className="mt-4 mb-3 text-[30px] leading-tight lg:text-[36px]">
              Build your own cake box
            </h2>
            <p className="mb-6 max-w-[440px] text-[#5F5769]">
              Choose a brown or pink box, then fill all four spots with mini
              donuts, conchas and tarts.
              {boxPrice !== null ? ` ${money(boxPrice)} whatever you pick.` : ""}
            </p>
            {fillingPhotos.length > 0 ? (
              <div className="mb-7 flex flex-wrap gap-2.5">
                {fillingPhotos.map((f) => (
                  // eslint-disable-next-line @next/next/no-img-element -- static site photo
                  <img
                    key={f.src}
                    src={f.src}
                    alt={f.name}
                    title={f.name}
                    loading="lazy"
                    className="h-14 w-14 rounded-full border-2 border-white object-cover shadow-sm"
                  />
                ))}
              </div>
            ) : null}
            <ButtonLink href="/bakery" size="lg">
              Build your box
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ desk and more */}
      {others.length > 0 ? (
        <section className="wrap pt-16 pb-6">
          <SectionHead title="For your desk and more" href="/shop" linkText="Shop all" />
          <ProductGrid products={others} columns={others.length === 3 ? 3 : 4} />
        </section>
      ) : null}

      {/* -------------------------------------------------- builder promo */}
      <section className="wrap pt-10">
        <div className="grid items-center gap-8 overflow-hidden rounded-[26px] bg-ink text-[#F6F2EA] lg:grid-cols-2">
          <div className="order-2 px-7 pb-10 lg:order-1 lg:py-12 lg:pl-14">
            <Pill className="bg-[#3B3630] text-[#F3C89B]">The market favourite</Pill>
            <h2 className="mt-4 mb-3 text-[30px] leading-tight text-[#F6F2EA] lg:text-[36px]">
              Spell it out in keycaps
            </h2>
            <p className="mb-7 max-w-[420px] text-[#BDB6AA]">
              Pick a colourway and spell a name, initials or a little word, up to
              five letters. Every colourway costs the same.
            </p>
            <ButtonLink href="/builder" className="bg-[#F6F2EA] text-ink hover:bg-white">
              <Icon name="sparkle" size={18} />
              Design a name charm
            </ButtonLink>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/custom-name-charm/1-sm.jpg"
            alt="Name keychains spelling BAM, FINN, CS and XO"
            loading="lazy"
            className="order-1 aspect-square h-full w-full object-cover lg:order-2 lg:aspect-auto"
          />
        </div>
      </section>

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
