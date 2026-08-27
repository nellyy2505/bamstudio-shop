/**
 * A fake `@/lib/queries` for the checkout half of scripts/check-webhook.mjs.
 *
 * Only what `app/api/checkout/route.ts` imports. The catalogue and the tier
 * list are set per scenario, so "the owner switched this tier off between
 * add-to-cart and checkout" is a two-line change to a fixture rather than a
 * database to arrange.
 *
 * That example used to be phrased as "this tier stopped being sellable", from
 * when `sellable` also folded in whether the pool could fill a scoop off the
 * shelf. It reads the same and no longer means the same: `sellable` is now
 * switched-on-and-priced and nothing more, so a fixture that empties the bowl
 * is NOT a refusal — scenario 8c in check-webhook.mjs exists to hold that line,
 * because the shop prints to order (lib/scoop.ts).
 */

export const catalogue = { products: new Map(), tiers: new Map() };

export function resetQueries() {
  catalogue.products = new Map();
  catalogue.tiers = new Map();
}

export function isDatabaseConfigured() {
  return true;
}

export async function loadProductsBySlug(slugs) {
  const out = new Map();
  for (const slug of slugs) {
    const product = catalogue.products.get(slug);
    if (product) out.set(slug, product);
  }
  return out;
}

export async function loadScoopTiersBySlug(slugs) {
  const out = new Map();
  for (const slug of slugs) {
    const tier = catalogue.tiers.get(slug);
    if (tier) out.set(slug, tier);
  }
  return out;
}

export async function getCollections() {
  return [];
}

export async function getScoopTiers() {
  return [...catalogue.tiers.values()];
}

export async function getScoopTierBySlug(slug) {
  return catalogue.tiers.get(slug) ?? null;
}

export async function getOrderConfirmationSummary() {
  return { state: "unavailable" };
}
