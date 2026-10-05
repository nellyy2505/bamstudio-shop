/**
 * The listing file format used by the bulk listing import in the studio
 * (/admin/products/import), shared by the browser (preview) and the server
 * (apply). Written by hand, by Claude, or edited from the studio's own export.
 *
 *   {
 *     "format": "bamstudio-listings/1",
 *     "products": [
 *       {
 *         "sku": "CLK-001",                       // required: how a row is found
 *         "name": "Macaron clicker keychain",
 *         "short_name": "Macaron",
 *         "description": "A palm-sized macaron ...",
 *         "details": [{ "title": "Materials & care", "body": "..." }],
 *         "category": "Clicker keychain",
 *         "theme": "Food",
 *         "price": 6.5,                           // dollars, optional
 *         "weight_grams": 18,                     // optional
 *         "active": true, "is_new": true, "is_bestseller": false,
 *         "photos": ["CLK-001-1.jpg", "CLK-001-2.jpg"],   // first is the cover
 *         "photo_alt": ["Pink macaron clicker on a keyring", "..."],
 *         "replace_photos": true,
 *         "slug": "macaron"                       // only needed for a NEW product
 *       }
 *     ]
 *   }
 *
 * Every field except `sku` is optional. A field that is absent is left alone;
 * this file can never blank a column by omission.
 */

export const LISTINGS_FORMAT = "bamstudio-listings/1";

export type ListingEntry = {
  sku: string;
  slug?: string;
  name?: string;
  short_name?: string;
  description?: string;
  details?: { title: string; body: string }[];
  category?: string;
  theme?: string;
  price?: number;
  weight_grams?: number;
  active?: boolean;
  is_new?: boolean;
  is_bestseller?: boolean;
  photos?: string[];
  photo_alt?: string[];
  replace_photos?: boolean;
};

const LIMITS = {
  name: 120,
  short_name: 80,
  description: 2000,
  category: 60,
  theme: 60,
  detailTitle: 60,
  detailBody: 1200,
  details: 8,
  photos: 10,
};

/** Validate one entry. Returns the cleaned entry or a sentence saying what is wrong. */
export function checkEntry(raw: unknown): { entry: ListingEntry } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Not a listing." };
  const r = raw as Record<string, unknown>;
  const sku = typeof r.sku === "string" ? r.sku.trim() : "";
  if (!sku) return { error: "Every listing needs a sku." };
  if (sku.length > 40) return { error: `${sku}: the SKU is too long.` };

  const entry: ListingEntry = { sku };
  const str = (key: keyof typeof LIMITS & keyof ListingEntry) => {
    if (r[key] === undefined || r[key] === null) return null;
    if (typeof r[key] !== "string") return `${sku}: ${key} has to be text.`;
    const value = (r[key] as string).trim();
    if (value.length > LIMITS[key]) return `${sku}: ${key} is longer than ${LIMITS[key]} characters.`;
    (entry as Record<string, unknown>)[key] = value;
    return null;
  };
  for (const key of ["name", "short_name", "description", "category", "theme"] as const) {
    const problem = str(key);
    if (problem) return { error: problem };
  }
  if (entry.name === "") return { error: `${sku}: name cannot be empty.` };

  if (r.slug !== undefined) {
    if (typeof r.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug)) {
      return { error: `${sku}: slug can only use lowercase letters, numbers and hyphens.` };
    }
    entry.slug = r.slug;
  }

  if (r.details !== undefined) {
    if (!Array.isArray(r.details) || r.details.length > LIMITS.details) {
      return { error: `${sku}: details has to be a list of up to ${LIMITS.details} sections.` };
    }
    const details: { title: string; body: string }[] = [];
    for (const d of r.details) {
      const title = typeof d?.title === "string" ? d.title.trim() : "";
      const body = typeof d?.body === "string" ? d.body.trim() : "";
      if (!title || !body) return { error: `${sku}: each detail needs a title and a body.` };
      if (title.length > LIMITS.detailTitle || body.length > LIMITS.detailBody) {
        return { error: `${sku}: a detail section is too long.` };
      }
      details.push({ title, body });
    }
    entry.details = details;
  }

  if (r.price !== undefined && r.price !== null) {
    const price = Number(r.price);
    if (!Number.isFinite(price) || price <= 0 || price > 999.99) {
      return { error: `${sku}: price has to be dollars between 0.01 and 999.99, like 6.5.` };
    }
    entry.price = Math.round(price * 100) / 100;
  }
  if (r.weight_grams !== undefined && r.weight_grams !== null) {
    const w = Number(r.weight_grams);
    if (!Number.isFinite(w) || w <= 0 || w > 22000) {
      return { error: `${sku}: weight_grams has to be between 1 and 22000.` };
    }
    entry.weight_grams = Math.round(w);
  }
  for (const key of ["active", "is_new", "is_bestseller", "replace_photos"] as const) {
    if (r[key] === undefined || r[key] === null) continue;
    if (typeof r[key] !== "boolean") return { error: `${sku}: ${key} has to be true or false.` };
    entry[key] = r[key] as boolean;
  }
  for (const key of ["photos", "photo_alt"] as const) {
    if (r[key] === undefined || r[key] === null) continue;
    const list = r[key];
    if (!Array.isArray(list) || list.length > LIMITS.photos || list.some((v) => typeof v !== "string")) {
      return { error: `${sku}: ${key} has to be a list of up to ${LIMITS.photos} names.` };
    }
    entry[key] = (list as string[]).map((v) => v.trim().slice(0, 200));
  }
  return { entry };
}

/** Parse a whole listings file. */
export function parseListings(text: string): { entries: ListingEntry[]; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { entries: [], errors: ["That file is not valid JSON."] };
  }
  const products = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { products?: unknown }).products)
      ? (data as { products: unknown[] }).products
      : null;
  if (!products) return { entries: [], errors: ['Expected {"products": [...]}.'] };

  const entries: ListingEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const raw of products) {
    const result = checkEntry(raw);
    if ("error" in result) errors.push(result.error);
    else if (seen.has(result.entry.sku.toLowerCase())) errors.push(`${result.entry.sku} appears twice.`);
    else {
      seen.add(result.entry.sku.toLowerCase());
      entries.push(result.entry);
    }
  }
  return { entries, errors };
}

/**
 * The photo files that belong to an entry: the ones it names, in that order,
 * or, if it names none, every uploaded file whose name starts with its SKU
 * ("CLK-001-1.jpg", "clk-001_2.png", "CLK-001.jpg"), in natural order.
 */
export function matchPhotos<T extends { name: string }>(entry: ListingEntry, files: T[]): {
  matched: T[];
  missing: string[];
} {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  if (entry.photos && entry.photos.length > 0) {
    const matched: T[] = [];
    const missing: string[] = [];
    for (const name of entry.photos) {
      const file = byName.get(name.toLowerCase());
      if (file) matched.push(file);
      else missing.push(name);
    }
    return { matched, missing };
  }
  const prefix = entry.sku.toLowerCase();
  const matched = files
    .filter((f) => {
      const n = f.name.toLowerCase();
      return n.startsWith(prefix) && /^[-_. ]/.test(n.slice(prefix.length) || ".");
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { matched, missing: [] };
}
