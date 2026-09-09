/**
 * Checks lib/costing.ts against the planner workbook's own arithmetic.
 *
 *   node scripts/check-costing.mjs
 *
 * The expected values are the ones Excel itself computed and cached in the
 * file - not values worked out by hand here, which would only prove this
 * script and that file agree with each other. Every `want` below was read out
 * of C:\\Users\\Admin\\BamStudio\\3D_Planner.xlsx with openpyxl in data_only
 * mode, and the cell it came from is named beside it.
 *
 * REPINNED 8 September 2026. This script previously checked against the
 * workbook as it stood BEFORE the eight pricing passes of 5 and 6 September:
 * a 70% target margin, a 1.6% card fee stored as text, no fixed card fee, no
 * waste, no overhead and no channel cost. It passed, and it was measuring the
 * wrong sheet - which is the failure mode of any test pinned to a snapshot
 * nobody re-reads. If it fails after the workbook is edited again, re-read the
 * cells rather than adjusting the numbers to match the code.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Compiled by the project's own TypeScript rather than by stripping types with
// a regex here. A hand-rolled stripper that gets one declaration wrong either
// crashes - which is at least loud - or silently changes what is being tested.
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
  targetMargin: 0.67,              // C18 - was 0.70, abandoned as unreachable
  cardFeeRate: 0.017,              // C19 - Stripe AU, stripe.com/au/pricing
  roundPriceToCents: 50,           // C20 $0.50
  cardFeeFixedCents: 30,           // C21 $0.30
  packagingPerUnitCents: 13,       // C37 $0.13

  wasteRate: 0.12,                 // C87 8% failed + 4% test prints
  annualFixedCostCents: 30000,     // C47:C50 totalled, $300 insurance
  annualDepreciationCents: 3400,   // C98 $34, printer deliberately excluded
  expectedUnitsPerYear: 1500,      // C52

  parcelCostCents: 1000,           // C56 $10
  freePostageThresholdCents: 8900, // SHIPPING.freeThreshold, and C58 $89
  stallFeeCents: 5000,             // C67 $50
  marketDayTakingsCents: 60000,    // C68 $600

  printerHoursPerYear: 2400,       // C109
  annualContributionTargetCents: 800000, // C110 $8,000
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

// ---- The rest of the model, straight off the Settings sheet ---------------
near("waste multiplier (C87 + 1)", m.wasteMultiplier(S), 1.12);
near("insurance etc per unit (AL)", m.insuranceSharePerUnit(S), 20);
near("equipment wear per unit (AM)", m.depreciationSharePerUnit(S), 2.2666666666666666);
near("overhead per unit (C53, AH)", m.overheadPerUnit(S), 22.266666666666666);
near("online postage share (C41, C61)", m.onlinePostageShare(S), 0.11235955056179775);
near("stall share of takings (C42, C70)", m.stallShare(S), 0.08333333333333333);
near("target $ per printer-hour (C111)", m.targetPerPrinterHour(S), 333.3333333333333);

// ---- The worked example, Products row 5 -----------------------------------
// Excel's own cached values: U5=0.143052, T5=0, V5=0.095, W5=0.13,
// AH5=0.222666666666667, X5=0.590718666666667. J5 overrides filament price to
// $25/kg, but S5 (total grams) is 0, so filament is 0 either way.
const ex = m.unitCost(S, { printHours: 0.75, grams: 0, accessoryCents: 9.5 });
near("worked example, filament (T5)", ex.filament, 0);
near("worked example, machine+power (U5)", ex.machineAndPower, 14.3052);
near("worked example, accessory (V5)", ex.accessory, 9.5);
near("worked example, packaging (W5)", ex.packaging, 13);
near("worked example, overhead (AH5)", ex.insuranceShare + ex.depreciationShare, 22.266666666666666);
near("worked example, UNIT COST (X5)", ex.total, 59.07186666666667);

// Y5=4.5, AG5=4, AI5=4.5, AA5=3.02716335580524, AJ5=4.03621780774033
near("worked example, suggested online (Y5)", m.suggestedPriceForChannel(S, ex.total, m.onlinePostageShare(S)), 450);
near("worked example, suggested stall (AG5)", m.suggestedPriceForChannel(S, ex.total, m.stallShare(S)), 400);
near("worked example, ONE PRICE (AI5)", m.suggestedPrice(S, ex.total), 450);
const ex5 = m.costAtPrice(m.priceTerms(S), 450, ex.total);
near("worked example, profit at that price (AA5)", ex5.profit, 302.716335580524, 1e-4);
near("worked example, $ per printer-hour (AJ5)", m.perPrinterHour(ex5.profit, 0.75), 403.621780774033, 1e-4);

// ---- CLK-001, the macaron: the row every pricing decision was argued on ---
// I6=1.35, S6=21.63, V6=0.34 (ball chain + clickers). Excel's cached values:
// T6=0.3876096, U6=0.2574936, AK6=0.0691182, AH6=0.222666666666667,
// X6=1.33776986666667, Y6=8.5, AG6=7.5, AI6=8.5, Z6=6.49 and then
// AP6=0.41033, AQ6=0.729213483146067, AR6=2.47731334981273,
// AS6=4.01268665018727, AT6=0.618287619443338, AJ6=2.9723604816202.
const mac = m.unitCost(S, { printHours: 1.35, grams: 21.63, accessoryCents: 34 });
near("macaron, filament incl. waste (T6)", mac.filament, 38.76096);
near("macaron, machine+power incl. waste (U6)", mac.machineAndPower, 25.74936);
near("macaron, the waste uplift itself (AK6)", mac.waste, 6.91182);
near("macaron, UNIT COST (X6)", mac.total, 133.77698666666667);
near("macaron, suggested online (Y6)", m.suggestedPriceForChannel(S, mac.total, m.onlinePostageShare(S)), 850);
near("macaron, suggested stall (AG6)", m.suggestedPriceForChannel(S, mac.total, m.stallShare(S)), 750);
near("macaron, ONE PRICE (AI6)", m.suggestedPrice(S, mac.total), 850);

// At the $6.49 the WORKBOOK holds in Z6, against a suggestion of $8.50.
//
// Deliberately still 6.49, and not the $6.50 the shop is being priced at. Every
// `want` on the six lines below is a cell Excel computed from Z6=6.49, so moving
// the input here would compare the code against numbers the sheet never
// produced. This block checks that the code reproduces the workbook; what the
// shop charges is set in the Studio and is not this file's business. When the
// workbook is next saved with 6.50 in Z6, re-read the cells rather than nudging
// these by hand.
const at649 = m.costAtPrice(m.priceTerms(S), 649, mac.total);
near("macaron at $6.49, card fee (AP6)", at649.cardFee, 41.033);
near("macaron at $6.49, postage absorbed (AQ6)", at649.postage, 72.9213483146067, 1e-4);
near("macaron at $6.49, TOTAL COST (AR6)", at649.total, 247.731334981273, 1e-4);
near("macaron at $6.49, PROFIT (AS6)", at649.profit, 401.268665018727, 1e-4);
near("macaron at $6.49, margin (AT6)", at649.margin, 0.618287619443338, 1e-6);
near("macaron at $6.49, $ per printer-hour (AJ6)", m.perPrinterHour(at649.profit, 1.35), 297.23604816202, 1e-4);

// The cut, which is the whole reason the printer-hour bar exists: at $9.00 the
// macaron cleared the $3.33 bar, at $6.49 it does not.
const at900 = m.costAtPrice(m.priceTerms(S), 900, mac.total);
// $4.59 is from the comparison table in claude/planner-workbook-fixes.md, which
// is where the $9.00 column was recorded before the price was cut. It is a
// documented figure rather than a cell this script can read, since Z6 now holds
// 6.49 and the workbook no longer computes the old price anywhere. Asserted to
// the cent it was published at, not to full precision.
near("macaron at $9.00, $ per printer-hour", Math.round(m.perPrinterHour(at900.profit, 1.35)), 459);
console.log(
  m.perPrinterHour(at900.profit, 1.35) > m.targetPerPrinterHour(S) &&
    m.perPrinterHour(at649.profit, 1.35) < m.targetPerPrinterHour(S)
    ? "ok    the $6.49 cut takes the macaron below the printer-hour bar"
    : (failed++, "FAIL  the printer-hour bar should straddle $6.49 and $9.00"),
);

// ---- Rows with a missing input keep saying so ------------------------------
// CLK-002: 1g Light Brown, keyring, no print time. T7=0.01792, X7=0.465586666666667
const clk002 = m.unitCost(S, { printHours: null, grams: 1, accessoryCents: 9.5 });
near("CLK-002 filament (T7)", clk002.filament, 1.792);
near("CLK-002 unit cost (X7)", clk002.total, 46.55866666666667);
console.log(
  clk002.unknown && clk002.missing.join() === "print time"
    ? "ok    CLK-002 is flagged unknown (no print time)"
    : (failed++, "FAIL  CLK-002 should be flagged unknown"),
);

// No grams at all: packaging, accessory and overhead, and nothing earned.
const nothing = m.unitCost(S, { printHours: null, grams: null, accessoryCents: 9.5 });
near("unmeasured row, unit cost", nothing.total, 44.766666666666666);
near("unmeasured row, no waste to uplift", nothing.waste, 0);
console.log(
  nothing.missing.length === 2
    ? "ok    an unmeasured row is missing both inputs"
    : (failed++, "FAIL  an unmeasured row should be missing both inputs"),
);
console.log(
  m.perPrinterHour(100, null) === null
    ? "ok    a piece with no print time earns no measurable $/hour"
    : (failed++, "FAIL  $/hour on an untimed piece should be null, not a number"),
);

// A cost of zero is not a free product, it is an unpriced one.
console.log(
  m.suggestedPrice(S, 0) === null
    ? "ok    a zero cost gives no suggested price"
    : (failed++, "FAIL  a zero cost should give null, not 0"),
);

// Margin + card + channel >= 1 has no solution, and must not return one.
console.log(
  m.suggestedPriceForChannel({ ...S, targetMargin: 0.95 }, 100, 0.1123) === null
    ? "ok    an unreachable margin gives no price"
    : (failed++, "FAIL  an unreachable margin should give null"),
);

// ---- The print queue, column AE -------------------------------------------
near("to print: 5 buffer, 0 on hand, 0 open (AE)", m.toPrint({ onHand: 0, ordered: 0, buffer: 5 }), 5);
near("to print: 5 buffer, 4 on hand, 4 open (AE)", m.toPrint({ onHand: 4, ordered: 4, buffer: 5 }), 5);
near("to print: nothing needed does not go negative", m.toPrint({ onHand: 20, ordered: 1, buffer: 5 }), 0);

console.log(failed === 0 ? "\nOK: costing matches the workbook" : `\nFAIL: ${failed} mismatch(es)`);
process.exit(failed === 0 ? 0 : 1);
