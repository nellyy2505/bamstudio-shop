import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { getBakeryFillings, getCollections, getProducts } from "@/lib/queries";
import { fromPrice, getLadder, maxUnits, priceFor } from "@/lib/pricing/builder";
import { NAME_CHARM_EXTRAS, cutoutFor } from "@/lib/cutouts";
import { HomeRange } from "./HomeRange";
import { MiniCakeBox, type MiniFilling } from "./MiniCakeBox";
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

/** Pieces that float on the hero stage, by slug, with where each one sits. */
const STAGE = [
  { slug: "macaron", className: "left-[2%] top-[6%] w-[190px]", tilt: "-6deg", delay: "-1.2s" },
  { slug: "matcha-set", className: "right-0 top-[2%] w-[200px]", tilt: "5deg", delay: "-2.4s" },
  { slug: "heart-waffle", className: "left-0 bottom-[4%] w-[180px]", tilt: "4deg", delay: "-3.6s" },
  { slug: "custom-name-charm", className: "right-[2%] bottom-[8%] w-[210px]", tilt: "-5deg", delay: "-0.6s" },
] as const;

/** Words for the scrolling strip, each with the piece it names. */
const STRIP = [
  ["macaron", "Macarons"],
  ["matcha-set", "Matcha"],
  ["custom-name-charm", "Name charms"],
  ["bakery-box", "Cake boxes"],
  ["pancake-stack-in-frying-pan", "Pancakes"],
  ["perpetual-desk-calendar", "Desk pieces"],
  ["heart-waffle", "Heart waffles"],
  ["moon-book-box", "Moon books"],
  ["filling-vanilla-concha", "Conchas"],
  ["filling-pink-sprinkle-donut", "Donuts"],
] as const;

export default async function HomePage() {
  const [{ products }, fillings, boxLadder, letterLadder, colourways] = await Promise.all([
    getProducts({ sort: "popular", perPage: 24 }),
    getBakeryFillings(),
    getLadder("bakery_box"),
    getLadder("letter_caps"),
    getCollections(),
  ]);

  const box = products.find((p) => p.personalisation_mode === "bakery");
  const boxCapacity = box?.bakery_piece_count ?? 4;
  const boxPrice = priceFor(boxLadder, boxCapacity);
  const lettersFrom = fromPrice(letterLadder);
  const letterMax = maxUnits(letterLadder);
  const cheapest = products.length > 0 ? Math.min(...products.map((p) => p.price)) : null;

  const listed = new Set(products.map((p) => p.slug));
  const stage = STAGE.filter((s) => listed.has(s.slug));
  const strip = STRIP.filter(([slug]) => listed.has(slug) || slug.startsWith("filling-")).flatMap(
    ([slug, word]) => {
      const cut = cutoutFor(slug);
      return cut ? [{ word: word as string, src: cut.src }] : [];
    },
  );

  const miniFillings: MiniFilling[] = fillings.flatMap((f) => {
    const cut = cutoutFor(f.slug);
    return cut ? [{ slug: f.slug, name: f.short_name || f.name, src: cut.src }] : [];
  });

  const tiles = [
    { label: "Keychains", sub: lettersFrom !== null ? `From ${money(lettersFrom)}` : "Shop now", href: "/shop?category=Clicker+keychain", slug: "macaron", bg: "#F6E9EC" },
    { label: "Cake box", sub: "Design your own", href: "/bakery", slug: "bakery-box", bg: "#F7E6DF" },
    { label: "Name charms", sub: "Spell it out", href: "/builder", slug: "custom-name-charm", bg: "#EFE4D6" },
    { label: "Desk & home", sub: "Little luxuries", href: "/shop?category=Desk+%26+home", slug: "moon-book-box", bg: "#E3ECF5" },
  ].filter((t) => listed.has(t.slug) || t.href === "/builder");

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <section className="relative overflow-hidden border-b border-line bg-[#F7E6DF]">
        <div aria-hidden="true" className="bam-dots absolute inset-0 opacity-70" />
        <div className="wrap relative grid items-center gap-6 pt-6 pb-12 lg:grid-cols-[1fr_1.15fr] lg:gap-10 lg:py-20">
          {/* Phone-sized stage: the same pieces, smaller, above the words. */}
          <div className="relative order-first mx-auto h-[300px] w-full max-w-[360px] lg:hidden" aria-hidden="true">
            <div className="absolute top-1/2 left-1/2 h-[250px] w-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FBF6EF]" />
            {box && cutoutFor(box.slug) ? (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                src={cutoutFor(box.slug)!.src}
                alt=""
                className="absolute top-1/2 left-1/2 w-[58%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_18px_18px_rgba(91,58,38,0.28)]"
              />
            ) : null}
            {stage.map((piece, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                key={piece.slug}
                src={cutoutFor(piece.slug)!.src}
                alt=""
                className={`bam-float absolute w-[32%] drop-shadow-[0_10px_10px_rgba(91,58,38,0.22)] ${
                  ["top-[2%] left-0", "top-0 right-0", "bottom-[2%] left-0", "bottom-[4%] right-0"][i]
                }`}
                style={{ ["--tilt" as string]: piece.tilt, animationDelay: piece.delay }}
              />
            ))}
          </div>
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-[13px] font-extrabold text-accent-dark">
              <span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" />
              New: build your own cake box
            </span>
            <h1 className="mt-5 mb-4 text-[48px] leading-[0.98] font-bold tracking-[-0.02em] sm:text-[60px] lg:text-[76px]">
              Tiny treats
              <br />
              that <span className="text-accent">click.</span>
            </h1>
            <p className="mb-8 max-w-[440px] text-[18px] text-[#5C4E45]">
              Keychains, mini cake boxes and desk pieces, printed to order by our
              family in {SHOP.city}.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="#shop"
                className="inline-flex h-14 items-center rounded-full bg-accent px-7 text-[16px] font-extrabold text-white shadow-[0_10px_24px_rgba(184,92,56,0.32)] hover:bg-accent-dark"
              >
                Shop the range
              </Link>
              <Link
                href="/bakery"
                className="inline-flex h-14 items-center rounded-full border-2 border-ink bg-white px-6 text-[16px] font-extrabold hover:bg-cream"
              >
                Build a cake box
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[14px] font-bold text-[#5C4E45]">
              {cheapest !== null ? <li>From {money(cheapest)}</li> : null}
              <li>Printed to order in {PRINT_LEAD_TIME.label}</li>
            </ul>
          </div>

          {/* The stage: real pieces, cut out, drifting. Hidden on small
              screens, where the words and buttons are the whole job. */}
          <div className="relative hidden h-[560px] lg:block" aria-hidden="true">
            <div className="absolute top-1/2 left-1/2 h-[470px] w-[470px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FBF6EF]" />
            <div className="absolute top-1/2 left-1/2 -mt-[270px] -ml-[270px] h-[540px] w-[540px]">
              <div className="bam-spin h-full w-full rounded-full border-2 border-dashed border-[#E3B9AA]" />
            </div>
            {box && cutoutFor(box.slug) ? (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                src={cutoutFor(box.slug)!.src}
                alt=""
                fetchPriority="high"
                className="bam-float absolute top-1/2 left-1/2 -mt-[150px] -ml-[190px] w-[360px] drop-shadow-[0_26px_26px_rgba(91,58,38,0.28)]"
              />
            ) : null}
            {stage.map((piece) => (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                key={piece.slug}
                src={cutoutFor(piece.slug)!.src}
                alt=""
                className={`bam-float absolute ${piece.className} drop-shadow-[0_16px_16px_rgba(91,58,38,0.22)]`}
                style={{ ["--tilt" as string]: piece.tilt, animationDelay: piece.delay }}
              />
            ))}
            {miniFillings.slice(0, 2).map((f, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                key={f.slug}
                src={f.src}
                alt=""
                className={`bam-float absolute drop-shadow-[0_10px_10px_rgba(91,58,38,0.2)] ${i === 0 ? "top-[-2%] left-[44%] w-[74px]" : "bottom-[-2%] left-[30%] w-[64px]"}`}
                style={{ animationDelay: i === 0 ? "-4.4s" : "-2.4s" }}
              />
            ))}
            {boxPrice !== null ? (
              <span className="absolute top-[44%] right-[6%] rotate-[6deg] rounded-full bg-ink px-4 py-2.5 text-[14px] font-extrabold text-white">
                Cake box {money(boxPrice)}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- strip */}
      {strip.length > 0 ? (
        <div className="overflow-hidden bg-ink py-3.5" aria-hidden="true">
          <div className="bam-marquee flex w-max items-center gap-8">
            {[...strip, ...strip].map((s, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-8 font-display text-[22px] font-semibold whitespace-nowrap text-[#F6EFE6]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
                <img src={s.src} alt="" className="h-10 w-10 object-contain" />
                {s.word}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- tiles */}
      <section className="wrap pt-16">
        <div className="grid grid-cols-2 gap-3.5 md:gap-[18px] lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              className="group relative flex h-[170px] flex-col justify-between overflow-hidden rounded-[28px] p-5 md:h-[240px]"
              style={{ background: t.bg }}
            >
              <span className="relative z-10 font-display text-[20px] font-semibold md:text-[24px]">{t.label}</span>
              <span className="relative z-10 text-[14px] font-extrabold">{t.sub} →</span>
              {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
              <img
                src={cutoutFor(t.slug)?.src}
                alt=""
                loading="lazy"
                className="bam-cutout absolute right-[-6px] bottom-12 w-[50%] transition md:bottom-[6px] md:w-[58%] duration-300 group-hover:-translate-y-1.5 group-hover:-rotate-2"
              />
            </Link>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ the range */}
      <section id="shop" className="wrap scroll-mt-24 pt-16 md:pt-20">
        <HomeRange products={products} />
      </section>

      {/* ------------------------------------------------- mini cake box */}
      {box && miniFillings.length > 0 ? (
        <section className="wrap pt-20 md:pt-24">
          <div className="relative overflow-hidden rounded-[36px] bg-[#F7E6DF] p-7 md:p-14">
            <div aria-hidden="true" className="bam-gingham absolute inset-0" />
            <MiniCakeBox
              fillings={miniFillings}
              capacity={boxCapacity}
              price={boxPrice !== null ? money(boxPrice) : null}
            />
          </div>
        </section>
      ) : null}

      {/* --------------------------------------------------- name charms */}
      <section className="wrap pt-8">
        <div className="grid items-center gap-10 overflow-hidden rounded-[36px] bg-ink p-7 text-[#FBF6EF] md:p-14 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-[13px] font-extrabold tracking-[0.12em] text-[#F3C89B] uppercase">
              The market favourite
            </p>
            <h2 className="mb-3.5 text-[34px] leading-[1.02] text-[#FBF6EF] md:text-[44px]">
              Spell it in
              <br />
              clicky keycaps.
            </h2>
            <p className="mb-6 max-w-[420px] text-[17px] text-[#CFC4B8]">
              {letterMax > 0 ? `Up to ${letterMax} letters` : "Your letters"}
              {colourways.length > 0 ? ` in ${colourways.length} colourways` : ""}.
              {lettersFrom !== null ? ` From ${money(lettersFrom)}.` : ""}
            </p>
            {colourways.length > 0 ? (
              <ul className="mb-7 flex flex-wrap gap-2.5">
                {colourways.map((c) => (
                  <li
                    key={c.id}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-[#3A3430] pr-3 pl-1.5 text-[13px] font-bold"
                  >
                    <span
                      aria-hidden="true"
                      className="h-6 w-6 rounded-lg border-[3px]"
                      style={{ background: c.cap_colour, borderColor: c.holder_colour }}
                    />
                    {c.name}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href="/builder"
              className="inline-flex h-14 items-center gap-2 rounded-full bg-[#FBF6EF] px-7 text-[16px] font-extrabold text-ink hover:bg-white"
            >
              <Icon name="sparkle" size={18} />
              Design a name charm
            </Link>
          </div>
          <div className="relative h-[300px] md:h-[380px]" aria-hidden="true">
            {cutoutFor("custom-name-charm") ? (
              // eslint-disable-next-line @next/next/no-img-element -- static site artwork
              <img
                src={cutoutFor("custom-name-charm")!.src}
                alt=""
                loading="lazy"
                className="bam-float absolute top-[2%] left-0 w-[66%] drop-shadow-[0_18px_18px_rgba(0,0,0,0.4)]"
                style={{ ["--tilt" as string]: "-5deg" }}
              />
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
            <img
              src={NAME_CHARM_EXTRAS.finn}
              alt=""
              loading="lazy"
              className="bam-float absolute top-[30%] right-0 w-[56%] drop-shadow-[0_18px_18px_rgba(0,0,0,0.4)]"
              style={{ ["--tilt" as string]: "3deg", animationDelay: "-2.4s" }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
            <img
              src={NAME_CHARM_EXTRAS.aHeart}
              alt=""
              loading="lazy"
              className="bam-float absolute bottom-0 left-[2%] w-[30%] drop-shadow-[0_18px_18px_rgba(0,0,0,0.4)]"
              style={{ ["--tilt" as string]: "-2deg", animationDelay: "-0.6s" }}
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- studio */}
      <section className="wrap pt-20 md:pt-24">
        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr_1fr] md:grid-rows-[250px_250px]">
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/home/flatlay-sm.jpg"
            alt="A desk scattered with keychains and a cake box"
            loading="lazy"
            className="h-[300px] w-full rounded-[28px] object-cover md:row-span-2 md:h-full"
          />
          <div className="flex flex-col justify-center rounded-[28px] bg-sage p-8 md:col-span-2 md:p-9">
            <h2 className="mb-2.5 text-[28px] leading-tight md:text-[34px]">
              Made by a family, one print at a time.
            </h2>
            <p className="mb-4 max-w-[520px] text-[16px] text-[#4F5A46]">
              Every piece is printed to order here in {SHOP.city}, then checked
              and packed by hand.
            </p>
            <Link href="/about" className="font-extrabold text-[#3F5D3A] underline underline-offset-4">
              Our story
            </Link>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/home/letters-tray-sm.jpg"
            alt="Trays of letter keycaps sorted A to Z"
            loading="lazy"
            className="h-[220px] w-full rounded-[28px] object-cover md:h-full"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/moon-book-box/2-sm.jpg"
            alt="Moon book trinket boxes"
            loading="lazy"
            className="h-[220px] w-full rounded-[28px] object-cover md:h-full"
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
