import type { Metadata } from "next";
import { BakeryClient } from "./BakeryClient";
import { Icon, Pill } from "@/components/ui";
import {
  getBakeryBoxes,
  getBakeryColours,
  getBakeryDesigns,
  getBakeryFillings,
} from "@/lib/queries";
import { getLadder, priceFor } from "@/lib/pricing/builder";
import { PRINT_LEAD_TIME } from "@/lib/config";
import { selfCanonical } from "../seo";

export const revalidate = 300;

export const metadata: Metadata = {
  ...selfCanonical("/bakery"),
  title: "Design your own bakery box",
  /*
   * No price in this sentence, deliberately, for the reason the letter
   * builder's metadata carries none: page metadata is static and is what search
   * results and social previews cache, so a price here goes stale silently in
   * the one place nobody looks. The page itself states it, from the database.
   */
  description:
    "Pick a box, a design and a colour, then choose every piece that goes in " +
    "it. Miniature cakes and pastries, 3D-printed to order in Wollongong.",
};

export default async function BakeryPage() {
  const [boxes, designs, colours, fillings, ladder] = await Promise.all([
    getBakeryBoxes(),
    getBakeryDesigns(),
    getBakeryColours(),
    getBakeryFillings(),
    getLadder("bakery_box"),
  ]);

  /*
   * A box with no rung is a box that is not on sale, and it is left out here
   * rather than shown at a guessed price.
   *
   * That is the state the 1-piece birthday cake box is in on the day this
   * ships: 0014 priced the four-piece box at the figure the owner named and
   * deliberately did not invent one for the single cake. Extrapolating "one
   * piece is about a quarter" would be inventing a price she never set, on the
   * one product whose whole point is that it is a decorated cake rather than a
   * quarter of a pastry box. It appears the moment she prices it in Settings.
   */
  const sellable = boxes
    .map((box) => ({
      box,
      priceCents: priceFor(ladder, box.bakery_piece_count ?? 0),
    }))
    .flatMap((entry) =>
      entry.priceCents === null
        ? []
        : [{ ...entry, priceCents: entry.priceCents }],
    );

  const missing =
    sellable.length === 0 ||
    designs.length === 0 ||
    colours.length === 0 ||
    fillings.length === 0;

  return (
    <>
      <div className="border-b border-line bg-blush">
        <div className="wrap py-12 text-center">
          <Pill tone="surface" className="text-accent-dark">
            <Icon name="sparkle" size={14} />
            New from the studio
          </Pill>
          <h1 className="mt-3.5 mb-2 text-[32px] md:text-[40px]">
            Design your own bakery box
          </h1>
          <p className="mx-auto max-w-2xl text-[#5F5769] md:text-base">
            Pick your box, its design and its colour, then fill it with whatever
            you like. One price whatever goes in, printed to order in{" "}
            {PRINT_LEAD_TIME.label}.
          </p>
        </div>
      </div>

      {missing ? (
        /*
         * Said plainly rather than rendered as an empty grid. The builder has
         * four moving parts and any one of them being empty makes it unusable,
         * so the page says it is not ready instead of showing a box nobody can
         * fill and a button that cannot work.
         */
        <div className="wrap py-20 text-center">
          <h2 className="text-2xl">The bakery is still being set up</h2>
          <p className="mx-auto mt-2 max-w-lg text-muted">
            The boxes, the designs or the pieces to go in them have not all been
            added yet. It will be here shortly.
          </p>
        </div>
      ) : (
        <BakeryClient boxes={sellable} designs={designs} colours={colours} fillings={fillings} />
      )}
    </>
  );
}
