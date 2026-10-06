"use client";

import { useMemo, useState } from "react";
import { ProductArt } from "@/components/ProductArt";
import { photoUrl, productPhotos, thumbFor } from "@/lib/photos";
import { cutoutFor } from "@/lib/cutouts";
import { Button, Icon, Pill, cx } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import { fillingQuantities } from "@/lib/bakery";
import { money } from "@/lib/format";
import type { BakeryColour, BakeryDesign, BakeryFilling } from "@/lib/queries";
import type { ArtKey, Product, Tint } from "@/lib/types";

/**
 * Design your own bakery box.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN IS AND IS NOT ALLOWED TO DECIDE.
 *
 * It decides nothing. Every price it shows comes from a rung the server read
 * out of `builder_pricing`, and every design, colour and piece it offers was
 * read from the database on the request that rendered it. What the basket sends
 * to /api/checkout is a SELECTION - a design slug, a colour id and a list of
 * filling slugs - and checkout looks all of it up again and prices the box
 * itself. A tampered payload buys nothing it should not.
 *
 * ONE PRICE WHATEVER GOES IN. That is the owner's decision, and it is what makes
 * this screen simple: there is no running total to recompute as pieces change,
 * only a count of how many slots are still empty. It is also why the studio
 * carries the difference between a cheap box and a dear one, which is written
 * down where it belongs, in lib/bakery.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type SellableBox = { box: Product; priceCents: number };

export function BakeryClient({
  boxes,
  designs,
  colours,
  fillings,
  initialChosen = [],
}: {
  boxes: SellableBox[];
  designs: BakeryDesign[];
  colours: BakeryColour[];
  fillings: BakeryFilling[];
  /** Pieces picked in the home page's mini box, already checked by the page. */
  initialChosen?: string[];
}) {
  const { add } = useCart();

  const [boxSlug, setBoxSlug] = useState(boxes[0].box.slug);
  const [designSlug, setDesignSlug] = useState(designs[0].slug);
  const [colourId, setColourId] = useState(colours[0].id);
  /** Chosen pieces, in the order they were placed. Duplicates are allowed. */
  const [chosen, setChosen] = useState<string[]>(() =>
    initialChosen.slice(0, boxes[0].box.bakery_piece_count ?? 0),
  );
  const [added, setAdded] = useState(false);

  const selected = boxes.find((b) => b.box.slug === boxSlug) ?? boxes[0];
  const capacity = selected.box.bakery_piece_count ?? 0;
  const design = designs.find((d) => d.slug === designSlug) ?? designs[0];
  const colour = colours.find((c) => c.id === colourId) ?? colours[0];

  const bySlug = useMemo(
    () => new Map(fillings.map((f) => [f.slug, f])),
    [fillings],
  );

  const remaining = capacity - chosen.length;
  const full = remaining <= 0;

  /*
   * Switching box changes how many pieces fit, so anything past the new
   * capacity is dropped rather than silently carried and then rejected at
   * checkout. Truncating keeps what was picked first, which is the half the
   * shopper is least likely to have changed their mind about.
   */
  function chooseBox(slug: string) {
    const next = boxes.find((b) => b.box.slug === slug);
    if (!next) return;
    setBoxSlug(slug);
    const room = next.box.bakery_piece_count ?? 0;
    setChosen((current) => current.slice(0, room));
  }

  function addPiece(slug: string) {
    if (full) return;
    setChosen((current) => [...current, slug]);
  }

  /** Removes ONE, by position, so a box holding three of something loses one. */
  function removeAt(index: number) {
    setChosen((current) => current.filter((_, i) => i !== index));
  }

  function addToBasket() {
    if (!full) return;

    add({
      product_id: selected.box.id,
      slug: selected.box.slug,
      name: selected.box.short_name || selected.box.name,
      art: selected.box.art as ArtKey,
      photo: productPhotos(selected.box)[0]?.thumb ?? null,
      tint: selected.box.tint as Tint,
      colour: colour.name,
      attachment_id: null,
      attachment_label: null,
      unit_price: selected.priceCents,
      quantity: 1,
      is_personalised: true,
      bakery: {
        design: design.slug,
        colour_id: colour.id,
        fillings: chosen,
      },
    });

    setAdded(true);
    setChosen([]);
    setTimeout(() => setAdded(false), 2200);
  }

  return (
    <div className="wrap grid items-start gap-8 pt-10 pb-16 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-8">
        {boxes.length > 1 ? (
          <Section title="Your box">
            <div className="flex flex-wrap gap-2.5">
              {boxes.map(({ box, priceCents }) => (
                <button
                  key={box.slug}
                  type="button"
                  onClick={() => chooseBox(box.slug)}
                  aria-pressed={box.slug === boxSlug}
                  className={cx(
                    "rounded-xl border px-4 py-3 text-left",
                    box.slug === boxSlug
                      ? "border-accent bg-accent-soft"
                      : "border-line hover:border-line2",
                  )}
                >
                  <div className="text-[14.5px] font-extrabold">
                    {box.short_name || box.name}
                  </div>
                  <div className="text-[13px] text-muted">
                    {box.bakery_piece_count}{" "}
                    {box.bakery_piece_count === 1 ? "piece" : "pieces"} ·{" "}
                    {money(priceCents)}
                  </div>
                </button>
              ))}
            </div>
          </Section>
        ) : null}

        <Section title="Design" note="The lid. Every design comes in every colour.">
          <div className="flex flex-wrap gap-2.5">
            {designs.map((option) => (
              <button
                key={option.slug}
                type="button"
                onClick={() => setDesignSlug(option.slug)}
                aria-pressed={option.slug === designSlug}
                className={cx(
                  "rounded-xl border px-4 py-3 text-left",
                  option.slug === designSlug
                    ? "border-accent bg-accent-soft"
                    : "border-line hover:border-line2",
                )}
              >
                <div className="flex items-center gap-2 text-[14.5px] font-extrabold">
                  {option.name}
                  {option.has_window ? <Pill tone="line">window</Pill> : null}
                </div>
                {option.blurb ? (
                  <div className="max-w-[220px] text-[13px] text-muted">
                    {option.blurb}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Colour">
          <div className="flex flex-wrap gap-2">
            {colours.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setColourId(option.id)}
                aria-pressed={option.id === colourId}
                aria-label={option.name}
                title={option.name}
                className={cx(
                  "flex items-center gap-2 rounded-xl border py-2 pr-3.5 pl-2",
                  option.id === colourId
                    ? "border-accent bg-accent-soft"
                    : "border-line hover:border-line2",
                )}
              >
                <span
                  className="h-6 w-6 shrink-0 rounded-full border border-line2"
                  style={{ background: option.hex }}
                  aria-hidden="true"
                />
                <span className="text-[13.5px] font-semibold">{option.name}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section
          title="Fill your box"
          note={
            full
              ? "Your box is full. Take one out to swap it."
              : `${remaining} ${remaining === 1 ? "space" : "spaces"} left. Doubles are fine.`
          }
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {fillings.map((filling) => (
              <button
                key={filling.slug}
                type="button"
                onClick={() => addPiece(filling.slug)}
                disabled={full}
                className={cx(
                  "card flex flex-col items-center gap-2 p-3 text-center",
                  full
                    ? "cursor-not-allowed opacity-45"
                    : "hover:border-accent hover:shadow-sm",
                )}
              >
                <FillingImage filling={filling} className="h-24 w-24" />
                <span className="text-[13px] font-semibold">
                  {filling.short_name || filling.name}
                </span>
              </button>
            ))}
          </div>
        </Section>
      </div>

      <aside className="card flex flex-col gap-4 p-5 lg:sticky lg:top-6">
        <div>
          <div className="font-display text-[19px] font-semibold">
            {selected.box.short_name || selected.box.name}
          </div>
          <div className="text-[13.5px] text-muted">
            {design.name} · {colour.name}
          </div>
        </div>

        {/* One slot per piece, filled in order, so the box on screen matches the
            box that gets packed. An empty slot is a visible hole rather than an
            absence, because "you have picked 2 of 4" is easy to miss. */}
        <div
          className={cx(
            "grid gap-2",
            capacity === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {Array.from({ length: capacity }, (_, index) => {
            const slug = chosen[index];
            const filling = slug ? bySlug.get(slug) : undefined;

            return (
              <div
                key={index}
                className={cx(
                  "flex aspect-square items-center justify-center rounded-xl border",
                  filling ? "border-line bg-cream" : "border-dashed border-line2",
                )}
              >
                {filling ? (
                  <button
                    type="button"
                    onClick={() => removeAt(index)}
                    aria-label={`Take out ${filling.short_name || filling.name}`}
                    className="group flex h-full w-full flex-col items-center justify-center gap-1"
                  >
                    <FillingImage filling={filling} className="h-[70%] w-[70%]" />
                    <span className="flex items-center gap-1 text-[11.5px] text-muted group-hover:text-accent">
                      <Icon name="minus" size={12} />
                      take out
                    </span>
                  </button>
                ) : (
                  <span className="text-[12px] text-faint">empty</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-muted">One price, whatever goes in</span>
          <span className="font-display text-[24px] font-semibold tabular-nums">
            {money(selected.priceCents)}
          </span>
        </div>

        <Button onClick={addToBasket} disabled={!full} size="lg">
          {full ? "Add to basket" : `Pick ${remaining} more`}
        </Button>

        {added ? (
          <p className="text-center text-[13.5px] font-semibold text-accent">
            Added to your basket.
          </p>
        ) : null}

        {chosen.length > 0 ? (
          <p className="text-[12.5px] text-muted">
            {[...fillingQuantities(chosen.map((s) => bySlug.get(s)?.short_name ?? s)).entries()]
              .map(([name, n]) => (n > 1 ? `${n} × ${name}` : name))
              .join(", ")}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[19px]">{title}</h2>
      {note ? <p className="mt-0.5 mb-3 text-[13.5px] text-muted">{note}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

/** A filling's cut-out, else its photo, else its drawing. */
function FillingImage({ filling, className }: { filling: BakeryFilling; className?: string }) {
  const cutout = cutoutFor(filling.slug);
  if (cutout) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static site artwork
      <img src={cutout.src} alt="" loading="lazy" className={cx("object-contain", className)} />
    );
  }
  const path = filling.photos?.[0]?.path;
  const src = path ? photoUrl(path) : null;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static site photo or storage, not a next/image loader
      <img
        src={thumbFor(src)}
        alt=""
        loading="lazy"
        className={cx("rounded-full object-cover", className)}
      />
    );
  }
  return <ProductArt art={filling.art as ArtKey} className={className} />;
}
