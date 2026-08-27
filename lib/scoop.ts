/**
 * The Lucky Scoop rules: when a tier may be sold, how many scoops its pool can
 * fill, what a packed scoop cost, and what a tier might be worth.
 *
 * Pure functions, in the manner of `lib/costing.ts` and for the same reason:
 * this is the part of the scoop that has to be checkable by reading it. The
 * only import is `lib/costing.ts`, which is itself pure — nothing here touches
 * Supabase, `next/*`, or anything that knows who is asking. `scripts/
 * check-scoop.mjs` exercises every function below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SCOOP NEEDS ITS OWN RULES AT ALL
 *
 * Everything else in this shop is printed to order with a cost known before the
 * sale. A scoop is sold first and decided afterwards: at the moment money
 * changes hands nobody knows what is in it. Two consequences live in this file.
 *
 * 1. STOCK IS NOT A GATE, AND A SCOOP IS NO EXCEPTION. `decrement_stock`
 *    deliberately returns a shortfall instead of refusing a sale
 *    (0005_sale_integrity.sql) because THIS SHOP PRINTS TO ORDER:
 *    `stock_on_hand` is a buffer of pieces already printed, not the only ones
 *    that exist, so refusing a sale over it would turn a two-day print into a
 *    lost order. A scoop follows the same rule for the same reason — she scoops
 *    from the bowl, and if the bowl is short she prints the rest before packing.
 *
 *    THIS FILE USED TO SAY THE OPPOSITE, and it was wrong. The old reasoning
 *    was that "a scoop's promise is *these exist now*", so a tier had to stop
 *    being offered when its pool could not fill it. The owner's correction:
 *    *"you know we can just print it after we scoop right...? do not
 *    overthink it."* The gate solved a problem she does not have and could only
 *    ever do harm — it silently took a paid product off her shop because a
 *    shelf count, which is a buffer and not a promise, dipped. If you are
 *    reading this because you are about to reintroduce a stock check to
 *    `sellable`: don't. `scoopsAvailable` below still exists, but it is
 *    INFORMATION FOR THE STUDIO (a low bowl is a signal to print), never a
 *    listing decision.
 *
 *    What survives is about TRUTHFULNESS, not stock: a tier cannot be activated
 *    without a price, a packed weight and a pool at least as big as its piece
 *    count (0007_lucky_scoop.sql). "Five drawn from these twelve" needs twelve
 *    rows in the pool. It does not need twelve on the shelf this morning.
 *
 * 2. COST IS KNOWN AT PACK TIME, summed from the pieces that actually went in,
 *    and it is unknown — not cheap — the moment one of those pieces has never
 *    been measured. `packCost` and `suggestedTierPrice` both answer `null`
 *    rather than a flattering number, because 0 of 44 products in this
 *    catalogue currently have a measured cost and a plausible-looking figure
 *    here is one that would be priced from and sold on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { suggestedPrice, type CostSettings } from "./costing";

/* --------------------------------------------------------------- inputs */

/** One product in a tier's eligible pool, as far as these rules care. */
export type ScoopPoolPiece = {
  productId: string;
  /**
   * Units printed and on the shelf right now — `products.stock_on_hand`.
   *
   * Read only to work out how many scoops the bowl could fill WITHOUT printing
   * anything first. That figure is shown in the studio; it decides nothing.
   */
  stockOnHand: number;
  /**
   * `products.active`. A retired product is still a row in the pool (the pool
   * is explicit rows and deleting the product is refused, 0007), so it has to
   * be excluded here instead — otherwise deactivating something in the studio
   * would quietly leave it drawable.
   */
  active: boolean;
  /**
   * What one of these costs to make, in whole cents, or null when nobody has
   * measured it. Null is load-bearing: it is what makes a suggested price
   * refuse to appear rather than appear wrong.
   */
  unitCostCents: number | null;
};

/** Everything the rules below need from a tier row. */
export type ScoopTierRules = {
  /** How many pieces the tier promises. `scoop_tiers.piece_count`. */
  pieceCount: number;
  /** Null until the owner prices it. Never 0 — see 0007_lucky_scoop.sql. */
  priceCents: number | null;
  /** Worst-case packed weight. Null until somebody has weighed a test pack. */
  packedWeightGrams: number | null;
  active: boolean;
};

/* ---------------------------------------------------------- availability */

/**
 * The pieces a scoop could be drawn from WITHOUT PRINTING ANYTHING FIRST: in
 * the pool, not retired, and with at least one on the shelf.
 *
 * "Without printing first" is the whole qualification. A retired product is
 * genuinely undrawable — the studio switched it off — but a product with none
 * on the shelf is simply one she prints before packing. This is a measure of
 * how comfortable the bowl is, not of what the tier may promise.
 */
export function drawablePieces(pool: ScoopPoolPiece[]): ScoopPoolPiece[] {
  return pool.filter((piece) => piece.active && piece.stockOnHand > 0);
}

/**
 * How many whole scoops this pool could fill right now, off the shelf, with no
 * printing.
 *
 * INFORMATION, NOT A GATE. Nothing may refuse a sale because this is 0 — see
 * point 1 at the top of this file. What it is for is the studio: a bowl that
 * can fill one more scoop is a bowl to top up, which is a print job, which is
 * what the Inventory screen is for. Sold as a listing rule it would take a
 * paid product off the shop over a shelf count.
 *
 * THE RULE, and why it counts distinct products rather than units. A scoop of
 * `pieceCount` pieces is treated as `pieceCount` DIFFERENT products. Whether a
 * scoop may contain two of the same charm is one of the four decisions only the
 * owner can make and it is not settled — so this takes the reading that is true
 * under either answer. A pool that can produce five different pieces can
 * obviously also produce five pieces; the reverse is not so. Where it is wrong
 * it is wrong by offering one scoop fewer, which is the direction that does not
 * promise a bag the studio cannot fill.
 *
 * The arithmetic. With stock counts c₁…cₙ, `m` duplicate-free scoops can be
 * built exactly when
 *
 *     Σᵢ min(cᵢ, m) ≥ m × pieceCount
 *
 * — no single product can contribute more than one piece to each scoop, so it
 * can supply at most `m` pieces across `m` scoops however many are on the
 * shelf, and the pieces have to come from somewhere. The left side grows by the
 * number of products holding more than `m` units, which only ever shrinks, so
 * the difference is concave and the answer is the last `m` that satisfies it —
 * which is why walking upward from zero is safe and cannot stop early.
 */
export function scoopsAvailable(
  pool: ScoopPoolPiece[],
  pieceCount: number,
): number {
  if (pieceCount <= 0) return 0;

  const counts = drawablePieces(pool).map((piece) => piece.stockOnHand);
  if (counts.length < pieceCount) return 0;

  const totalUnits = counts.reduce((sum, n) => sum + n, 0);
  const ceiling = Math.floor(totalUnits / pieceCount);

  let filled = 0;
  while (filled < ceiling) {
    const next = filled + 1;
    const supply = counts.reduce((sum, n) => sum + Math.min(n, next), 0);
    if (supply < next * pieceCount) break;
    filled = next;
  }
  return filled;
}

export type ScoopAvailability = {
  /** Rows in the pool, whatever their stock. This is the tier's description. */
  poolSize: number;
  /**
   * Distinct pool products that are switched on and have at least one on the
   * shelf. Studio information: how much of the bowl needs no print first.
   */
  drawable: number;
  /**
   * Whole scoops the pool could fill off the shelf right now, printing nothing.
   * See `scoopsAvailable` — a number to act on, never a number that gates.
   */
  scoopsAvailable: number;
  /**
   * True when this tier is FOR SALE AT ALL: switched on, and priced.
   *
   * DELIBERATELY BLIND TO STOCK. It once was not, and that was the defect —
   * see point 1 at the top of this file. Both facts here are about whether the
   * owner has decided to sell the thing, not about how full the bowl is.
   */
  sellable: boolean;
  /**
   * Why not, in words, newest concern last. Empty when `sellable`.
   *
   * Written for the studio to read on a tier row. Never shown to a customer:
   * "no price" is a peek into the shop's own admin.
   */
  blockers: string[];
};

/**
 * Everything a screen needs to say about a tier: whether it is on sale, and how
 * comfortable the bowl looks. THE TWO ARE INDEPENDENT and this is the file that
 * has to keep them so.
 *
 * `sellable` asks only what the owner has decided — is it switched on, is it
 * priced. Those are the questions RLS (0007_lucky_scoop.sql) and the checkout
 * route both ask, and they are about whether the thing is for sale at all.
 *
 * `drawable` and `scoopsAvailable` ride alongside as facts about the shelf.
 * They are for the studio to act on. Nothing may turn either of them into a
 * refusal: the shop prints to order, so a short bowl is a print job, not a
 * closed shop.
 *
 * NOT A PACKED-WEIGHT CHECK. A tier with no packed weight cannot be ACTIVATED
 * (0007, and `activationBlockers` below says so before the database has to),
 * so an active tier already has one. And if a null ever did reach postage,
 * `toScoopShippingLine` falls to `DEFAULT_DIMENSIONS` — the bulkiest row in the
 * table — so an unmeasured scoop quotes as an expensive parcel rather than a
 * cheap one. Nothing there justifies refusing a sale.
 */
export function tierAvailability(
  tier: ScoopTierRules,
  pool: ScoopPoolPiece[],
): ScoopAvailability {
  const blockers: string[] = [];
  if (!tier.active) blockers.push("not active");
  if (tier.priceCents === null) blockers.push("no price");

  return {
    poolSize: pool.length,
    drawable: drawablePieces(pool).length,
    scoopsAvailable: scoopsAvailable(pool, tier.pieceCount),
    sellable: blockers.length === 0,
    blockers,
  };
}

/**
 * Why the database would refuse to activate this tier, in words — the same
 * three rules 0007_lucky_scoop.sql enforces, asked before the studio tries.
 *
 * Deliberately about the POOL'S SIZE and not its stock, and this is the line
 * between what was removed and what was kept. A pool of twelve rows is what
 * makes "five drawn from these twelve" a true description, and it stays true on
 * a morning when nine of the twelve need printing. Stock never appears here —
 * nor, since the sellability gate was removed, anywhere that can refuse a sale.
 */
export function activationBlockers(
  tier: Pick<ScoopTierRules, "pieceCount" | "priceCents" | "packedWeightGrams">,
  poolSize: number,
): string[] {
  const blockers: string[] = [];
  if (tier.priceCents === null) blockers.push("no price");
  if (tier.packedWeightGrams === null) blockers.push("no packed weight");
  if (poolSize < tier.pieceCount) {
    blockers.push(
      `pool holds ${poolSize} product${poolSize === 1 ? "" : "s"} but the tier promises ${tier.pieceCount} pieces`,
    );
  }
  return blockers;
}

/* ------------------------------------------------------ the cost of a pack */

/** One line of a recorded pack — `scoop_pack_items`. */
export type ScoopPackPiece = {
  productId: string;
  quantity: number;
  /** What one cost when it was packed. Null for a product nobody has measured. */
  unitCostCents: number | null;
};

/** How many pieces were actually recorded, so a short pack can be spotted. */
export function packPieceCount(items: ScoopPackPiece[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0);
}

/**
 * What a packed scoop cost to make, in whole cents — the number the pack flow
 * writes onto `order_items.unit_cost_cents`.
 *
 * NULL, NOT A PARTIAL SUM, when any piece in the pack has no measured cost.
 * Adding up the pieces that happen to be measured and calling that the cost of
 * the scoop understates it by however much the rest cost, and the margin
 * computed from it is wrong in the flattering direction. Null is what the
 * reports already know how to say — they count the lines carrying no cost and
 * state that the profit understates what was spent.
 *
 * Null for an empty pack too: a scoop with nothing recorded in it has not been
 * costed, and 0 would read as a scoop that was free to make.
 */
export function packCost(items: ScoopPackPiece[]): number | null {
  if (items.length === 0) return null;

  let total = 0;
  for (const item of items) {
    if (item.unitCostCents === null) return null;
    total += item.unitCostCents * Math.max(0, item.quantity);
  }
  return total;
}

/* ---------------------------------------------------- what a tier is worth */

export type ScoopCostBasis = {
  /** Pool pieces with a measured cost. */
  measured: number;
  /** Pool pieces nobody has costed. */
  unmeasured: number;
  /**
   * Mean cost of one piece in the pool, in fractional cents — null unless
   * EVERY piece is measured. See `suggestedTierPrice` for why not "the average
   * of the ones we know".
   */
  averagePieceCents: number | null;
  /** `averagePieceCents × pieceCount`. Null whenever the average is. */
  piecesCents: number | null;
};

/**
 * What the pool says a scoop of this size costs to fill.
 *
 * Fractional cents throughout, like `lib/costing.ts`: a keyring is 9.5 cents
 * and rounding on the way past moves a five-piece scoop by real money. The one
 * rounding happens in `suggestedTierPrice`, at the end, into the price.
 */
export function scoopCostBasis(
  pool: ScoopPoolPiece[],
  pieceCount: number,
): ScoopCostBasis {
  const measured = pool.filter((piece) => piece.unitCostCents !== null);
  const unmeasured = pool.length - measured.length;

  const complete = pool.length > 0 && unmeasured === 0 && pieceCount > 0;
  const averagePieceCents = complete
    ? measured.reduce((sum, piece) => sum + (piece.unitCostCents as number), 0) /
      measured.length
    : null;

  return {
    measured: measured.length,
    unmeasured,
    averagePieceCents,
    piecesCents: averagePieceCents === null ? null : averagePieceCents * pieceCount,
  };
}

/**
 * The price this tier might be worth, run through the shop's own costing rules:
 * the pool's average measured cost × the piece count, then
 * `suggestedPrice()` — cover the cost, the target margin and the card fee,
 * round up to the nearest 50c.
 *
 * A SUGGESTION, NEVER A VALUE. It belongs beside the price field in the studio,
 * the way `costProduct()`'s suggestion sits beside a product's, and it is never
 * written into a column. She decides.
 *
 * NULL WHEN THE POOL IS NOT FULLY MEASURED, and that is the important line in
 * this file. Today 0 of 44 products have a measured cost, so almost every pool
 * answers null — which is correct and is the point. It would be easy to average
 * the pieces that HAVE been measured and show that: a number, on the screen,
 * beside the field she is about to type into. Two of twelve pieces measured
 * makes that number a guess dressed as arithmetic, and a guess in a price field
 * is exactly the plausible-looking figure this project treats as a defect. Null
 * lets the studio say "3 of 12 pieces measured" instead, which is true and is
 * also the nudge to go and measure the other nine.
 *
 * A NOTE ON PACKAGING, so nobody adds it twice. Each piece's cost already
 * includes `packagingPerUnitCents` (it comes from `unitCost()`), so a five-piece
 * scoop carries five lots of it. That over-counts if the pieces are not
 * individually bagged — deliberately, because it errs towards a higher
 * suggested price, and because whether they are bagged individually is a
 * packing decision nobody has made. The per-order mailer is NOT added: it is
 * charged once per posted order and never inside a unit cost, which is what
 * `shop_settings.mailer_per_order_cents` says.
 */
export function suggestedTierPrice(
  settings: CostSettings,
  pool: ScoopPoolPiece[],
  pieceCount: number,
): number | null {
  const basis = scoopCostBasis(pool, pieceCount);
  if (basis.piecesCents === null) return null;
  return suggestedPrice(settings, basis.piecesCents);
}
