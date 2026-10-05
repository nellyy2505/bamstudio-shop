import type { Metadata } from "next";
import Link from "next/link";
import { Keycap } from "@/components/builder/Keycap";
import { Breadcrumbs, ButtonLink, Icon, Pill, cx } from "@/components/ui";
import { getCollections } from "@/lib/queries";
import { fromPrice, getLadder } from "@/lib/pricing/builder";
import { money } from "@/lib/format";
import type { Tint } from "@/lib/types";
import { selfCanonical } from "../seo";

export const revalidate = 300;

export const metadata: Metadata = {
  ...selfCanonical("/collections"),
  title: "Colourway collections",
  description:
    "Colourway collections for the DIY name charm, each with matching caps, letters and a charm.",
};

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

export default async function CollectionsPage() {
  const collections = await getCollections();
  // Read, not computed from a constant. This line and the price on a builder
  // product's own card are the two places that advertise the same figure, and
  // they disagreed for a day because one was derived and the other was a copy
  // seeded into products.price.
  const cheapest = fromPrice(await getLadder("letter_caps"));

  return (
    <div className="wrap pt-9">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Collections" }]}
      />

      <h1 className="mb-2 text-3xl md:text-4xl">The colourway collections</h1>
      <p className="mb-8 max-w-2xl text-muted">
        Matching caps and letters, plus a charm to match. Same price
        in every colourway.
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {collections.map((collection) => {
          const preview = collection.name
            .split(" ")[0]
            .slice(0, 4)
            .toUpperCase()
            .split("");

          return (
            <article key={collection.slug} className="card overflow-hidden">
              <div
                className={cx(
                  "flex flex-wrap items-center justify-center gap-2 px-5 py-8",
                  TINT_BG[collection.tint],
                )}
              >
                {preview.map((letter, i) => (
                  <Keycap
                    key={`${letter}-${i}`}
                    letter={letter}
                    collection={collection}
                    size={50}
                  />
                ))}
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[16.5px]">{collection.name}</h2>
                  {collection.is_popular ? (
                    <Pill tone="accent">Most popular</Pill>
                  ) : null}
                </div>
                <p className="mt-1 mb-3.5 text-[13px] text-muted">
                  {/* No "from" clause at all when the ladder is empty, rather
                      than "from $0.00", which is a claim that it is free. */}
                  {collection.charm_name} charm
                  {cheapest === null ? null : <> · from {money(cheapest)}</>}
                </p>

                <div className="flex items-center gap-2">
                  {(
                    [
                      ["Cap", collection.cap_colour],
                      ["Letter", collection.letter_colour],
                      ["Cord", collection.holder_colour],
                    ] as const
                  ).map(([label, hex]) => (
                    // Swatch only: the hex is internal data and is never shown
                    // to customers, as text, tooltip or screen-reader label.
                    <span
                      key={label}
                      role="img"
                      aria-label={`${label} colour`}
                      title={`${label} colour`}
                      className="h-[22px] w-[22px] rounded-full border border-line2"
                      style={{ background: hex }}
                    />
                  ))}
                  <Link
                    href="/builder"
                    className="ml-auto flex items-center gap-1.5 text-[13.5px] font-extrabold text-accent underline underline-offset-2"
                  >
                    Design in {collection.name.split(" ")[0]}
                    <Icon name="arrow" size={14} />
                  </Link>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="card mt-8 flex flex-col items-center gap-5 bg-cream p-7 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <b className="text-base">Two more colourways are brewing</b>
          <p className="mt-1 text-[13.5px] text-muted">
            Caramel and Charcoal are in testing.
          </p>
        </div>
        <ButtonLink href="/builder" variant="ghost" size="sm">
          <Icon name="sparkle" size={16} />
          Start designing
        </ButtonLink>
      </div>
    </div>
  );
}
