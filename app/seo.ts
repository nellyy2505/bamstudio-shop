import type { Metadata } from "next";
import { SHOP } from "@/lib/config";

/**
 * The two things every indexable page has to say about its own address, and
 * the one place they are said.
 *
 * Defect this closes: the live site served no `rel=canonical` and no `og:url`
 * on any page. Every listing in this shop answers on several addresses —
 * `/shop`, `/shop?category=…`, `/shop?theme=…`, `?sort=`, `?page=`, and any
 * URL a campaign hangs `?utm_source=` off — so nothing told Google which of
 * them is the page. Product pages had the same hole: a shared link carrying
 * tracking parameters was, to a crawler, a second product page with identical
 * copy.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 * `openGraph` is *shallowly* merged and then REPLACED, not deep-merged:
 * "metadata with nested fields such as openGraph and robots that are defined
 * in an earlier segment are overwritten by the last segment to define them"
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * generate-metadata.md). So a page that sets `openGraph: { url }` on its own
 * silently drops the root layout's `type`, `siteName` and `locale`. The Next
 * docs' own remedy is to pull the shared fields into a variable — this one —
 * and spread it. `app/layout.tsx` uses the same constant, so there is one
 * copy of the site's Open Graph identity rather than one per page.
 *
 * ── Why the paths here are relative ──────────────────────────────────────
 * `metadataBase` in `app/layout.tsx` is `new URL(siteUrl())`, and Next
 * composes every relative URL-based metadata field against it. So the origin
 * of every canonical and every `og:url` in this shop is `NEXT_PUBLIC_SITE_URL`
 * and nothing else. `bamstudioshop.com` is registered but parked; when it is
 * attached, the domain move stays what CLAUDE.md says it is — a rebuild with
 * a new build arg — instead of a hunt for hardcoded hosts. **Never write an
 * origin into a `canonical` or an `og:url`.**
 */
export const SITE_OPEN_GRAPH = {
  type: "website",
  siteName: SHOP.name,
  locale: "en_AU",
} as const;

/**
 * Canonical + `og:url` for a page that has one true address.
 *
 * `path` is a root-relative path ("/shop", "/legal/terms", "/" for the home
 * page) — never an absolute URL, for the reason above.
 *
 * Spread it into the page's `metadata`. A page that also needs its own
 * Open Graph title or description spreads `SITE_OPEN_GRAPH` by hand instead,
 * because a second `openGraph` key would replace this one wholesale.
 */
export function selfCanonical(path: string): Metadata {
  return {
    alternates: { canonical: path },
    openGraph: { ...SITE_OPEN_GRAPH, url: path },
  };
}
