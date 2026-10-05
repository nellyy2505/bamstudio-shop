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
  title: "Design your own cake box",
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
        <div className="wrap grid items-center gap-8 py-10 md:grid-cols-[1.1fr_1fr] md:py-14">
          <div>
            <Pill tone="surface" className="text-accent-dark">
              <Icon name="sparkle" size={14} />
              Design your own
            </Pill>
            <h1 className="mt-3.5 mb-3 text-[32px] leading-tight md:text-[42px]">
              Design your own cake box
            </h1>
            <p className="max-w-xl text-[#5F5769] md:text-base">
              Pick a box colour, then fill each spot with a mini pastry. Doubles
              are welcome. One price whatever goes in, printed in{" "}
              {PRINT_LEAD_TIME.label}.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img
              src="/products/bakery-box/1-sm.jpg"
              alt="Open brown mini cake box holding four pastries"
              className="col-span-2 aspect-[4/3] w-full rounded-[22px] object-cover"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img
              src="/products/bakery-box/2-sm.jpg"
              alt="Brown and pink cake boxes with pastries"
              className="aspect-square w-full rounded-2xl object-cover"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img
              src="/products/bakery-box/3-sm.jpg"
              alt="Cake box filled with four pastries"
              className="aspect-square w-full rounded-2xl object-cover"
            />
          </div>
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
          <h2 className="text-2xl">Cake boxes aren&rsquo;t open yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-muted">
            In the meantime, <a href="/shop" className="font-bold text-accent underline underline-offset-2">shop all</a>.
          </p>
        </div>
      ) : (
        <BakeryClient boxes={sellable} designs={designs} colours={colours} fillings={fillings} />
      )}
    </>
  );
}
