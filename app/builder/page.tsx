import type { Metadata } from "next";
import { BuilderClient } from "./BuilderClient";
import { Icon, Pill } from "@/components/ui";
import { getCollections, getProducts } from "@/lib/queries";
import {
  builderCharmPrice,
  builderLadderSentence,
  PRINT_LEAD_TIME,
} from "@/lib/config";
import { selfCanonical } from "../seo";

export const revalidate = 300;

/** The ladder sentence starts a sentence here and continues one below. */
function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export const metadata: Metadata = {
  ...selfCanonical("/builder"),
  title: "Design your own name charm",
  /*
   * Built from the ladder rather than typed out. This sentence held
   * "$3.99 for the first letter, $1.49 for each after" as a string literal,
   * which is a price in a search result and a social preview that nobody would
   * think to update when the ladder moved. It is also the second copy of a
   * sentence the page heading already computes.
   */
  description: `Pick a colourway and spell a name in printed letter caps. ${capitalise(
    builderLadderSentence(),
  )}, and a matching charm for less than it costs on its own. Made to order in Wollongong.`,
};

const STEPS = [
  {
    n: "1",
    title: "Printed for you",
    body: "Your letters are printed fresh in your colourway, and the charm too if you add one. Nothing pre-made.",
  },
  {
    n: "2",
    title: "Assembled by hand",
    body: "Caps are threaded on the holder cord, any charm clipped on, every click tested.",
  },
  {
    n: "3",
    title: "Gift-ready",
    body: "Bagged with a backing card. Add a free gift note at checkout.",
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
  const bySlug = new Map(products.map((p) => [p.slug, p] as const));
  const charmPrices: Record<string, number> = {};
  for (const c of collections) {
    const charm = c.charm_slug ? bySlug.get(c.charm_slug) : undefined;
    if (charm) charmPrices[c.slug] = builderCharmPrice(charm.price);
  }

  if (!anchor || collections.length === 0) {
    return (
      <div className="wrap py-20 text-center">
        <h1 className="text-2xl">The builder is warming up</h1>
        <p className="mt-2 text-muted">
          Our catalogue is still loading. Please refresh in a moment.
        </p>
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
            {/* One sentence, one source. This used to compute the step from the
                first two rungs of the ladder, which said "for each one after"
                and was true of every step but the last. */}
            Pick a collection and spell it out. {capitalise(builderLadderSentence())},
            and every colourway costs the same. Add the matching charm if you
            want one.
          </p>
        </div>
      </div>

      <BuilderClient
        collections={collections}
        anchor={anchor}
        alternatives={builderProducts}
        charmPrices={charmPrices}
      />

      <section className="wrap pt-16">
        <h2 className="mb-6 text-2xl">How it arrives</h2>
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
          Personalised charms are printed to order in {PRINT_LEAD_TIME.label} and
          can only be returned if faulty.
        </p>
      </section>
    </>
  );
}
