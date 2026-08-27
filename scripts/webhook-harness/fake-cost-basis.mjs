/**
 * A fake `@/lib/cost-basis` for scripts/check-webhook.mjs.
 *
 * Answers a real cost for one product id and NULL for anything else, because
 * "nobody has measured this" is the normal case in this catalogue (0 of 44) and
 * a fake that costed everything would never exercise the null path.
 */

export const MEASURED_PRODUCT_ID = "prod-measured";
export const MEASURED_COST_CENTS = 311;

export const costCalls = [];

export function resetCostBasis() {
  costCalls.length = 0;
}

export async function unitCostsAtSale(ids) {
  costCalls.push([...ids]);
  const map = new Map();
  for (const id of ids) {
    map.set(id, id === MEASURED_PRODUCT_ID ? MEASURED_COST_CENTS : null);
  }
  return map;
}
