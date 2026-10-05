/**
 * The personalisation prices this shop falls back to when the database cannot
 * answer, and the shape they take.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS A FALLBACK. THE DATABASE IS THE TRUTH.
 *
 * `builder_pricing` (migration 0014) is where these live and where the Studio
 * edits them. This file exists for two states the shop genuinely has:
 *
 *   - Supabase is not configured at all: a fresh clone running `npm run dev`,
 *     which serves the bundled catalogue in lib/fallback-data.ts and would
 *     otherwise render a builder with no prices in it.
 *   - Supabase is configured and not answering, or answering with nothing.
 *
 * The figures below are what 0014 seeds, so the two agree until somebody
 * changes one in the Studio. **When they disagree, the database wins and this
 * file is out of date, not the shop.** It is worth refreshing after a
 * deliberate reprice, the same way lib/shipping/fallback.ts is worth refreshing
 * after Australia Post moves its rates, and for the same reason: a fallback
 * nobody maintains quotes last year's prices at the worst possible moment.
 *
 * It is deliberately NOT the place to change a price. Editing here changes what
 * a broken shop quotes and nothing else.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * No import of lib/config.ts, and no import of anything that touches Supabase:
 * this module is pulled in by both the server and the client bundle, and it has
 * to stay a table of numbers.
 */

/** Which builder. Matches the `kind` check constraint in 0014. */
export type BuilderKind = "letter_caps" | "bakery_box";

export type FallbackRung = { units: number; priceCents: number };

/**
 * LETTER CAPS: $3.50 for the first letter, $1.00 for each after, 50c for the
 * fifth. Owner's decision, 9 September 2026.
 *
 * What it earns, kept here because the shape of this ladder is a choice and the
 * numbers are the argument for it. A marginal letter is about 21 minutes of
 * machine time and 40c of filament and clicker, so against the $3.33
 * printer-hour bar the rungs run $2.60, $2.17, $1.95, $1.83, $1.54, and the
 * marginal letter itself earns $1.34 an hour at $1.00 and 10c an hour at 50c.
 * See claude/planner-workbook-fixes.md.
 *
 * BAKERY BOX: one price a box, whichever pieces the customer picks, and the
 * same $12 for both sizes. A birthday cake is one large decorated print and
 * four pastries are four small ones, and the owner has priced them as the same
 * job. Placeholders in the sense that nothing has been costed against them yet,
 * not in the sense that they are guesses: both are figures she named.
 */
export const BUILDER_PRICING_FALLBACK: Record<BuilderKind, FallbackRung[]> = {
  letter_caps: [
    { units: 1, priceCents: 350 },
    { units: 2, priceCents: 450 },
    { units: 3, priceCents: 550 },
    { units: 4, priceCents: 650 },
    { units: 5, priceCents: 700 },
  ],
  bakery_box: [
    { units: 1, priceCents: 1200 },
    { units: 4, priceCents: 1200 },
  ],
};

/**
 * The hard ceiling on how many units any builder will accept, for the request
 * validators.
 *
 * NOT the ladder's own top rung, which is a business decision and is read from
 * the database per request. This is a rail on the size of a parsed payload, so
 * a request claiming eight hundred letters is rejected before anything counts
 * them. It matches the `units <= 50` check in 0014.
 */
export const BUILDER_UNITS_HARD_MAX = 50;

/**
 * Taken off a charm product's own price inside the letter builder.
 *
 * The live value is `shop_settings.builder_charm_discount_cents`; this is the
 * fallback for the same two states as the ladder above. The charm itself is
 * never given a stored price of its own: it is resolved live through
 * `collections.charm_slug`, so repricing the macaron reprices the add-on in the
 * same breath.
 */
export const BUILDER_CHARM_DISCOUNT_FALLBACK = 150;

/**
 * True once the Supabase env vars are present.
 *
 * Duplicated from lib/queries.ts deliberately rather than imported: that module
 * pulls in the whole bundled catalogue and the query layer with it, and this
 * one is imported by the pricing reader on paths that must stay light. Two
 * reads of the same two environment variables cannot disagree.
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
