import type { MetadataRoute } from "next";
import { getProducts, isDatabaseConfigured } from "@/lib/queries";
import { siteUrl } from "@/lib/stripe";

/**
 * /sitemap.xml — also a measured 404 on the live site, so Google had no list
 * of this shop's URLs and had to find every product by following links.
 *
 * ── Dynamic on purpose ───────────────────────────────────────────────────
 * A sitemap prerendered at build time lists the products that existed when
 * the image was built. The owner adds and retires products through /admin
 * without rebuilding, so a baked list would go stale the first time she does,
 * silently, and keep advertising retired slugs while omitting new ones. That
 * is the same class of defect as a stale bake on the legal pages, and it is
 * cheap to avoid: this route is rendered per request, and a sitemap is fetched
 * by crawlers, not by shoppers.
 *
 * (It would have become dynamic regardless — `getProducts` reaches Supabase
 * through `createClient()`, which reads `cookies()` — but that is a side
 * effect, and a side effect is not a decision. The declaration is the record.)
 *
 * ── The origin ───────────────────────────────────────────────────────────
 * Sitemap `<loc>` must be absolute, so every URL here is built from
 * `siteUrl()` — the same value `metadataBase` and every canonical resolve
 * against. Nothing in this file names a host. `NEXT_PUBLIC_SITE_URL` is
 * constant-folded at build (CLAUDE.md), so attaching `bamstudioshop.com` is a
 * rebuild and this file does not have to be found and edited.
 *
 * ── What is in it ────────────────────────────────────────────────────────
 * A sitemap is a claim that these URLs exist, are the canonical address of
 * real content, and are worth indexing. So it lists only pages a signed-out
 * visitor can actually see, and only pages that do not carry a `noindex` of
 * their own. Deliberately absent:
 *
 *  • `/search` and `/order/confirmed` — both set `robots: { index: false }`.
 *    Submitting a URL you have asked Google not to index is a contradiction.
 *  • `/cart`, `/login`, `/signup`, `/forgot-password`, `/reset-password` —
 *    functional pages, noindexed in their own metadata, nothing to rank.
 *  • `/account/*`, `/admin/*`, `/api/*`, `/auth/*` — see `app/robots.ts`.
 *  • Filtered, sorted and paginated `/shop?…` URLs — they are views of the
 *    catalogue, not pages in their own right, and each one canonicalises back
 *    to `/shop`. Every product they could lead to is listed here directly.
 *
 * ── No `lastModified`, and that is the honest answer ──────────────────────
 * `public.products` has `created_at` and no `updated_at` (0001_init.sql), and
 * `created_at` is not even on the `Product` type. "When the row was inserted"
 * is not "when this page last changed" — the owner edits price, copy, colours
 * and stock through /admin without touching it. Emitting it as `<lastmod>`
 * would be a plausible-looking date that is wrong every time a product is
 * edited, and `new Date()` would be worse: a sitemap claiming every page in
 * the shop changed the instant a crawler asked. Google treats an untrustworthy
 * `<lastmod>` by ignoring the field site-wide, so a fabricated one buys
 * nothing and costs the field's credibility. It is omitted until there is a
 * column that means it. `changeFrequency` and `priority` are omitted for the
 * same reason with less to say for them — Google states it ignores both.
 */
export const dynamic = "force-dynamic";

/**
 * Every public, indexable, statically-addressed page in the shop.
 *
 * "" is the home page — joined onto the origin it gives the bare origin,
 * which is what `<loc>` wants for a site root.
 */
const STATIC_PATHS = [
  "",
  "/shop",
  "/collections",
  "/builder",
  "/about",
  "/faq",
  "/contact",
  "/track",
  "/legal/privacy",
  "/legal/terms",
  "/legal/refunds",
] as const;

/**
 * Supabase's PostgREST caps a response at 1000 rows however large the range
 * asked for, so this pages rather than asking for "everything" once and
 * quietly getting a truncated catalogue. The cap is a guard against a loop,
 * not a limit anybody is expected to reach: the catalogue is in the dozens.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 40;

/**
 * Slugs of every ACTIVE product, from the same `getProducts()` the shop
 * itself lists with — so the sitemap cannot advertise a product the shopfront
 * would 404 on. `active` is filtered inside that function, not here.
 *
 * Returns an empty list rather than throwing, in two cases that are not the
 * same thing:
 *
 *  • Supabase unconfigured. `getProducts()` would happily serve
 *    `FALLBACK_PRODUCTS` — the bundled sample catalogue that makes
 *    `npm run dev` work on a fresh clone. Those slugs are not merchandise.
 *    Submitting them to Google would be this shop telling the world it sells
 *    twenty-odd things it has never made, and the sample catalogue is exactly
 *    what a misconfigured deploy serves (fly.toml: "silent-wrong is worse
 *    than loud-missing"). So the check is explicit and comes first.
 *  • The query failed. `getProducts()` logs and returns an empty page. A
 *    sitemap of static pages is a worse sitemap; a 500 to Googlebot is a
 *    broken one, and repeated 5xx on /sitemap.xml is a signal about the site,
 *    not about the request. Degrade to the static entries.
 */
async function activeProductSlugs(): Promise<string[]> {
  if (!isDatabaseConfigured()) return [];

  const slugs: string[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { products, total } = await getProducts({
        page,
        perPage: PAGE_SIZE,
      });
      if (products.length === 0) break;
      for (const product of products) slugs.push(product.slug);
      if (slugs.length >= total) break;
    }
  } catch (error) {
    // Reaching here means Supabase was configured and still could not be
    // read. Say so in the logs; hand Googlebot the static pages.
    console.error(
      "sitemap: product lookup failed, serving static entries only:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const slugs = await activeProductSlugs();

  return [
    ...STATIC_PATHS.map((path) => ({ url: `${origin}${path}` })),
    ...slugs.map((slug) => ({ url: `${origin}/product/${slug}` })),
  ];
}
