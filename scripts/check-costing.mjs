/**
 * Checks lib/costing.ts against the planner workbook's own arithmetic.
 *
 *   node scripts/check-costing.mjs
 *
 * The expected values are the ones Excel itself computed and cached in the
 * file — not values worked out by hand here, which would only prove this
 * script and that file agree with each other.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Compiled by the project's own TypeScript rather than by stripping types with
// a regex here. A hand-rolled stripper that gets one declaration wrong either
// crashes — which is at least loud — or silently changes what is being tested.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(tmpdir(), "costing-"));
execFileSync(
  "npx",
  ["tsc", join(root, "lib/costing.ts"), "--outDir", out, "--module", "esnext",
   "--target", "es2022", "--moduleResolution", "bundler"],
  { cwd: root, stdio: "inherit" },
);
const js = pathToFileURL(join(out, "costing.js")).href;

const m = await import(js);

// Settings sheet, exactly as typed in the workbook, converted to cents.
const S = {
  printerPriceCents: 104900,       // C6  $1049
  printerLifeHours: 10000,         // C7
  powerDrawWatts: 200,             // C9
  electricityPerKwhCents: 32.7,    // C10 $0.327
  filamentPerKgCents: 1600,        // C15 $16
  targetMargin: 0.7,               // C18
  cardFeeRate: 0.016,              // C19 — see note below
  roundPriceToCents: 50,           // C20 $0.50
  packagingPerUnitCents: 13,       // C37 $0.13
};

let failed = 0;
const near = (label, got, want, tol = 1e-6) => {
  const ok = Math.abs(got - want) < tol;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(46)} got ${got}  want ${want}`);
};

// ---- Settings!C8, C11, C12, cached by Excel as 0.1049 / 0.0654 / 0.1703 ----
near("machine cost per hour (C8)", m.machineCostPerHour(S), 10.49);
near("power cost per hour (C11)", m.powerCostPerHour(S), 6.54);
near("machine + power per hour (C12)", m.machineAndPowerPerHour(S), 17.03);

// ---- The worked example, Products row 5 -----------------------------------
// Excel's own cached values for that row: U5=0.127725, V5=0.095, W5=0.13,
// T5=0, X5=0.352725. Note J5 overrides filament price to $25/kg, but S5 (total
// grams) is 0, so filament is 0 either way.
const ex = m.unitCost(S, { printHours: 0.75, grams: 0, accessoryCents: 9.5 });
near("worked example — filament (T5)", ex.filament, 0);
near("worked example — machine+power (U5)", ex.machineAndPower, 12.7725);
near("worked example — accessory (V5)", ex.accessory, 9.5);
near("worked example — packaging (W5)", ex.packaging, 13);
near("worked example — UNIT COST (X5)", ex.total, 35.2725);

// ---- Real rows, Excel's cached X column ------------------------------------
// CLK-002: 1g Light Brown, keyring, no print time. X7 = 0.241
const clk002 = m.unitCost(S, { printHours: null, grams: 1, accessoryCents: 9.5 });
near("CLK-002 unit cost (X7)", clk002.total, 24.1);
console.log(
  clk002.unknown && clk002.missing.join() === "print time"
    ? "ok    CLK-002 is flagged unknown (no print time)"
    : (failed++, "FAIL  CLK-002 should be flagged unknown"),
);

// CLK-003: 3g across three colours, keyring. X8 = 0.273
near(
  "CLK-003 unit cost (X8)",
  m.unitCost(S, { printHours: null, grams: 3, accessoryCents: 9.5 }).total,
  27.3,
);

// CLK-001: no grams at all. X6 = 0.225 — packaging + keyring and nothing else.
const clk001 = m.unitCost(S, { printHours: null, grams: null, accessoryCents: 9.5 });
near("CLK-001 unit cost (X6)", clk001.total, 22.5);
console.log(
  clk001.missing.length === 2
    ? "ok    CLK-001 is missing both inputs"
    : (failed++, "FAIL  CLK-001 should be missing both inputs"),
);

// ---- Suggested price and profit -------------------------------------------
//
// These cannot be checked against the workbook's cached values, because in the
// file as it stands column Y is #VALUE! on EVERY row and column AA is 0. The
// cause is Settings!C19: the card fee is stored as the TEXT "1.6%", not as a
// number, so `1 - C18 - C19` is an error, CEILING never runs, and IFERROR in
// column AA turns the error into a zero. The suggested-price column has never
// produced a number.
//
// So these two assertions check the formula as written, with C19 read as the
// 0.016 it was meant to be:
//   Y = CEILING(0.352725 / (1 - 0.7 - 0.016), 0.5) = CEILING(1.24199…, 0.5) = 1.50
//   AA = 1.50 * (1 - 0.016) - 0.352725 = 1.123275
near("worked example — suggested price (Y5)", m.suggestedPrice(S, 35.2725), 150);
near("worked example — profit per unit (AA5)", m.profitPerUnit(S, 150, 35.2725), 112.3275);

// A cost of zero is not a free product, it is an unpriced one.
console.log(
  m.suggestedPrice(S, 0) === null
    ? "ok    a zero cost gives no suggested price"
    : (failed++, "FAIL  a zero cost should give null, not 0"),
);

// ---- The print queue, column AE -------------------------------------------
near("to print: 5 buffer, 0 on hand, 0 open (AE)", m.toPrint({ onHand: 0, ordered: 0, buffer: 5 }), 5);
near("to print: 5 buffer, 4 on hand, 4 open (AE)", m.toPrint({ onHand: 4, ordered: 4, buffer: 5 }), 5);
near("to print: nothing needed does not go negative", m.toPrint({ onHand: 20, ordered: 1, buffer: 5 }), 0);

console.log(failed === 0 ? "\nOK: costing matches the workbook" : `\nFAIL: ${failed} mismatch(es)`);
process.exit(failed === 0 ? 0 : 1);
