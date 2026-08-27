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
 * 1. AVAILABILITY IS A QUESTION ABOUT REAL STOCK, and it is the one place the
 *    shop's deliberate overselling rule must not apply. `decrement_stock`
 *    returns a shortfall instead of refusing a sale (0005_sale_integrity.sql)
 *    because everything else is printed to order — `stock_on_hand` is a buffer
 *    of pieces already printed, not the only ones that exist, so refusing would
 *    turn a two-day print into a lost order. A scoop breaks that premise: its
 *    whole promise is "these exist now, and five of them are going in a bag",
 *    and you cannot print a surprise on Tuesday to satisfy Monday's order
 *    without deciding for the customer what they got. So a tier stops being
 *    OFFERED when its pool cannot fill it. Nothing here refuses a decrement;
 *    this is a listing decision, asked at read time.
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
   * A scoop draws from what exists, so this is the number that decides
   * availability, not a print queue.
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
 * The pieces a scoop could actually be drawn from: in the pool, not retired,
 * and with at least one on the shelf.
 */
export function drawablePieces(pool: ScoopPoolPiece[]): ScoopPoolPiece[] {
  return pool.filter((piece) => piece.active && piece.stockOnHand > 0);
}

/**
 * How many whole scoops this pool could fill right now.
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
  /** Rows in the pool, whatever their stock. */
  poolSize: number;
  /** Distinct pool products that are active and have at least one on the shelf. */
  drawable: number;
  /** Whole scoops the pool could fill right now. See `scoopsAvailable`. */
  scoopsAvailable: number;
  /** True when this tier may be offered to a customer right now. */
  sellable: boolean;
  /**
   * Why not, in words, newest concern last. Empty when `sellable`.
   *
   * Written for the studio to read on a tier row. The shopfront does not need
   * them — it simply does not list an unsellable tier — but a tier that has
   * gone quiet is exactly the thing the owner has to be able to explain.
   */
  blockers: string[];
};

/**
 * Everything a screen needs to say about whether a tier can be sold.
 *
 * Note what `sellable` includes beyond stock: a tier that is inactive, unpriced
 * or unweighed is not sellable either, and each is reported separately. The
 * database already refuses to ACTIVATE such a tier (0007), and RLS already
 * refuses to publish one, but this function is what the studio uses to say why
 * before either of those has a chance to.
 */
export function tierAvailability(
  tier: ScoopTierRules,
  pool: ScoopPoolPiece[],
): ScoopAvailability {
  const drawable = drawablePieces(pool).length;
  const fillable = scoopsAvailable(pool, tier.pieceCount);

  const blockers: string[] = [];
  if (!tier.active) blockers.push("not active");
  if (tier.priceCents === null) blockers.push("no price");
  if (tier.packedWeightGrams === null) blockers.push("no packed weight");
  if (fillable < 1) {
    blockers.push(
      `pool can fill 0 scoops — ${drawable} of the ${tier.pieceCount} pieces it promises are in stock`,
    );
  }

  return {
    poolSize: pool.length,
    drawable,
    scoopsAvailable: fillable,
    sellable: blockers.length === 0,
    blockers,
  };
}

/** The shopfront's question, and only that. */
export function isTierSellable(
  tier: ScoopTierRules,
  pool: ScoopPoolPiece[],
): boolean {
  return tierAvailability(tier, pool).sellable;
}

/**
 * Why the database would refuse to activate this tier, in words — the same
 * three rules 0007_lucky_scoop.sql enforces, asked before the studio tries.
 *
 * Deliberately about the POOL'S SIZE and not its stock: activation is a
 * decision about a tier that has to survive a quiet Tuesday, and a tier is not
 * un-activated by selling out. Stock is `tierAvailability` above.
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
