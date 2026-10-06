/**
 * Cut-out product photos: the real piece, background removed, lighting evened
 * out, on a transparent ground (public/cutouts/<slug>.webp).
 *
 * They are site artwork rather than catalogue data, which is why they live here
 * keyed by slug instead of in `products.photos`. The catalogue's photos stay
 * the record of what a piece looks like; a cutout is how the shopfront presents
 * it on a coloured tile. A product with no entry simply shows its photos, so a
 * new listing works before anyone has cut it out.
 *
 * Every file here was cut from a photo the owner kept (IMG_1243, the flat row of
 * name charms, is excluded at her request). Do not retouch a piece to change how
 * it looks - if one reads wrong, change the source photo or the display size.
 */

export type Cutout = {
  src: string;
  /** Tile colour behind the cutout. A literal hex so cards can vary per piece. */
  tile: string;
};

const C = (slug: string, tile: string): Cutout => ({ src: `/cutouts/${slug}.webp`, tile });

const BY_SLUG: Record<string, Cutout> = {
  "bakery-box": C("bakery-box", "#F7E6DF"),
  macaron: C("macaron", "#F6E9EC"),
  "matcha-set": C("matcha-set", "#E8EEDD"),
  "custom-name-charm": C("custom-name-charm", "#EFE4D6"),
  "pancake-stack-in-frying-pan": C("pancake-stack-in-frying-pan", "#F6EDD6"),
  "heart-waffle": C("heart-waffle", "#F3EADF"),
  "moon-book-box": C("moon-book-box", "#E3ECF5"),
  "love-cactus-planters": C("love-cactus-planters", "#F6E9EC"),
  "perpetual-desk-calendar": C("perpetual-desk-calendar", "#EEF0EC"),
  "skull-bone-hair-pin": C("skull-bone-hair-pin", "#ECEAE6"),
};

/** The cut-out for a product or filling slug, or null when there is none. */
export function cutoutFor(slug: string | null | undefined): Cutout | null {
  if (!slug) return null;
  if (BY_SLUG[slug]) return BY_SLUG[slug];
  // Listed explicitly, not matched by prefix: a filling added later has no
  // file yet, and a prefix rule would point it at a missing image.
  if (FILLINGS.has(slug)) return C(slug, "#F7E6DF");
  return null;
}

const FILLINGS = new Set([
  "filling-butter-swirl-cookie",
  "filling-chocolate-cruller",
  "filling-chocolate-sprinkle-donut",
  "filling-cookies-and-cream-concha",
  "filling-cream-tart",
  "filling-iced-cinnamon-bun",
  "filling-pink-sprinkle-donut",
  "filling-strawberry-donut",
  "filling-strawberry-drizzle-donut",
  "filling-vanilla-concha",
]);

/** Extra name charms used on the home page band, beside the product's own BAM. */
export const NAME_CHARM_EXTRAS = {
  finn: "/cutouts/name-finn.webp",
  aHeart: "/cutouts/name-a-heart.webp",
} as const;
