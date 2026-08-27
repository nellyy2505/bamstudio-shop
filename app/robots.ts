import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/stripe";

/**
 * /robots.txt — measured 404 on the live site before this file existed, so
 * Google had no crawl directives at all and no pointer to a URL list.
 *
 * ── The origin ───────────────────────────────────────────────────────────
 * `Sitemap:` must be an absolute URL (the one directive in robots.txt that
 * cannot be relative), so it is the only place here that needs an origin, and
 * it takes it from `siteUrl()` — the same function `metadataBase` uses.
 * `NEXT_PUBLIC_SITE_URL` is constant-folded into the server bundle at build
 * (CLAUDE.md, "Deployment"), so this line is baked with the origin the image
 * was built for, exactly like Stripe's `success_url` and every canonical.
 * Attaching `bamstudioshop.com` is therefore a rebuild, not an edit here.
 *
 * ── Why the disallow list is short, and what decides it ──────────────────
 * robots.txt controls CRAWLING; `robots: { index: false }` in a page's own
 * metadata controls INDEXING. They are not interchangeable, and using the
 * first where the second is meant is self-defeating: a URL Google may not
 * fetch is a URL whose `noindex` Google can never read, so it can still be
 * indexed bare from a link pointing at it. Google says this in as many words.
 *
 * So the rule applied here is: **a path is disallowed only where a crawler
 * could never read a page-level directive anyway.** Two cases qualify.
 *
 *  1. It serves no HTML. `/api/*` is route handlers only (`app/api/**`), and
 *     `/auth/callback` is a redirect handler (`app/auth/callback/route.ts`)
 *     that consumes a single-use Supabase code. Neither has a `<head>` to put
 *     a directive in, so robots.txt is the only place this can be said at all.
 *     `/api/track` in particular hands back a customer's postal address to a
 *     POST holding an order number and an email; it is protected by a rate
 *     limiter, not by this file, but there is no reason to invite the crawl.
 *
 *  2. A signed-out request never reaches the HTML. `/admin` and `/account`
 *     are exactly the two prefixes `proxy.ts` guards (`SIGNED_IN_ONLY`), and
 *     a signed-out visitor — which Googlebot always is — is redirected to
 *     /login before any page renders. Blocking the prefix removes nothing a
 *     crawler could have read and saves it walking a tree of redirects.
 *     `/admin` deliberately covers `/admin/join` WITHOUT naming it: that page
 *     carries its own `robots: { index: false, follow: false, nocache: true }`
 *     because an invitation link is a secret, and robots.txt is a public file
 *     — listing the invitation endpoint in it would publish the location of
 *     the staff-invitation flow to anyone who reads /robots.txt.
 *
 * ── What is deliberately NOT disallowed, and why ──────────────────────────
 * Every page a signed-out visitor can actually render stays crawlable, so its
 * own metadata is the single directive that decides indexing:
 *
 *  • `/order/confirmed` and `/search` already set `robots: { index: false }`.
 *    Disallowing them would guarantee Googlebot never reads that, and both
 *    are real URLs a browser lands on and a person can share — a Stripe
 *    redirect target and a search-results link. Crawlable + noindex keeps
 *    them out of the index; disallowed + noindex would not.
 *  • `/cart`, `/login`, `/signup`, `/forgot-password` and `/reset-password`
 *    are linked from the shop's own header and footer, so Google finds them
 *    whatever this file says. They were given `robots: { index: false }` of
 *    their own in the same change as this file, which is the directive that
 *    actually works for a linked page.
 *  • `/legal/privacy`, `/legal/terms` and `/legal/refunds` set no `robots`
 *    metadata and are meant to be found — a shop's policies are part of what
 *    makes it look real to a shopper and to Google. Nothing here may block
 *    them, and they are in the sitemap.
 *  • `/track` is a guest-friendly form page with no order data in its URL —
 *    the lookup is a POST. It is an ordinary shopfront page and is indexed.
 *
 * Static by construction: no request-time API is touched, so this prerenders
 * once per build.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Prefix matches, so each entry covers everything beneath it.
        disallow: ["/api/", "/auth/", "/admin", "/account"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
