/**
 * Checks lib/scoop.ts — the Lucky Scoop rules.
 *
 *   node scripts/check-scoop.mjs
 *
 * Same shape as scripts/check-costing.mjs, and for the same reason: the file
 * under test is pure, so it can be compiled and exercised on its own without a
 * database, a server or a browser. The expected values here are worked out in
 * the comments beside each case rather than taken from a fixture, because
 * unlike costing there is no spreadsheet to check against — these rules were
 * decided in 0007_lucky_scoop.sql and lib/scoop.ts, and what this script proves
 * is that the code does what those two say.
 *
 * The one number that IS borrowed: the settings block below is the planner
 * workbook's, exactly as check-costing.mjs types it, so a suggested scoop price
 * can be checked against the same arithmetic the rest of the shop prices with.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Compiled by the project's own TypeScript rather than by stripping types with
// a regex here. lib/scoop.ts imports ./costing, so tsc pulls that in too and
// both land in the same output directory.
//
// COMMONJS, unlike check-costing.mjs, and the difference is the import. The app
// resolves modules the way a bundler does, so lib/scoop.ts writes
// `from "./costing"` with no extension — which is what the rest of lib/ writes
// and what tsc emits verbatim. Node's ESM loader will not resolve an
// extensionless specifier, so an esnext build of this file cannot be imported
// here at all. CommonJS resolves it, `await import()` reads the named exports
// off it, and nothing about the file under test has to change to suit its test.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "scoop-"));
execFileSync(
  "npx",
  ["tsc", join(root, "lib/scoop.ts"), "--outDir", out, "--module", "commonjs",
   "--target", "es2022", "--moduleResolution", "node"],
  { cwd: root, stdio: "inherit" },
);
const m = await import(pathToFileURL(join(out, "scoop.js")).href);

let failed = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} got ${JSON.stringify(got)}` +
      (ok ? "" : `  want ${JSON.stringify(want)}`),
  );
};
const near = (label, got, want, tol = 1e-6) => {
  const ok = got !== null && want !== null && Math.abs(got - want) < tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} got ${got}  want ${want}`);
};

/** A pool piece. Everything defaults to "measured, in stock, on sale". */
const piece = (id, stockOnHand, unitCostCents = 100, active = true) =>
  ({ productId: id, stockOnHand, unitCostCents, active });

const tier = (over = {}) => ({
  pieceCount: 5,
  priceCents: 2500,
  packedWeightGrams: 120,
  active: true,
  ...over,
});

// ---------------------------------------------------------------------------
// drawablePieces — what a scoop can actually be drawn from
// ---------------------------------------------------------------------------
const mixed = [
  piece("in-stock", 3),
  piece("empty", 0),
  piece("retired", 9, 100, false),
];
eq(
  "drawable: empty and retired pieces are excluded",
  m.drawablePieces(mixed).map((p) => p.productId),
  ["in-stock"],
);

// ---------------------------------------------------------------------------
// scoopsAvailable — Σ min(cᵢ, m) ≥ m × pieceCount
// ---------------------------------------------------------------------------
//
// Five products, one each: exactly one duplicate-free scoop of five.
eq(
  "one of each of five fills exactly one scoop",
  m.scoopsAvailable([1, 2, 3, 4, 5].map((n) => piece(`p${n}`, 1)), 5),
  1,
);

// Four products with plenty of stock cannot fill a five-piece scoop from the
// shelf alone, however deep the shelf is — a duplicate-free scoop of five needs
// five distinct products with something in. This is arithmetic about the bowl,
// NOT a sales rule: the tier keeps selling and the fifth piece gets printed
// before the bag is packed. See lib/scoop.ts.
eq(
  "four deep products still cannot fill a five-piece scoop",
  m.scoopsAvailable([1, 2, 3, 4].map((n) => piece(`p${n}`, 100)), 5),
  0,
);

// Five products with two each: ten units, two scoops, and no product has to
// appear twice in one bag.
eq(
  "five products, two each, fills two scoops",
  m.scoopsAvailable([1, 2, 3, 4, 5].map((n) => piece(`p${n}`, 2)), 5),
  2,
);

// The case a naive `floor(totalUnits / pieceCount)` gets wrong. Six products
// holding 10,1,1,1,1,1 is 15 units — three scoops by division — but the deep
// one can only put a single piece in each bag, so the other five products have
// to supply four pieces per scoop out of five units total. One scoop.
eq(
  "one deep product does not carry the whole bowl",
  m.scoopsAvailable(
    [piece("deep", 10), piece("a", 1), piece("b", 1), piece("c", 1), piece("d", 1), piece("e", 1)],
    5,
  ),
  1,
);

// ...and the same shape one unit further on: 10,2,2,2,2,2 is 20 units. Σ
// min(cᵢ, 2) = 2 + 5×2 = 12 ≥ 2×5, so two scoops; at m = 3 it is 3 + 5×2 = 13 <
// 15, so not three.
eq(
  "the ceiling is the supply, not the total",
  m.scoopsAvailable(
    [piece("deep", 10), piece("a", 2), piece("b", 2), piece("c", 2), piece("d", 2), piece("e", 2)],
    5,
  ),
  2,
);

// An empty bowl, an empty pool, and a nonsense piece count all answer 0 rather
// than throwing — every one of these is a real state of a tier the studio has
// half-built.
eq("an empty pool fills nothing", m.scoopsAvailable([], 5), 0);
eq("a bowl with no stock fills nothing",
  m.scoopsAvailable([1, 2, 3, 4, 5].map((n) => piece(`p${n}`, 0)), 5), 0);
eq("a piece count of zero fills nothing",
  m.scoopsAvailable([piece("a", 5)], 0), 0);

// ---------------------------------------------------------------------------
// tierAvailability — on sale, and how full the bowl is, kept apart
// ---------------------------------------------------------------------------
const fullPool = [1, 2, 3, 4, 5].map((n) => piece(`p${n}`, 2));

eq(
  "a priced, switched-on tier is on sale",
  m.tierAvailability(tier(), fullPool),
  { poolSize: 5, drawable: 5, scoopsAvailable: 2, sellable: true, blockers: [] },
);

// The two things that mean "not for sale at all", and they are both decisions
// the owner made about the row rather than facts about a shelf.
eq("an unpriced tier is not on sale",
  m.tierAvailability(tier({ priceCents: null }), fullPool).blockers, ["no price"]);
eq("an inactive tier is not on sale",
  m.tierAvailability(tier({ active: false }), fullPool).blockers, ["not active"]);

// A packed weight is an ACTIVATION requirement (0007, and activationBlockers
// below), not a sale gate: the database will not let an active tier lack one,
// and if a null ever reached postage, toScoopShippingLine falls to
// DEFAULT_DIMENSIONS and quotes it as the bulkiest parcel in the table. Nothing
// there justifies refusing a customer.
eq("an unweighed tier is still on sale",
  m.tierAvailability(tier({ packedWeightGrams: null }), fullPool).sellable, true);

// ---------------------------------------------------------------------------
// THE ASSERTIONS THAT REPLACED THE SELLABILITY GATE.
//
// There was a rule here that a tier stopped being sellable when its pool could
// not fill a scoop off the shelf. It was wrong and it is gone: THE SHOP PRINTS
// TO ORDER — decrement_stock returns a shortfall and keeps selling
// (0005_sale_integrity.sql) precisely because a piece that runs out is printed
// again, and a scoop is no different. She scoops from the bowl, and prints the
// rest before packing.
//
// These three are what stop it being put back.
// ---------------------------------------------------------------------------
const emptyBowl = m.tierAvailability(tier(), [
  piece("a", 1), piece("b", 1), piece("c", 1), piece("d", 0), piece("e", 0),
]);
eq("an empty bowl does NOT stop the tier selling", emptyBowl.sellable, true);
eq("...and raises no blocker at all", emptyBowl.blockers, []);
eq("...but still reports what the bowl holds, for the studio to print against",
  [emptyBowl.drawable, emptyBowl.scoopsAvailable], [3, 0]);
// A tier with no pool rows at all is still on sale. It could not have been
// ACTIVATED in that state (see activationBlockers below), so this is really the
// statement that stock and pool size are asked in two different places.
eq("an empty pool is not a sales question either",
  m.tierAvailability(tier(), []).sellable, true);

// ---------------------------------------------------------------------------
// activationBlockers — the same three rules 0007 enforces, asked in advance
// ---------------------------------------------------------------------------
eq("a fillable priced tier can be activated",
  m.activationBlockers({ pieceCount: 5, priceCents: 2500, packedWeightGrams: 120 }, 5), []);
eq("a pool of three cannot promise five",
  m.activationBlockers({ pieceCount: 5, priceCents: 2500, packedWeightGrams: 120 }, 3),
  ["pool holds 3 products but the tier promises 5 pieces"]);
eq("an unpriced, unweighed, unpooled tier says all three",
  m.activationBlockers({ pieceCount: 2, priceCents: null, packedWeightGrams: null }, 1),
  ["no price", "no packed weight", "pool holds 1 product but the tier promises 2 pieces"]);
// Stock is NOT an activation question: a tier is not un-activated by selling
// out, and a bowl that is empty this morning is refilled this afternoon.
eq("an empty shelf does not block activation",
  m.activationBlockers({ pieceCount: 2, priceCents: 2500, packedWeightGrams: 120 }, 5), []);

// ---------------------------------------------------------------------------
// packCost — the sum, and the null that matters
// ---------------------------------------------------------------------------
const packed = [
  { productId: "a", quantity: 1, unitCostCents: 240 },
  { productId: "b", quantity: 2, unitCostCents: 130 },
];
eq("a measured pack costs the sum of its pieces", m.packCost(packed), 500);
eq("...and counts the pieces that went in", m.packPieceCount(packed), 3);

eq(
  "one unmeasured piece makes the whole pack unknown",
  m.packCost([...packed, { productId: "c", quantity: 1, unitCostCents: null }]),
  null,
);
// Not 0. A scoop with nothing recorded in it has not been costed; a zero here
// would be a free scoop with a 100% margin on the report.
eq("an empty pack has no cost, not a cost of zero", m.packCost([]), null);

// ---------------------------------------------------------------------------
// scoopCostBasis and suggestedTierPrice
// ---------------------------------------------------------------------------
// The workbook's Settings sheet, as check-costing.mjs types it.
const S = {
  printerPriceCents: 104900,
  printerLifeHours: 10000,
  powerDrawWatts: 200,
  electricityPerKwhCents: 32.7,
  filamentPerKgCents: 1600,
  targetMargin: 0.7,
  cardFeeRate: 0.016,
  roundPriceToCents: 50,
  packagingPerUnitCents: 13,
};

const measuredPool = [
  piece("a", 5, 30),
  piece("b", 5, 40),
  piece("c", 5, 50),
  piece("d", 5, 60),
  piece("e", 5, 20),
];
const basis = m.scoopCostBasis(measuredPool, 5);
eq("a fully measured pool counts every piece",
  [basis.measured, basis.unmeasured], [5, 0]);
near("...averages them", basis.averagePieceCents, 40);            // 200 / 5
near("...and multiplies by the piece count", basis.piecesCents, 200);

// CEILING(200 / (1 - 0.7 - 0.016), 50) = CEILING(704.22…, 50) = 750
near("a five-piece scoop from a 40c pool suggests $7.50",
  m.suggestedTierPrice(S, measuredPool, 5), 750);

// THE ASSERTION THIS WHOLE FILE IS FOR. Zero of forty-four products in this
// catalogue have a measured cost, and a partially measured pool is where an
// invented number would come from — an average over the two pieces somebody
// happened to time, shown beside the field she is about to price from.
const partlyMeasured = [
  piece("a", 5, 30),
  piece("b", 5, null),
  piece("c", 5, 50),
];
const partial = m.scoopCostBasis(partlyMeasured, 5);
eq("a partly measured pool says how many are missing",
  [partial.measured, partial.unmeasured], [2, 1]);
eq("...and refuses to average them", partial.averagePieceCents, null);
eq("a partly measured pool suggests no price",
  m.suggestedTierPrice(S, partlyMeasured, 5), null);
eq("an unmeasured pool suggests no price",
  m.suggestedTierPrice(S, [piece("a", 5, null)], 5), null);
eq("an empty pool suggests no price", m.suggestedTierPrice(S, [], 5), null);

console.log(
  failed === 0
    ? "\nOK: the scoop rules hold"
    : `\nFAIL: ${failed} mismatch(es)`,
);
process.exit(failed === 0 ? 0 : 1);
