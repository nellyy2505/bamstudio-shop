import { productPhotos } from "@/lib/photos";
import type { Metadata } from "next";
import { BuilderClient } from "./BuilderClient";
import { Icon, Pill } from "@/components/ui";
import { getCollections, getProducts } from "@/lib/queries";
import { PRINT_LEAD_TIME } from "@/lib/config";
import { money } from "@/lib/format";
import {
  charmPrice,
  fromPrice,
  getCharmDiscountCents,
  getLadder,
  maxUnits,
  type Ladder,
} from "@/lib/pricing/builder";
import { selfCanonical } from "../seo";

export const revalidate = 300;

/**
 * The intro's price line, built from the ladder and never typed out.
 *
 * It used to splice in `ladderSentence()`, which reads every step of the ladder
 * aloud ("$3.50 for the first letter, $1 for each one after, and just $0.50 for
 * the last one"). The price table beside the builder already shows each rung,
 * so the intro only needs the honest "from" figure: the cheapest rung, via
 * `fromPrice()`. An empty ladder prints no price at all rather than "$0.00".
 */
function fromLine(ladder: Ladder): string | null {
  const cents = fromPrice(ladder);
  return cents === null ? null : `From ${money(cents)} for one letter.`;
}

export const metadata: Metadata = {
  ...selfCanonical("/builder"),
  title: "Design your own name charm",
  /*
   * NO PRICE IN THIS SENTENCE, deliberately.
   *
   * It used to name the ladder, first as a hardcoded "$3.99 for the first
   * letter, $1.49 for each after" and then built from the constant. Neither
   * works now that the ladder is a row in a table the owner can edit: page
   * metadata is static and is what search results and social previews cache,
   * so a price here is a price that goes stale silently, in the one place
   * nobody looks. The heading below states it, from the database, per request.
   */
  description:
    "Spell a name in 3D-printed letter caps, in the colourway you like. Add " +
    "a matching charm if you want one. Printed to order in Wollongong.",
};

const STEPS = [
  {
    n: "1",
    title: "Printed for you",
    body: "Every letter is printed in your colourway, plus the charm if you add one.",
  },
  {
    n: "2",
    title: "Assembled by hand",
    body: "Threaded on the holder, charm clipped on, every click tested.",
  },
  {
    n: "3",
    title: "Gift-ready",
    body: "Bagged with a backing card. Add a free gift note in your basket.",
  },
];

type SearchParams = Promise<{ product?: string | string[] }>;

export default async function BuilderPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.product)
    ? params.product[0]
    : params.product;

  const [collections, { products }] = await Promise.all([
    getCollections(),
    getProducts({ perPage: 60 }),
  ]);

  // The builder charges a bundle price, but an order line still needs a real
  // product row behind it. More than one product is built here - the name
  // charm and the alphabet bag charm - so `?product=` picks which, and only a
  // builder-mode product is ever accepted (checkout rejects anything else).
  const builderProducts = products.filter(
    (p) => p.personalisation_mode === "builder",
  );
  const anchor =
    builderProducts.find((p) => p.slug === requested) ??
    builderProducts.find((p) => p.slug === "custom-name-charm") ??
    builderProducts[0];

  /*
   * What each colourway's charm costs in the builder, already discounted.
   *
   * Resolved here, on the server, from `collections.charm_slug` and that
   * product's own `price`, so there is one price for a macaron whether it is
   * bought on its own or threaded on the end of a name. A colourway whose charm
   * product is missing or inactive is simply absent from this map, and the
   * builder hides the option rather than offering something it cannot price.
   *
   * `/api/checkout` recomputes the same figure from the same two sources before
   * charging, so this is what the customer is shown, never what they are
   * charged.
   */
  const [ladder, charmDiscount] = await Promise.all([
    getLadder("letter_caps"),
    getCharmDiscountCents(),
  ]);

  const bySlug = new Map(products.map((p) => [p.slug, p] as const));
  const charmPrices: Record<string, number> = {};
  for (const c of collections) {
    const charm = c.charm_slug ? bySlug.get(c.charm_slug) : undefined;
    if (charm) charmPrices[c.slug] = charmPrice(charm.price, charmDiscount);
  }

  // Each colourway's charm as a photo, so the preview shows the real piece.
  const withPhotos = collections.map((c) => {
    const charm = c.charm_slug ? bySlug.get(c.charm_slug) : undefined;
    return { ...c, charm_photo: charm ? (productPhotos(charm)[0]?.thumb ?? null) : null };
  });

  if (!anchor || collections.length === 0) {
    return (
      <div className="wrap py-20 text-center">
        <h1 className="text-2xl">The builder isn&rsquo;t available right now</h1>
        <p className="mt-2 text-muted">Please refresh in a moment.</p>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-line bg-lilac">
        <div className="wrap py-12 text-center">
          <Pill tone="surface" className="text-accent-dark">
            <Icon name="sparkle" size={14} />
            The market-stall favourite, online
          </Pill>
          <h1 className="mt-3.5 mb-2 text-[32px] md:text-[40px]">
            Design your own {anchor.short_name.toLowerCase()}
          </h1>
          <p className="mx-auto max-w-2xl text-[#5F5769] md:text-base">
            {/* The price comes from the ladder in the database (fromLine
                above); the table in the builder shows every rung. */}
            Pick a collection and spell it out. {fromLine(ladder)} Same price in
            every colourway.
          </p>
        </div>
      </div>

      <BuilderClient
        collections={withPhotos}
        anchor={anchor}
        alternatives={builderProducts}
        charmPrices={charmPrices}
        rungs={ladder.rungs}
        maxLetters={maxUnits(ladder)}
        charmDiscount={charmDiscount}
      />

      <section className="wrap pt-16">
        <h2 className="mb-6 text-2xl">How it&rsquo;s made</h2>
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="card p-6">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-cream font-display font-bold">
                {step.n}
              </span>
              <b className="text-[15px]">{step.title}</b>
              <p className="mt-1.5 text-[13.5px] text-muted">{step.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Printed to order in {PRINT_LEAD_TIME.label}. Personalised items are
          returnable only if faulty.
        </p>
      </section>
    </>
  );
}
