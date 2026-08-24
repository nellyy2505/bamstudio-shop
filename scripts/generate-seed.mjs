/**
 * Generates supabase/seed.sql from the 3D_Planner workbook.
 *
 *   node scripts/generate-seed.mjs [path-to-xlsx]
 *
 * The workbook is the source of truth for SKUs, names, categories and themes.
 * Art keys, tints and copy are mapped here because the sheet has no artwork
 * column — extend ART_BY_SKU when you add products.
 *
 * Prices: the sheet's "My price" column is authoritative once filled. Until
 * then we fall back to PRICE_BY_CATEGORY so the shop has something to show.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const XLSX =
  process.argv[2] ??
  path.resolve(process.cwd(), "..", "Documents", "3D_Planner.xlsx");

/* ---------------- mapping tables (edit these as the range grows) ---------- */

const ART_BY_SKU = {
  "CLK-001": ["macaron", "blush"],
  "CLK-002": ["cinnamon", "butter"],
  "CLK-003": ["smore", "butter"],
  "CLK-006": ["sushi", "sky"],
  "CLK-008": ["icecream", "blush"],
  "CLK-009": ["icecream", "blush"],
  "CLK-013": ["butter", "butter"],
  "CLK-017": ["cinnamon", "cream"],
  "CLK-018": ["bao", "blush"],
  "CLK-019": ["pancake", "butter"],
  "CLK-020": ["bao", "cream"],
  "CLK-021": ["bao", "sage"],
  "CLK-023": ["coffee", "cream"],
  "CLK-027": ["matcha", "sage"],
  "CLK-01": ["corgi", "butter"],
  "CLK-031": ["corgi", "cream"],
  "CLK-032": ["corgi", "butter"],
  "CLK-035": ["corgi", "blush"],
  "CLK-038": ["corgi", "blush"],
  "CLK-039": ["corgi", "cream"],
  "CLK-042": ["cactus", "sage"],
  "CLK-043": ["cactus", "sage"],
  "CLK-044": ["cactus", "sage"],
  "CLK-046": ["tulip", "blush"],
  "CLK-048": ["tulip", "blush"],
  "CLK-049": ["tulip", "butter"],
  "CLK-050": ["tulip", "cream"],
  "CLK-053": ["tulip", "sage"],
  "CLK-057": ["letters", "lilac"],
  "CLK-058": ["letters", "lilac"],
  "CLK-059": ["letters", "lilac"],
  "CLK-061": ["letters", "lilac"],
  "CLK-063": ["letters", "blush"],
  "CLK-064": ["letters", "sky"],
  "CLK-073": ["tennis", "sky"],
  "CLK-074": ["tennis", "sage"],
  "CLK-075": ["tennis", "sky"],
  "CLK-076": ["tennis", "cream"],
  "CLK-077": ["tennis", "sky"],
  "PET-002": ["corgi", "cream"],
  "PHB-001": ["stand", "sky"],
  "PHB-002": ["stand", "cream"],
  "PHB-003": ["stand", "blush"],
  "PHB-004": ["letters", "lilac"],
};

const ART_BY_THEME = {
  Food: ["croissant", "butter"],
  Drinks: ["coffee", "cream"],
  Animals: ["corgi", "butter"],
  "Animals in carton box": ["corgi", "cream"],
  "Plants & flowers": ["cactus", "sage"],
  "Letters & names": ["letters", "lilac"],
  Sport: ["tennis", "sky"],
  "Phone & bag": ["stand", "sky"],
  Pet: ["corgi", "cream"],
  "Display & packaging": ["stand", "cream"],
  "Market offer": ["macaron", "blush"],
};

/** Fallback pricing, in cents, until "My price" is filled in the workbook. */
const PRICE_BY_CATEGORY = {
  "Clicker keychain": 900,
  "Letters & names": 1400,
  Pet: 1800,
  "Phone & bag": 1500,
  "Display & packaging": 2200,
  "Market offer": 1500,
};

const BESTSELLERS = new Set(["CLK-027", "CLK-001", "CLK-01", "CLK-023"]);
const NEW_ITEMS = new Set(["CLK-018", "CLK-019", "CLK-046", "PHB-001"]);
/**
 * How each personalised product collects what to print.
 *
 *  "builder" — the keycap letter builder, priced by BUILDER_PRICING, so its
 *              catalogue price is only a "from" figure.
 *  "text"    — one free-text line on the product page, priced at the
 *              product's own price. The label is the field's prompt.
 *
 * A product NOT listed here is not personalised. Checkout refuses a builder
 * payload on anything that isn't "builder", so this table is load-bearing.
 */
const PERSONALISATION = {
  "CLK-059": { mode: "builder", label: null },
  "PHB-004": { mode: "builder", label: null },
  "CLK-061": { mode: "text", label: "Numbers or date to print" },
  "PET-002": { mode: "text", label: "Pet's name" },
};

const PERSONALISED = new Set(Object.keys(PERSONALISATION));

/**
 * Cheapest builder bundle. Builder products are listed at this price so the
 * page, the card and the JSON-LD all advertise a figure the builder can
 * actually charge.
 *
 * Read out of lib/config.ts rather than duplicated: a .mjs script can't import
 * the TypeScript module, but it can parse the one literal it needs, so editing
 * BUILDER_PRICING can't silently leave the catalogue advertising a price the
 * builder no longer offers.
 */
const BUILDER_FROM_PRICE = readBuilderFromPrice();

function readBuilderFromPrice() {
  const config = readFileSync(
    path.resolve(import.meta.dirname, "..", "lib", "config.ts"),
    "utf8",
  );
  const block = config.match(
    /BUILDER_PRICING:\s*Record<number,\s*number>\s*=\s*\{([^}]*)\}/,
  );
  const prices = [...(block?.[1] ?? "").matchAll(/:\s*(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  if (prices.length === 0) {
    throw new Error(
      "Could not read BUILDER_PRICING from lib/config.ts — builder products " +
        "would be listed at a price the builder cannot charge.",
    );
  }
  return Math.min(...prices);
}

/** Categories we don't sell online (stall infrastructure and stall mechanics). */
const SKIP_CATEGORIES = new Set(["Display & packaging", "Market offer"]);

/**
 * Licensed characters never go in the shop — listing them is what gets shops
 * pulled from marketplaces. Keep this list in sync with the workbook.
 */
const LICENSED_SKUS = new Set(["CLK-038"]); // Hello Kitty

const ATTACHMENT_SETS = {
  Keyring: [
    { id: "keyring", label: "Keyring", price_delta: 0 },
    { id: "strap", label: "Phone strap", price_delta: 100 },
    { id: "cord", label: "Bag charm cord", price_delta: 150 },
    { id: "none", label: "No attachment", price_delta: -50 },
  ],
  "Bag charm cord": [
    { id: "cord", label: "Bag charm cord", price_delta: 0 },
    { id: "keyring", label: "Keyring", price_delta: 0 },
    { id: "strap", label: "Phone strap", price_delta: 0 },
  ],
  "Phone strap": [
    { id: "strap", label: "Phone strap", price_delta: 0 },
    { id: "keyring", label: "Keyring", price_delta: 0 },
  ],
  None: [],
};

const COLOUR_HEX = {
  White: "#FFFFFF",
  Black: "#2B2B2B",
  Grey: "#9AA0A6",
  Beige: "#E9DCC4",
  Brown: "#8B5E3C",
  "Light Brown": "#B08968",
  "Dark Brown": "#5B4636",
  Red: "#D64545",
  Green: "#6D9557",
  "Baby Green": "#BFD6A8",
  "Dark Green": "#3F5D3A",
  "Matcha Green": "#A9BC7F",
  "Baby Blue": "#BCD3E8",
  "Baby Pink": "#F6CFD8",
  "Hot Pink": "#E75480",
  Yellow: "#F2C94C",
  "Baby Yellow": "#F2D98B",
  "Baby Orange": "#F3B98A",
};

/* ---------------- read the workbook via Python (openpyxl) ---------------- */

function readProducts() {
  const script = `
import json, sys, warnings
warnings.filterwarnings('ignore')
import openpyxl
wb = openpyxl.load_workbook(r'''${XLSX}''', data_only=True)
ws = wb['Products']
rows = list(ws.iter_rows(values_only=True))
header = None
out = []
for r in rows:
    if r and r[0] == 'Channel':
        header = list(r)
        continue
    if header is None or not r or not r[1]:
        continue
    rec = {}
    for i, key in enumerate(header):
        if key is None: continue
        rec[str(key)] = r[i] if i < len(r) else None
    out.append(rec)
print(json.dumps(out, default=str))
`;
  const raw = execFileSync("python", ["-c", script], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

/* ---------------- helpers ---------------- */

const q = (v) =>
  v === null || v === undefined || v === ""
    ? "null"
    : `'${String(v).replace(/'/g, "''")}'`;

const json = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function priceFor(row) {
  const sku = String(row.SKU ?? "").trim();
  // Builder charms are priced by letter count at checkout, so the catalogue
  // price is the cheapest bundle — never the sheet's flat figure, which the
  // builder can never charge.
  if (PERSONALISATION[sku]?.mode === "builder") return BUILDER_FROM_PRICE;

  const my = Number(row["My price"]);
  if (Number.isFinite(my) && my > 0) return Math.round(my * 100);
  return PRICE_BY_CATEGORY[row.Category] ?? 1000;
}

function coloursFor(row) {
  const names = [
    row["Colour 1"],
    row["Colour 2"],
    row["Colour 3"],
    row["Colour 4"],
  ].filter((c) => c && COLOUR_HEX[c]);
  const unique = [...new Set(names)];
  if (unique.length === 0) return [];
  return unique.map((name) => ({ name, hex: COLOUR_HEX[name] }));
}

function describe(row) {
  const theme = row.Theme ?? "";
  const isClicker = String(row.Category ?? "").includes("Clicker");
  const base = isClicker
    ? `A palm-sized ${String(row.Product).toLowerCase()} with a spring-loaded clicker inside — the fidget you keep reaching for.`
    : `A ${String(row.Product).toLowerCase()}, 3D-printed to order in our Sydney studio.`;
  const note = row.Notes ? ` ${row.Notes}` : "";
  return `${base} Printed in layered PLA and finished by hand.${note} Theme: ${theme}.`;
}

/* ---------------- build ---------------- */

const rows = readProducts().filter(
  (r) =>
    r.SKU &&
    !String(r.SKU).startsWith("EXAMPLE") &&
    r.Product &&
    !SKIP_CATEGORIES.has(r.Category) &&
    !LICENSED_SKUS.has(String(r.SKU).trim()) &&
    !String(r.SKU).startsWith("KEY-H"),
);

const excluded = readProducts().filter((r) =>
  LICENSED_SKUS.has(String(r.SKU ?? "").trim()),
);
if (excluded.length) {
  console.warn(
    `Excluded ${excluded.length} licensed-character row(s): ${excluded
      .map((r) => `${r.SKU} ${r.Product}`)
      .join(", ")}`,
  );
}

const seenSlug = new Set();
const values = rows.map((row) => {
  const sku = String(row.SKU).trim();
  const [art, tint] =
    ART_BY_SKU[sku] ?? ART_BY_THEME[row.Theme] ?? ["macaron", "blush"];

  let slug = slugify(row.Product);
  if (seenSlug.has(slug)) slug = `${slug}-${slugify(sku)}`;
  seenSlug.add(slug);

  const attachments = ATTACHMENT_SETS[row.Attachment] ?? ATTACHMENT_SETS.None;
  const price = priceFor(row);
  const colours = coloursFor(row);
  const isPersonalised = PERSONALISED.has(sku);

  const details = [
    { title: "Item details", body: describe(row) },
    {
      title: "Materials & care",
      body: "PLA bioplastic with a steel clicker mechanism. Keep it out of hot cars and dishwashers — a wipe with a damp cloth is all it needs.",
    },
    {
      title: "Shipping & returns",
      body: isPersonalised
        ? "Printed to order in 2–4 business days, then standard post (3–7 days) or express (1–3 days). Personalised items can only be returned if faulty."
        : "Printed to order in 2–4 business days, then standard post (3–7 days) or express (1–3 days). 30-day returns on unused items.",
    },
  ];

  return `  (${[
    q(slug),
    q(sku),
    q(`${row.Product} — ${row.Category}`),
    q(row.Product),
    q(row.Category),
    q(row.Theme ?? "Other"),
    q(describe(row)),
    price,
    q(art),
    q(tint),
    json([{ art, tint, alt: `${row.Product} — front view` }]),
    json(colours),
    json(attachments),
    json(details),
    // rating / review_count: the shop has never sold online, so there is no
    // review history. Real reviews arrive through the reviews table once
    // customers write them, and these columns are recomputed from those.
    0,
    0,
    // stock_on_hand: nothing is printed ahead — everything is made to order.
    // Set from real counts once we start printing stock in advance.
    0,
    BESTSELLERS.has(sku),
    NEW_ITEMS.has(sku),
    isPersonalised,
    q(PERSONALISATION[sku]?.mode ?? null),
    q(PERSONALISATION[sku]?.label ?? null),
  ].join(", ")})`;
});

const COLLECTIONS = [
  ["retro-key", "Retro Key", "#E9DCC4", "#5B4636", "#B08968", "coffee", "Tiramisu Cake", "cream", false],
  ["strawberry-milk", "Strawberry Milk", "#F6CFD8", "#FFFFFF", "#E75480", "icecream", "Ice Cream Cone", "blush", false],
  ["matcha-latte", "Matcha Latte", "#A9BC7F", "#FFFFFF", "#B08968", "matcha", "Matcha Set", "sage", true],
  ["blueberry", "Blueberry", "#BCD3E8", "#FFFFFF", "#9AA0A6", "macaron", "Macaron", "sky", false],
  ["mono", "Mono", "#FFFFFF", "#252220", "#2B2B2B", "smore", "S'mores", "cream", false],
  ["butter-toast", "Butter Toast", "#F2D98B", "#5B4636", "#E4D5BC", "butter", "Butter", "butter", false],
];

const sql = `-- Generated by scripts/generate-seed.mjs — do not edit by hand.
-- Source: 3D_Planner.xlsx (Products sheet)
-- Regenerate with: node scripts/generate-seed.mjs

begin;

delete from public.reviews;
delete from public.products;
delete from public.collections;

insert into public.products (
  slug, sku, name, short_name, category, theme, description, price,
  art, tint, gallery, colours, attachments, details,
  rating, review_count, stock_on_hand, is_bestseller, is_new, is_personalised,
  personalisation_mode, personalisation_label
) values
${values.join(",\n")};

insert into public.collections (
  slug, name, cap_colour, letter_colour, holder_colour,
  charm_art, charm_name, tint, is_popular, sort_order
) values
${COLLECTIONS.map(
  (c, i) =>
    `  (${q(c[0])}, ${q(c[1])}, ${q(c[2])}, ${q(c[3])}, ${q(c[4])}, ${q(c[5])}, ${q(c[6])}, ${q(c[7])}, ${c[8]}, ${i})`,
).join(",\n")};

-- No seeded reviews: the shop has never sold online, so inventing any would be
-- misleading conduct. Real reviews arrive through public.reviews once customers
-- write them, and products.rating / review_count are recomputed from those.

commit;
`;

mkdirSync("supabase", { recursive: true });
writeFileSync("supabase/seed.sql", sql);

/* ------ also emit a typed fallback catalogue for local dev without a DB ---- */

const fallbackProducts = rows.map((row, index) => {
  const sku = String(row.SKU).trim();
  const [art, tint] =
    ART_BY_SKU[sku] ?? ART_BY_THEME[row.Theme] ?? ["macaron", "blush"];
  let slug = slugify(row.Product);
  const isPersonalised = PERSONALISED.has(sku);

  return {
    id: `fallback-${index}`,
    slug,
    sku,
    name: `${row.Product} — ${row.Category}`,
    short_name: String(row.Product),
    category: String(row.Category),
    theme: String(row.Theme ?? "Other"),
    description: describe(row),
    price: priceFor(row),
    art,
    tint,
    gallery: [{ art, tint, alt: `${row.Product} — front view` }],
    colours: coloursFor(row),
    attachments: ATTACHMENT_SETS[row.Attachment] ?? ATTACHMENT_SETS.None,
    details: [
      { title: "Item details", body: describe(row) },
      {
        title: "Materials & care",
        body: "PLA bioplastic with a steel clicker mechanism. Keep it out of hot cars and dishwashers.",
      },
    ],
    // No review history exists yet — real reviews arrive through the reviews
    // table once customers write them.
    rating: 0,
    review_count: 0,
    // Nothing is printed ahead; set from real counts once we stock in advance.
    stock_on_hand: 0,
    is_bestseller: BESTSELLERS.has(sku),
    is_new: NEW_ITEMS.has(sku),
    is_personalised: isPersonalised,
    personalisation_mode: PERSONALISATION[sku]?.mode ?? null,
    personalisation_label: PERSONALISATION[sku]?.label ?? null,
    active: true,
  };
});

// Slug collisions would break routing; make them unique the same way as SQL.
const slugSeen = new Set();
for (const product of fallbackProducts) {
  if (slugSeen.has(product.slug)) product.slug = `${product.slug}-${slugify(product.sku)}`;
  slugSeen.add(product.slug);
}

const fallbackCollections = COLLECTIONS.map((c, i) => ({
  id: `collection-${i}`,
  slug: c[0],
  name: c[1],
  cap_colour: c[2],
  letter_colour: c[3],
  holder_colour: c[4],
  charm_art: c[5],
  charm_name: c[6],
  tint: c[7],
  is_popular: c[8],
}));

const ts = `// Generated by scripts/generate-seed.mjs — do not edit by hand.
// Sample catalogue used when Supabase env vars are absent, so the app runs
// on a fresh clone. Regenerate with: node scripts/generate-seed.mjs
import type { Collection, Product } from "./types";

export const FALLBACK_PRODUCTS: Product[] = ${JSON.stringify(fallbackProducts, null, 2)};

export const FALLBACK_COLLECTIONS: Collection[] = ${JSON.stringify(fallbackCollections, null, 2)};
`;

mkdirSync("lib", { recursive: true });
writeFileSync("lib/fallback-data.ts", ts);

console.log(
  `Wrote supabase/seed.sql and lib/fallback-data.ts — ${values.length} products, ${COLLECTIONS.length} collections, 0 reviews.`,
);
