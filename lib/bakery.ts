/**
 * A bakery box as a *line* - in a basket, on a Stripe session, and in
 * `order_items`.
 *
 * Pure: no Supabase, no Stripe, no `next/*`, so the builder UI, the checkout
 * route, the postage quote and the Stripe webhook can all import it without
 * dragging server-only code across a boundary. Same reason lib/scoop-line.ts is
 * pure, and this is deliberately its counterpart.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE FACT EVERYTHING BELOW IS DERIVED FROM, AND IT IS THE OPPOSITE OF A
 * SCOOP'S.
 *
 * A BOX IS SOLD WITH ITS CONTENTS ALREADY DECIDED. The customer chose the four
 * pieces before paying, so unlike a scoop a box line:
 *
 *   * knows exactly which products are in it, and says so in
 *     `order_items.personalisation`, which is what the packing slip reads;
 *   * has a knowable cost at the moment of sale - the sum of four measured
 *     pieces - rather than a null that waits for somebody to record a pack;
 *   * MOVES STOCK WHEN THE MONEY MOVES, one decrement per filling. The webhook
 *     skips any line carrying personalisation, which is right for the letter
 *     builder (letters are not products) and would be silently wrong here, so
 *     that rule has an explicit exception rather than an accidental one.
 *
 * The box product itself never moves stock. It is a container that is printed
 * with the order, and counting it would be counting a thing that is not on a
 * shelf.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * ONE PRICE WHATEVER GOES IN. The price is the `bakery_box` rung matching the
 * box's piece count, and the fillings do not move it. That is the owner's
 * decision and it is worth stating where somebody will read it: the studio
 * carries the difference between a box of four cheap pieces and a box of four
 * dear ones, so the box has to be priced against the DEAREST plausible
 * combination and not the average one. Nothing in this file enforces that;
 * `costOfFillings` exists so the Studio can show what a given box actually
 * cost, and so that gap is measurable rather than assumed.
 */

/** What the customer chose. The shape stored in `order_items.personalisation`. */
export type BakerySelection = {
  /**
   * Tags the blob so a reader can tell a box from a letter build without
   * guessing from which keys are present. The letter builder predates this and
   * carries no `kind`, so an absent kind means "letters".
   */
  kind: "bakery";
  /** `bakery_box_designs.slug`. */
  design: string;
  /** `colours.id`. The name and hex are looked up; never copied in here. */
  colour_id: string;
  /** Filling product slugs, in the order the customer placed them. */
  fillings: string[];
};

export type BakeryBoxSpec = {
  /** The box product's slug. */
  slug: string;
  /** How many pieces it holds. `products.bakery_piece_count`. */
  pieceCount: number;
};

/* ------------------------------------------------------------- recognising */

/**
 * The filling slugs on an `order_items.personalisation` blob, or an empty array
 * for anything that is not a bakery box.
 *
 * ONE PARSER, not one per reader. Three things downstream need to know whether a
 * line is a box and what is in it - the webhook that moves stock, the print
 * queue that counts demand, and the pick list that tells the bench what to make
 * - and a second copy of "is `kind` the string bakery, is `fillings` an array"
 * is a copy that gets fixed in one place and not the others.
 *
 * `personalisation` is `unknown` out of the database and holds three different
 * shapes: a box, a letter build, and `{ text }`. The letter builder predates the
 * `kind` tag, so an untagged blob is a letter build and this correctly answers
 * nothing for it.
 */
export function fillingSlugsOf(personalisation: unknown): string[] {
  if (!personalisation || typeof personalisation !== "object") return [];
  if (Array.isArray(personalisation)) return [];

  const blob = personalisation as Record<string, unknown>;
  if (blob.kind !== "bakery") return [];
  if (!Array.isArray(blob.fillings)) return [];

  return blob.fillings.filter((slug): slug is string => typeof slug === "string");
}

/** Whether this line is a bakery box at all, contents or not. */
export function isBakeryLine(personalisation: unknown): boolean {
  return (
    Boolean(personalisation) &&
    typeof personalisation === "object" &&
    !Array.isArray(personalisation) &&
    (personalisation as Record<string, unknown>).kind === "bakery"
  );
}

/* -------------------------------------------------------------- validating */

export type BakeryProblem =
  | { code: "wrong_count"; wanted: number; got: number }
  | { code: "unknown_design" }
  | { code: "unknown_colour" }
  | { code: "unknown_filling"; slug: string }
  | { code: "not_priced" };

/**
 * Is this selection something the shop will actually sell?
 *
 * Called on the server before charging, with the sets read from the database at
 * that moment - never with lists the client sent. A design or a filling that
 * was withdrawn while somebody had the builder open has to fail here, because
 * this is the last point before money moves.
 *
 * DUPLICATE FILLINGS ARE ALLOWED, by decision: a box of four identical macarons
 * is a thing people want. The consequence is that the dearest single piece,
 * times four, is the worst case a flat price has to cover, and it is the box a
 * customer optimising for value will build.
 */
export function validateSelection(
  selection: BakerySelection,
  box: BakeryBoxSpec,
  available: {
    designSlugs: ReadonlySet<string>;
    colourIds: ReadonlySet<string>;
    fillingSlugs: ReadonlySet<string>;
    /** Null when no rung matches this box's piece count. */
    priceCents: number | null;
  },
): BakeryProblem[] {
  const problems: BakeryProblem[] = [];

  if (selection.fillings.length !== box.pieceCount) {
    problems.push({
      code: "wrong_count",
      wanted: box.pieceCount,
      got: selection.fillings.length,
    });
  }
  if (!available.designSlugs.has(selection.design)) {
    problems.push({ code: "unknown_design" });
  }
  if (!available.colourIds.has(selection.colour_id)) {
    problems.push({ code: "unknown_colour" });
  }
  for (const slug of selection.fillings) {
    if (!available.fillingSlugs.has(slug)) {
      problems.push({ code: "unknown_filling", slug });
    }
  }
  if (available.priceCents === null) problems.push({ code: "not_priced" });

  return problems;
}

/** The problem, in the customer's words. */
export function describeProblem(problem: BakeryProblem): string {
  switch (problem.code) {
    case "wrong_count":
      return problem.got < problem.wanted
        ? `This box holds ${problem.wanted}. Pick ${problem.wanted - problem.got} more.`
        : `This box holds ${problem.wanted}, and you have picked ${problem.got}.`;
    case "unknown_design":
      return "That box design is no longer available. Pick another one.";
    case "unknown_colour":
      return "That colour is no longer available. Pick another one.";
    case "unknown_filling":
      return "One of the pieces you picked has sold out of the range. Swap it and try again.";
    case "not_priced":
      // The honest wording for an absent rung. It is not "sold out", the shop
      // has simply never set a price for a box this size.
      return "This box is not on sale at the moment.";
  }
}

/* ---------------------------------------------------------------- costing */

/**
 * What the pieces in a box cost to make, in cents, or null when any of them has
 * never been measured.
 *
 * Null rather than a partial sum, for the reason `unitCostsAtSale` returns null
 * for an unmeasured product: a box costed from three of its four pieces is a
 * flattering number that looks like a real one. The Studio would rather say
 * "one of these has not been measured" than report a margin that is wrong in a
 * direction nobody can see.
 *
 * The box product's own making cost is added by the caller if it has one; this
 * function answers only for the contents.
 */
export function costOfFillings(
  fillings: string[],
  costBySlug: ReadonlyMap<string, number | null>,
): number | null {
  let total = 0;
  for (const slug of fillings) {
    const cost = costBySlug.get(slug);
    if (cost === null || cost === undefined) return null;
    total += cost;
  }
  return total;
}

/**
 * How many of each filling a box needs, for the stock decrement and the pick
 * list.
 *
 * Counted rather than iterated one at a time, because duplicates are allowed:
 * four of the same macaron is one product times four, and `decrement_stock`
 * takes a quantity. Calling it four times would work and would also record four
 * separate oversell events for what is one shortfall of four.
 */
export function fillingQuantities(fillings: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slug of fillings) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return counts;
}

/* -------------------------------------------------------------- describing */

/**
 * A box in one line, for a Stripe line item, an order row and the packing slip.
 *
 * Names rather than slugs: this is read by a customer on a receipt and by
 * whoever is at the bench with the box in front of them, and neither of them
 * knows what `cinnamon-roll` is.
 */
export function describeSelection(
  selection: BakerySelection,
  names: {
    design: string;
    colour: string;
    fillingNames: string[];
  },
): string {
  const counts = fillingQuantities(names.fillingNames);
  const contents = [...counts.entries()]
    .map(([name, n]) => (n > 1 ? `${n} × ${name}` : name))
    .join(", ");

  return `${names.design}, ${names.colour}: ${contents}`;
}
