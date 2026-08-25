/**
 * Replays the exact JSON `CartView.checkout()` posts to /api/checkout, so a
 * basket shape can be re-tested without clicking through the browser.
 *
 * Read the results inverted: with a dummy STRIPE_SECRET_KEY the call is meant
 * to die at Stripe, so **502 means every server-side validation passed** and
 * the basket was accepted. 400/409 mean the basket was rejected; 503 means the
 * app is misconfigured (missing service-role key, or collections unavailable).
 *
 * The route rate-limits to 10 requests per 60s per IP, and this file sends 7,
 * so requests are spaced by DELAY_MS (default 1000). Two runs back to back will
 * trip the limit — a 429 makes the run meaningless, so it aborts rather than
 * reporting failures that are really throttling. Raise DELAY_MS to re-run soon.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DELAY = Number(process.env.DELAY_MS ?? 1000);

const CATALOGUE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "lib",
  "fallback-data.ts",
);

/**
 * Product ids are read out of the generated catalogue by SLUG, never written
 * down here.
 *
 * `fallback-N` ids are POSITIONAL: `scripts/generate-seed.mjs` numbers products
 * by their index, so adding or reordering one silently re-points every id after
 * it. Checkout resolves the line by `slug` and only echoes `product_id` back, so
 * a stale hardcoded id would not turn a case red — the harness would keep
 * printing PASS while exercising a different product than the one it names.
 * Deriving the id makes the catalogue the single source and turns that silent
 * drift into a loud abort.
 *
 * The parse is a regex rather than a TypeScript import so the script stays
 * dependency-free and runnable as plain `node`. It leans on one property of the
 * generated file: each product object emits `"id"` immediately followed by
 * `"slug"`. Nested `attachments` emit `"id"` followed by `"label"`, so they
 * cannot match; `FALLBACK_COLLECTIONS` is sliced off first so a collection slug
 * can never resolve a product id.
 */
function loadProductIds() {
  let source;
  try {
    source = readFileSync(CATALOGUE, "utf8");
  } catch (error) {
    abort(`Could not read ${CATALOGUE}: ${error.message}`);
  }

  const start = source.indexOf("export const FALLBACK_PRODUCTS");
  if (start < 0) abort(`No FALLBACK_PRODUCTS export in ${CATALOGUE}.`);
  const next = source.indexOf("\nexport const", start + 1);
  const products = next < 0 ? source.slice(start) : source.slice(start, next);

  const ids = new Map();
  for (const [, id, slug] of products.matchAll(
    /"id":\s*"([^"]+)"\s*,\s*"slug":\s*"([^"]+)"/g,
  )) {
    if (!ids.has(slug)) ids.set(slug, id);
  }
  if (ids.size === 0) {
    abort(
      `Parsed 0 products out of ${CATALOGUE}. The generated shape has changed ` +
        `— this parser assumes "id" is emitted immediately before "slug".`,
    );
  }
  return ids;
}

function abort(message) {
  console.error(`\n${message}`);
  console.error("Refusing to guess a product id — this run would be a lie.");
  process.exit(3);
}

const PRODUCT_IDS = loadProductIds();

/** Loud on a miss: a guessed id is exactly the drift this replaces. */
function idFor(slug) {
  const id = PRODUCT_IDS.get(slug);
  if (!id) {
    abort(
      `No product with slug "${slug}" in ${CATALOGUE} ` +
        `(${PRODUCT_IDS.size} products parsed). Regenerate the catalogue ` +
        `(node scripts/generate-seed.mjs) or fix the slug in this file.`,
    );
  }
  return id;
}

// Key order and omitted-vs-null match CartView: `custom` and
// `personalisation_text` are absent (not null) when the line has neither.
const charm = () => ({ product_id: idFor("custom-name-charm"), slug: "custom-name-charm", colour: "Matcha Latte", attachment_id: "cord", quantity: 1, custom: { collection_slug: "matcha-latte", collection_name: "Matcha Latte", letters: "MIA", with_charm: true } });
const alphabet = () => ({ product_id: idFor("alphabet-bag-charm-on-cord"), slug: "alphabet-bag-charm-on-cord", colour: "Strawberry Milk", attachment_id: "cord", quantity: 1, custom: { collection_slug: "strawberry-milk", collection_name: "Strawberry Milk", letters: "LEO", with_charm: false } });
const dateChain = () => ({ product_id: idFor("custom-number-date-chain"), slug: "custom-number-date-chain", colour: null, attachment_id: "keyring", quantity: 1, personalisation_text: "12/07/2024" });
const bowl = () => ({ product_id: idFor("personalised-bowl-with-pet-s-name"), slug: "personalised-bowl-with-pet-s-name", colour: null, attachment_id: null, quantity: 1, personalisation_text: "Mochi" });
const roll = () => ({ product_id: idFor("cinnamon-roll"), slug: "cinnamon-roll", colour: "Light Brown", attachment_id: "keyring", quantity: 1 });
const mixed = () => ({ lines: [charm(), alphabet(), dateChain(), bowl(), roll()], shipping_method: "standard", gift_note: "Happy birthday Mia!" });

// Case 7 is the negative control: an ordinary product carrying text it has no
// personalisation_mode for. If this one also returns 502 the harness is not
// actually observing validation and every PASS above it is worthless.
const rejected = () => {
  const body = mixed();
  body.lines[4] = { ...roll(), personalisation_text: "Nope" };
  return body;
};

const CASES = [
  ["custom-name-charm (builder)", 502, { lines: [charm()], shipping_method: "standard" }],
  ["alphabet-bag-charm (builder)", 502, { lines: [alphabet()], shipping_method: "standard" }],
  ["custom-number-date-chain (text)", 502, { lines: [dateChain()], shipping_method: "standard" }],
  ["personalised-bowl (text)", 502, { lines: [bowl()], shipping_method: "standard" }],
  ["cinnamon-roll (ordinary)", 502, { lines: [roll()], shipping_method: "standard" }],
  ["mixed basket (5 lines)", 502, mixed()],
  ["NEGATIVE: text on ordinary", 400, rejected()],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rows = [];
for (const [name, expected, body] of CASES) {
  if (rows.length > 0) await sleep(DELAY);
  const res = await fetch(`${BASE}/api/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));

  if (res.status === 429) {
    console.error(`\n429 on "${name}" — rate limited. Run is INVALID.`);
    console.error(`Wait 60s and retry, or set DELAY_MS higher.`);
    process.exit(2);
  }
  const note = data.url ? "url present" : String(data.error ?? "");
  rows.push({ name, expected, actual: res.status, pass: res.status === expected, note: note.slice(0, 120) });
}

const w = (k, min) => Math.max(min, ...rows.map((r) => String(r[k]).length));
const nw = w("name", 4);
console.log(`\n${"case".padEnd(nw)}  exp  got  result  detail`);
console.log("-".repeat(nw + 40));
for (const r of rows) {
  console.log(`${r.name.padEnd(nw)}  ${String(r.expected).padStart(3)}  ${String(r.actual).padStart(3)}  ${(r.pass ? "PASS" : "FAIL").padEnd(6)}  ${r.note}`);
}

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length - failed.length}/${rows.length} passed.`);
if (!rows[6]?.pass) console.log("Negative control did NOT reject — treat this harness as broken.");
process.exit(failed.length > 0 ? 1 : 0);
