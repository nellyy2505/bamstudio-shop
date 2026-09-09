import { createAdminClient, createClient } from "@/lib/supabase/server";
import {
  BUILDER_CHARM_DISCOUNT_FALLBACK,
  BUILDER_PRICING_FALLBACK,
  isDatabaseConfigured,
  type BuilderKind,
} from "./builder-fallback";

export type { BuilderKind };

/**
 * What a personalised build costs, read from the database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY PLACE THAT KNOWS WHAT A BUILD COSTS.
 *
 * The ladder used to be `BUILDER_PRICING` in lib/config.ts, which made it a
 * deployment rather than a field: the owner could change every other price in
 * the shop from a screen and this one from a pull request. Worse, it got
 * copied - `scripts/generate-seed.mjs` wrote its cheapest rung into
 * `products.price` for the builder products, and when the ladder moved the copy
 * did not, so the shop listed one product at two prices.
 *
 * So: the table is the truth, this module is the only reader, and nothing
 * downstream keeps a second copy.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE FALLBACK IS NOT A BUG, it is the same decision lib/shipping/fallback.ts
 * makes. The shop serves a bundled catalogue when Supabase is not configured
 * (a fresh clone, `npm run dev` with no database) and must not fall over when
 * it is merely unreachable. A builder with no prices at all cannot render; a
 * builder quoting last-known-good prices can, and the figures in the fallback
 * are the ones the migration seeded, so they agree until somebody changes one.
 *
 * The failure that matters is the silent one, so a database that answers with
 * an EMPTY ladder is treated as unreachable rather than as "this builder is
 * free". An empty table is far more likely to be a migration that has not run
 * than a deliberate statement that letters cost nothing.
 */
export type Ladder = {
  /** units (letters, or pieces) to price in cents, ascending by units. */
  rungs: { units: number; priceCents: number }[];
  /** True when these came from lib/config.ts rather than the database. */
  fromFallback: boolean;
};

function fallbackLadder(kind: BuilderKind): Ladder {
  return {
    rungs: BUILDER_PRICING_FALLBACK[kind].map((r) => ({ ...r })),
    fromFallback: true,
  };
}

export async function getLadder(kind: BuilderKind): Promise<Ladder> {
  if (!isDatabaseConfigured()) return fallbackLadder(kind);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("builder_pricing")
    .select("units, price_cents")
    .eq("kind", kind)
    .order("units", { ascending: true });

  if (error || !data || data.length === 0) {
    // Logged rather than swallowed: serving fallback prices is a correct
    // response to a broken database and a silent one is how a shop quotes last
    // year's prices for a fortnight without anybody noticing.
    console.error(
      `[builder-pricing] no ${kind} ladder from the database, serving the ` +
        `fallback from lib/pricing/builder-fallback.ts`,
      error?.message ?? "(the table answered with no rows)",
    );
    return fallbackLadder(kind);
  }

  return {
    rungs: data.map((row) => ({
      units: Number(row.units),
      priceCents: Number(row.price_cents),
    })),
    fromFallback: false,
  };
}

/* ------------------------------------------------------- reading a ladder */

/** The price for exactly this many units, or null when the ladder has no rung. */
export function priceFor(ladder: Ladder, units: number): number | null {
  return ladder.rungs.find((r) => r.units === units)?.priceCents ?? null;
}

/**
 * The cheapest rung: the honest "from" price to advertise.
 *
 * Null on an empty ladder rather than 0, because "from $0.00" is a claim that
 * something is free and this is the number that reaches a product card.
 */
export function fromPrice(ladder: Ladder): number | null {
  if (ladder.rungs.length === 0) return null;
  return Math.min(...ladder.rungs.map((r) => r.priceCents));
}

/** The most units this builder sells, which is the ladder's top rung. */
export function maxUnits(ladder: Ladder): number {
  if (ladder.rungs.length === 0) return 0;
  return Math.max(...ladder.rungs.map((r) => r.units));
}

/**
 * The ladder in one sentence, for the places that sell it.
 *
 * Built from the rungs rather than typed out. Two sentences used to describe
 * this ladder in prose - a string literal in the builder page's metadata, which
 * is a price in search results and social previews, and a heading that computed
 * the step from the first two rungs and so said "for each one after" when the
 * last step is different. Both were wrong within a day of the ladder moving.
 *
 * The final clause appears only when the last step really does differ, so
 * flattening the ladder drops the claim instead of leaving it behind.
 */
export function ladderSentence(ladder: Ladder): string {
  const rungs = [...ladder.rungs].sort((a, b) => a.units - b.units);
  if (rungs.length === 0) return "";

  const dollars = (cents: number) =>
    cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

  const first = dollars(rungs[0].priceCents);
  if (rungs.length === 1) return `${first} a box`;

  const step = rungs[1].priceCents - rungs[0].priceCents;
  const finalStep = rungs[rungs.length - 1].priceCents - rungs[rungs.length - 2].priceCents;

  const base = `${first} for the first letter, ${dollars(step)} for each one after`;
  return finalStep === step
    ? base
    : `${base}, and just ${dollars(finalStep)} for the last one`;
}


/* ------------------------------------------------------ the charm add-on */

/**
 * What comes off a charm's own price when it is bought inside the builder.
 *
 * Read with the ADMIN client, because `shop_settings` is service-role only: the
 * row holds the printer price, the filament price and the overhead pools, and a
 * read policy that let the browser see one column would let it see all of them.
 * This runs in server components and route handlers only, which is what
 * `assertServer` below is for.
 *
 * The value itself is not a secret - it is visible on the builder page as "$1.50
 * less than buying it separately" - so serving it to the shopfront is fine. What
 * must not happen is this module reaching a client bundle.
 */
export async function getCharmDiscountCents(): Promise<number> {
  if (typeof window !== "undefined") {
    throw new Error(
      "getCharmDiscountCents() was called in the browser. It reads shop_settings " +
        "with the service-role key. A server component calls it; a client " +
        "component takes the answer as a prop.",
    );
  }
  if (!isDatabaseConfigured()) return BUILDER_CHARM_DISCOUNT_FALLBACK;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("shop_settings")
      .select("builder_charm_discount_cents")
      .eq("id", true)
      .maybeSingle();

    if (error || !data) return BUILDER_CHARM_DISCOUNT_FALLBACK;

    const value = Number(data.builder_charm_discount_cents);
    // A negative discount would price the charm ABOVE its own retail, which is
    // the one direction this must never go. NaN lands here too.
    return Number.isFinite(value) && value >= 0
      ? value
      : BUILDER_CHARM_DISCOUNT_FALLBACK;
  } catch {
    // createAdminClient throws when the service-role key is absent, which is a
    // normal state on a fresh clone and not worth taking the page down for.
    return BUILDER_CHARM_DISCOUNT_FALLBACK;
  }
}

/**
 * What the builder charges for a charm, given that charm product's own price.
 *
 * Clamped at zero so a charm cheaper than the discount is free rather than a
 * credit. A negative line would let a basket price itself downward, which is
 * the shape of every "add it twice and get paid" bug, and the cart cannot see
 * the database so it would have no way to notice.
 *
 * Takes the discount rather than reading it, so the one caller that already has
 * it does not fetch it twice and so this stays a pure function the cart can use.
 */
export function charmPrice(charmProductPrice: number, discountCents: number): number {
  return Math.max(0, charmProductPrice - discountCents);
}
