import type { Metadata } from "next";
import Link from "next/link";
import { ProductArt } from "@/components/ProductArt";
import { Keycap } from "@/components/builder/Keycap";
import { Breadcrumbs, ButtonLink, Icon, Pill, cx } from "@/components/ui";
import { getCollections } from "@/lib/queries";
import { BUILDER_PRICING } from "@/lib/config";
import { money } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Colourway collections",
  description:
    "Six colourways for the DIY name charm — cap, letter and cord colours with a matching food charm.",
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
  const cheapest = Math.min(...Object.values(BUILDER_PRICING));

  return (
    <div className="wrap pt-9">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Collections" }]}
      />

      <h1 className="mb-2 text-3xl md:text-4xl">The colourway collections</h1>
      <p className="mb-8 max-w-2xl text-muted">
        Every collection pairs a cap colour, a letter colour and a holder cord
        with a matching food charm. Same price in every colourway — just pick
        the one that feels like them.
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
                <span className="flex h-[50px] w-[50px] items-center justify-center rounded-xl bg-surface">
                  <ProductArt
                    art={collection.charm_art as ArtKey}
                    size={34}
                  />
                </span>
              </div>

              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[16.5px]">{collection.name}</h2>
                  {collection.is_popular ? (
                    <Pill tone="accent">Most popular</Pill>
                  ) : null}
                </div>
                <p className="mt-1 mb-3.5 text-[13px] text-muted">
                  {collection.charm_name} charm · from {money(cheapest)}
                </p>

                <div className="flex items-center gap-2">
                  {(
                    [
                      ["Cap", collection.cap_colour],
                      ["Letter", collection.letter_colour],
                      ["Cord", collection.holder_colour],
                    ] as const
                  ).map(([label, hex]) => (
                    <span
                      key={label}
                      title={`${label}: ${hex}`}
                      className="h-[22px] w-[22px] rounded-full border border-line2"
                      style={{ background: hex }}
                    >
                      <span className="sr-only">
                        {label} colour {hex}
                      </span>
                    </span>
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
            Caramel and Charcoal are in testing. Join the list and vote for
            which lands first.
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
