/**
 * Checks lib/bakery.ts, the rules a bakery box is sold under.
 *
 *   node scripts/check-bakery.mjs
 *
 * Same shape as check-scoop.mjs and check-costing.mjs: the module is compiled
 * by the project's own TypeScript rather than having its types stripped by a
 * regex here, because a hand-rolled stripper that gets one declaration wrong
 * either crashes or silently changes what is being tested.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "bakery-"));
execFileSync(
  "npx",
  ["tsc", join(root, "lib/bakery.ts"), "--outDir", out, "--module", "esnext",
   "--target", "es2022", "--moduleResolution", "bundler"],
  { cwd: root, stdio: "inherit" },
);
const m = await import(pathToFileURL(join(out, "bakery.js")).href);

let failed = 0;
const ok = (label, pass) => {
  if (!pass) failed++;
  console.log(`${pass ? "ok  " : "FAIL"}  ${label}`);
};
const eq = (label, got, want) =>
  ok(`${label}  got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want));

const AVAILABLE = {
  designSlugs: new Set(["plain", "window", "gingham"]),
  colourIds: new Set(["colour-pink", "colour-blue"]),
  fillingSlugs: new Set(["macaron", "croissant", "donut", "cake"]),
  priceCents: 1500,
};
const BOX4 = { slug: "bakery-box", pieceCount: 4 };
const BOX1 = { slug: "birthday-cake-box", pieceCount: 1 };

const sel = (fillings, over = {}) => ({
  kind: "bakery",
  design: "window",
  colour_id: "colour-pink",
  fillings,
  ...over,
});

/* --------------------------------------------------------- the happy path */

eq(
  "a full box of four is accepted",
  m.validateSelection(sel(["macaron", "croissant", "donut", "cake"]), BOX4, AVAILABLE),
  [],
);

// The decision that costs money: duplicates are allowed, so the worst case a
// flat price has to cover is four of the DEAREST piece, not an average box.
eq(
  "four of the same piece is allowed",
  m.validateSelection(sel(["macaron", "macaron", "macaron", "macaron"]), BOX4, AVAILABLE),
  [],
);

eq(
  "a one-piece birthday cake box takes exactly one",
  m.validateSelection(sel(["cake"]), BOX1, AVAILABLE),
  [],
);

/* ------------------------------------------------------------ the refusals */

eq(
  "an under-filled box is refused, and says how many are missing",
  m.validateSelection(sel(["macaron", "croissant"]), BOX4, AVAILABLE),
  [{ code: "wrong_count", wanted: 4, got: 2 }],
);
ok(
  "...in the customer's words",
  m.describeProblem({ code: "wrong_count", wanted: 4, got: 2 }) ===
    "This box holds 4. Pick 2 more.",
);

eq(
  "an over-filled box is refused",
  m.validateSelection(sel(["macaron", "macaron", "macaron", "macaron", "macaron"]), BOX4, AVAILABLE),
  [{ code: "wrong_count", wanted: 4, got: 5 }],
);

// The case that matters most: something withdrawn while the builder was open.
eq(
  "a withdrawn design is refused",
  m.validateSelection(sel(["macaron", "croissant", "donut", "cake"], { design: "retired" }), BOX4, AVAILABLE),
  [{ code: "unknown_design" }],
);
eq(
  "a withdrawn colour is refused",
  m.validateSelection(sel(["macaron", "croissant", "donut", "cake"], { colour_id: "colour-gone" }), BOX4, AVAILABLE),
  [{ code: "unknown_colour" }],
);
eq(
  "a piece that has left the range is refused, and named",
  m.validateSelection(sel(["macaron", "croissant", "donut", "eclair"]), BOX4, AVAILABLE),
  [{ code: "unknown_filling", slug: "eclair" }],
);

// An absent rung is "not on sale", never a guessed price. This is the state the
// 1-piece box ships in until the owner prices it.
eq(
  "a box with no price is not on sale",
  m.validateSelection(sel(["cake"]), BOX1, { ...AVAILABLE, priceCents: null }),
  [{ code: "not_priced" }],
);
ok(
  "...and says so honestly rather than 'sold out'",
  m.describeProblem({ code: "not_priced" }) === "This box is not on sale at the moment.",
);

/* ----------------------------------------------------------------- costing */

const costs = new Map([
  ["macaron", 134],
  ["croissant", 90],
  ["donut", 75],
  ["cake", null],
]);

eq(
  "a measured box costs the sum of its pieces",
  m.costOfFillings(["macaron", "croissant", "donut", "macaron"], costs),
  134 + 90 + 75 + 134,
);

// Null, not a partial sum. A box costed from three of its four pieces is a
// flattering number that looks like a real one.
eq(
  "one unmeasured piece makes the whole box unmeasured",
  m.costOfFillings(["macaron", "croissant", "donut", "cake"], costs),
  null,
);
eq(
  "a piece missing from the map is unmeasured too",
  m.costOfFillings(["macaron", "eclair"], costs),
  null,
);

/* --------------------------------------------------- quantities and words */

eq(
  "duplicates become one movement with a quantity",
  [...m.fillingQuantities(["macaron", "macaron", "donut", "macaron"]).entries()],
  [["macaron", 3], ["donut", 1]],
);

ok(
  "a box reads as something a person can pack",
  m.describeSelection(sel(["macaron", "macaron", "donut", "cake"]), {
    design: "Window lid",
    colour: "Baby Pink",
    fillingNames: ["Macaron", "Macaron", "Donut", "Birthday cake"],
  }) === "Window lid, Baby Pink: 2 × Macaron, Donut, Birthday cake",
);

console.log(failed === 0 ? "\nOK: the bakery rules hold" : `\nFAIL: ${failed} problem(s)`);
process.exit(failed === 0 ? 0 : 1);
