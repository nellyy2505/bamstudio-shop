import type { Metadata } from "next";
import { BuilderClient } from "./BuilderClient";
import { Icon, Pill } from "@/components/ui";
import { getCollections, getProducts } from "@/lib/queries";
import { PRINT_LEAD_TIME } from "@/lib/config";
import { selfCanonical } from "../seo";

export const revalidate = 300;

export const metadata: Metadata = {
  ...selfCanonical("/builder"),
  title: "Design your own name charm",
  description:
    "Pick a colourway, spell a name in printed letter caps and add a matching charm. Flat price by name length, made to order in Sydney.",
};

const STEPS = [
  {
    n: "1",
    title: "Printed for you",
    body: "Your letters and charm are printed fresh in your colourway — nothing pre-made.",
  },
  {
    n: "2",
    title: "Assembled by hand",
    body: "Caps are threaded on the holder cord, the charm clipped on, every click tested.",
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
  // product row behind it. More than one product is built here — the name
  // charm and the alphabet bag charm — so `?product=` picks which, and only a
  // builder-mode product is ever accepted (checkout rejects anything else).
  const builderProducts = products.filter(
    (p) => p.personalisation_mode === "builder",
  );
  const anchor =
    builderProducts.find((p) => p.slug === requested) ??
    builderProducts.find((p) => p.slug === "custom-name-charm") ??
    builderProducts[0];

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
            Pick a collection, spell it out, add a charm. Flat price by name
            length — every colourway costs the same.
          </p>
        </div>
      </div>

      <BuilderClient
        collections={collections}
        anchor={anchor}
        alternatives={builderProducts}
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
