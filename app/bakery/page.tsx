import type { Metadata } from "next";
import { BakeryClient } from "./BakeryClient";
import { money } from "@/lib/format";
import { cutoutFor } from "@/lib/cutouts";
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

type SearchParams = Promise<{ fill?: string | string[] }>;

export default async function BakeryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [boxes, designs, colours, fillings, ladder] = await Promise.all([
    getBakeryBoxes(),
    getBakeryDesigns(),
    getBakeryColours(),
    getBakeryFillings(),
    getLadder("bakery_box"),
  ]);

  /*
   * The home page's mini box hands its picks over as ?fill=a,b,c,d. They are a
   * suggestion only: anything that is not a filling on offer is dropped here,
   * and checkout re-reads and re-prices the whole selection regardless.
   */
  const params = await searchParams;
  const offered = new Set(fillings.map((f) => f.slug));
  const rawFill = Array.isArray(params.fill) ? params.fill[0] : params.fill;
  const initialChosen = (rawFill ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => offered.has(slug))
    .slice(0, 12);

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

  const fromPrice = sellable[0]?.priceCents ?? null;
  const shelf = fillings.filter((f) => cutoutFor(f.slug));

  return (
    <>
      {/*
        * The banner is a still composition: motion is for the home page only.
        * The scene photo carries it, with the steps and the price beside it and
        * a shelf of every pastry underneath.
        */}
      <section className="relative overflow-hidden border-b border-line bg-[#F7E6DF]">
        <div aria-hidden="true" className="bam-gingham absolute inset-0" />
        <div className="wrap relative grid items-center gap-10 pt-10 md:grid-cols-[1fr_1.1fr] md:pt-14">
          <div>
            <p className="mb-2.5 text-[13px] font-extrabold tracking-[0.12em] text-accent-dark uppercase">
              Design your own
            </p>
            <h1 className="mb-4 text-[44px] leading-[0.98] font-bold tracking-[-0.02em] md:text-[64px]">
              The mini
              <br />
              cake box.
            </h1>
            <p className="mb-7 max-w-[420px] text-[17px] text-[#5C4E45]">
              A tiny bakery box that opens and closes, filled with pastries you
              choose.
            </p>
            <ol className="mb-7 flex max-w-[440px] flex-col gap-2.5">
              <li className="flex items-center gap-3.5 rounded-2xl bg-white py-2.5 pr-4 pl-2.5">
                <span className="flex gap-1" aria-hidden="true">
                  {colours.slice(0, 3).map((c) => (
                    <span key={c.id} className="h-7 w-7 rounded-lg" style={{ background: c.hex }} />
                  ))}
                </span>
                <span className="text-[15px] font-extrabold">
                  Pick your box colour
                </span>
              </li>
              <li className="flex items-center gap-3.5 rounded-2xl bg-white py-2.5 pr-4 pl-2.5">
                <span className="flex" aria-hidden="true">
                  {shelf.slice(0, 2).map((f) => (
                    // eslint-disable-next-line @next/next/no-img-element -- static site artwork
                    <img key={f.slug} src={cutoutFor(f.slug)!.src} alt="" className="h-7 w-7 object-contain" />
                  ))}
                </span>
                <span className="text-[15px] font-extrabold">
                  Fill every spot from {fillings.length} pastries
                </span>
              </li>
              <li className="flex items-center gap-3.5 rounded-2xl bg-white py-2.5 pr-4 pl-2.5">
                <span className="rounded-lg bg-ink px-2 py-1 text-[12px] font-extrabold text-white">
                  {PRINT_LEAD_TIME.label}
                </span>
                <span className="text-[15px] font-extrabold">We print it to order</span>
              </li>
            </ol>
            {!missing ? (
              <a
                href="#build"
                className="inline-flex h-14 items-center gap-2 rounded-full bg-accent px-7 text-[16px] font-extrabold text-white shadow-[0_10px_24px_rgba(184,92,56,0.3)] hover:bg-accent-dark"
              >
                Start building
                {fromPrice !== null ? <span className="opacity-85">· {money(fromPrice)}</span> : null}
              </a>
            ) : null}
          </div>

          <div className="relative h-[340px] md:h-[500px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img
              src="/products/bakery-box/3.jpg"
              alt="Brown and pink cake boxes among tiny pastries"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full rounded-[32px] object-cover shadow-[0_24px_50px_rgba(91,58,38,0.18)]"
            />
            {fromPrice !== null ? (
              <span className="absolute top-5 right-5 flex h-[92px] w-[92px] rotate-[8deg] flex-col items-center justify-center rounded-full bg-ink font-display leading-none text-white">
                <span className="text-[28px] font-semibold">{money(fromPrice)}</span>
                <span className="mt-1 text-[12px] font-semibold">
                  any {sellable[0].box.bakery_piece_count}
                </span>
              </span>
            ) : null}
          </div>
        </div>

        {shelf.length > 0 ? (
          <div className="wrap relative mt-10">
            <ul className="grid grid-cols-5 gap-2 rounded-t-[28px] bg-white px-4 py-4 md:grid-cols-10 md:px-6">
              {shelf.map((f) => (
                <li key={f.slug} className="flex flex-col items-center gap-1.5">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
                  <img src={cutoutFor(f.slug)!.src} alt="" loading="lazy" className="h-14 w-14 object-contain md:h-16 md:w-16" />
                  <span className="text-center text-[11px] leading-tight font-extrabold text-[#5C4E45]">
                    {f.short_name || f.name}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

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
        <div id="build" className="scroll-mt-6">
          <BakeryClient
            boxes={sellable}
            designs={designs}
            colours={colours}
            fillings={fillings}
            initialChosen={initialChosen}
          />
        </div>
      )}
    </>
  );
}
