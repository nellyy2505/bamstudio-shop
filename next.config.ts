import type { NextConfig } from "next";

/**
 * The Supabase project's origin, or null before Supabase is configured.
 *
 * This is the one external origin the *browser* talks to. Everything else the
 * shop calls out to — Stripe's API, Australia Post, Resend — is called from
 * the server, so none of it belongs in a policy the browser enforces.
 *
 * Evidence, not assumption: after `next build`, the only absolute http(s)
 * origins left in `.next/static/chunks` are this value, NEXT_PUBLIC_SITE_URL
 * (our own origin), `http://www.w3.org` (the SVG `xmlns` namespace, which is
 * never fetched) and links to nextjs.org / react.dev / github.com /
 * supabase.com inside error messages. Re-run that grep after adding any
 * browser-side integration and widen `connect-src` / `img-src` if it grows.
 *
 * NEXT_PUBLIC_SUPABASE_URL is read at build time here for the same reason it
 * is a Docker build ARG rather than a Fly secret: this runs when `next build`
 * reads the config, and again when the standalone server starts. The
 * Dockerfile re-exports the ARG as ENV, so both see the same string.
 */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    // A malformed URL is somebody else's problem (lib/supabase/*), not this
    // file's. Fall back to a policy naming no external origin rather than
    // emitting a broken directive.
    return null;
  }
}

/**
 * The `www.` hostname to redirect away from, or null when there isn't one.
 *
 * Derived from NEXT_PUBLIC_SITE_URL rather than typed out, for the same reason
 * `supabaseOrigin()` above reads its origin from the environment: a hostname
 * written twice is a hostname that will eventually disagree with itself. The
 * shop moved from bamstudio-shop.fly.dev to bamstudioshop.com once already.
 *
 * Returns null when the variable is missing or malformed, and also when the
 * canonical host is ITSELF a www host — redirecting www to www is a loop, and
 * a loop in a redirect is a dead site, not a slightly wrong one. Localhost and
 * the fly.dev hostname simply never match, so this costs development nothing.
 */
function wwwHost(): string | null {
  const url = process.env.NEXT_PUBLIC_SITE_URL;
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    if (hostname.startsWith("www.")) return null;
    return `www.${hostname}`;
  } catch {
    return null;
  }
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Content-Security-Policy, worked out from what this codebase actually loads
 * rather than copied from a template.
 *
 * Every directive below is ENFORCED. Nothing is shipped report-only, because
 * nothing here is a guess — see `script-src` for the one place the policy is
 * weaker than it should be, and what tightening it would cost.
 *
 *  default-src 'self'
 *      The floor. Anything a directive below does not name is same-origin only.
 *
 *  script-src 'self' 'unsafe-inline'
 *      'unsafe-inline' is here because Next streams the RSC payload through
 *      inline `<script>self.__next_f.push(...)` tags in every single response,
 *      and the only supported way to allow those without 'unsafe-inline' is a
 *      per-request nonce generated in `proxy.ts` (see
 *      node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *      Next's own docs state the price: a nonce forces every page to render
 *      dynamically, which on one always-on 512 MB Fly machine is a real bill.
 *      So this directive does NOT stop injected inline script. What it does
 *      stop is an injection pulling script in from an attacker's host, which
 *      is how stolen data usually leaves. Tightening it means a nonce in
 *      proxy.ts plus dynamic rendering, and is deliberately not done here.
 *      'unsafe-eval' is added in development only: React uses eval there to
 *      rebuild server stack traces in the browser. Production needs neither.
 *
 *  style-src 'self' 'unsafe-inline'
 *      Tailwind v4 compiles to a real stylesheet under /_next/static, so 'self'
 *      covers the bulk of it. 'unsafe-inline' covers React `style={{…}}`
 *      attributes and the inline `<style>` tags Next emits for font and CSS
 *      ordering. An inline style cannot execute script, so this is a far
 *      cheaper relaxation than the one above.
 *
 *  img-src 'self' data: blob: <supabase>
 *      Product art is inline SVG (components/ProductArt.tsx), so most images
 *      are never fetched at all. The Supabase origin is for product
 *      photographs, served from the public `product-photos` storage bucket —
 *      `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-photos`,
 *      built in app/admin/products/[id]/page.tsx. `data:` and `blob:` cover
 *      favicons and any client-side preview.
 *
 *  font-src 'self'
 *      next/font/google downloads Poppins and Nunito Sans AT BUILD TIME and
 *      self-hosts what it gets back under /_next/static/media (the Dockerfile
 *      says so, and it is why the build stage needs egress). The browser never
 *      contacts fonts.gstatic.com, so it must not be allowed to.
 *
 *  connect-src 'self' <supabase>
 *      Our own API routes, plus Supabase auth/rest/storage from the browser
 *      client (lib/supabase/client.ts). Nothing uses Supabase Realtime today —
 *      add the `wss://` form of the same origin if that ever changes, or the
 *      socket fails silently.
 *
 *      **Error reporting is deliberately absent from this list.** Adding an
 *      error tracker is the usual reason a `connect-src` grows a third-party
 *      ingest host, and it did not happen here: `lib/observability.ts` posts to
 *      Sentry from the SERVER, so the browser never contacts it and this
 *      directive needs no widening. That was one of the reasons for writing
 *      the reporter against Sentry's HTTP envelope endpoint instead of taking
 *      `@sentry/nextjs`, whose client SDK would have needed either
 *      `https://*.ingest.sentry.io` here or a `tunnelRoute` that forwards
 *      caller-supplied bodies onward. The trade — no browser-side error
 *      reporting at all — is argued in full in that file. If browser reporting
 *      is ever genuinely wanted, this is the line it has to change, and
 *      `script-src` still must not be touched.
 *
 *  form-action 'self'
 *      Checked before writing it: no form in this codebase posts off-origin.
 *      Checkout reaches Stripe by `window.location.href = data.url`
 *      (app/cart/CartView.tsx), and OAuth by supabase-js navigating the tab.
 *      Both are top-level navigations, which `form-action` does not govern and
 *      neither does any other directive browsers implement. So Stripe's hosted
 *      checkout does NOT need listing here, and listing it would imply a form
 *      POST that does not exist. If checkout ever becomes a real cross-origin
 *      form submission, this line has to change with it or payment breaks.
 *
 *  frame-ancestors 'none' / object-src 'none' / base-uri 'self'
 *      Nothing embeds this shop, nothing embeds a plugin in it, and nothing
 *      sets a <base>. Each closes a hijack that needs no XSS to work.
 *
 *  upgrade-insecure-requests
 *      Production only. Belt to HSTS's braces for any same-page subresource
 *      that ever gets written with an http:// URL.
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  const external = supabase ? ` ${supabase}` : "";

  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${external}`,
    "font-src 'self'",
    `connect-src 'self'${external}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

const nextConfig: NextConfig = {
  /**
   * Emit a self-contained server at `.next/standalone`.
   *
   * The app runs on a 512 MB Fly machine (shared-cpu-1x). Shipping the real
   * `node_modules` would mean a 629 MB layer of which the running server needs
   * almost none; standalone traces the modules actually imported and writes a
   * minimal `node_modules` plus a generated `server.js` into
   * `.next/standalone` — ~72 MB of deployable tree, 24 MB gzipped.
   *
   * Two consequences the Dockerfile has to honour, and does:
   *
   *  1. `.next/static` and `public/` are NOT traced, because they are served
   *     as files rather than imported. They have to be copied next to
   *     `server.js` by hand or every asset 404s.
   *
   *  2. The standalone server does NOT read `.env.local` (or any `.env*`
   *     file). Every runtime value must arrive as a real process env var —
   *     Fly secrets — and every NEXT_PUBLIC_* value must be present at BUILD
   *     time, because Next inlines those into the bundles then. Setting one
   *     as a Fly secret afterwards changes nothing the browser sees.
   *
   * Start it with `node server.js`, not `next start`: the standalone tree has
   * no `next` CLI in it.
   */
  output: "standalone",

  /**
   * Stop sending `X-Powered-By: Next.js` on every response.
   *
   * It is free reconnaissance and buys the shop nothing. The header names the
   * framework on every single response, so somebody scanning for hosts to try a
   * framework-specific advisory against can pick this one out without probing
   * it. That matters more here than it would elsewhere: this is a pre-release
   * major on one always-on machine patched by hand by a sole trader, not a
   * fleet with an upgrade pipeline.
   *
   * Removing it changes no behaviour — nothing in this app reads it and no
   * client depends on it — and it is not a disguise either: `/_next/*` URLs
   * still identify the framework to anyone who looks. It stops it being
   * announced to everyone who did not.
   */
  poweredByHeader: false,

  /**
   * Send www.<domain> to the bare domain, permanently.
   *
   * Both hostnames have A/AAAA records pointing at this Fly app and both have
   * their own Fly certificate, so without this the entire shop answers at two
   * addresses — two copies of every product page, splitting whatever ranking
   * they earn between them and making `canonical` the only thing telling a
   * crawler which is real. `metadataBase` already says the bare domain; this
   * makes the server agree instead of merely hinting.
   *
   * It belongs here rather than at the registrar. Porkbun's URL forwarding
   * works by planting its own record on the www host, and that record is a
   * CNAME-style pointer that cannot coexist with the A/AAAA the certificate
   * needs — the same conflict that kept the apex parked for two weeks. One
   * redirect in the app costs a single 301 and no DNS at all.
   *
   * `permanent: true` is a 308, not a 301, so the method survives: a POST to
   * the www host is replayed as a POST. Nothing should be posting there —
   * Stripe's webhook is configured on the bare domain — but a 301 would
   * quietly turn any that did into a GET, and a payment confirmation lost that
   * way would look like a bug in the shop rather than in a redirect.
   */
  async redirects() {
    const www = wwwHost();
    if (!www) return [];
    return [
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: www }],
        destination: `${process.env.NEXT_PUBLIC_SITE_URL}/:path*`,
        permanent: true,
      },
    ];
  },

  /**
   * Security response headers. Until this, the shop served none at all.
   *
   * The hole being closed is specific, not hygiene. `@supabase/ssr`'s cookie
   * defaults are `httpOnly: false`, `sameSite: "lax"`, `maxAge` 400 days and
   * **no `secure` flag** — see
   * node_modules/@supabase/ssr/dist/main/utils/constants.js — and `proxy.ts`
   * passes those options straight through to the response. So the session
   * cookie is readable by any script on the page and goes out over plain
   * http:// as happily as over https://. `force_https = true` in fly.toml is a
   * *redirect*, which means the browser has already put that cookie on the
   * wire in clear before the redirect comes back. One captured plaintext
   * request is 400 days of somebody else's account, and the account most worth
   * capturing is the owner's — which is the whole studio.
   *
   * Applied on `/:path*`, i.e. everywhere, with no exclusions.
   *
   * /api/webhooks/stripe is deliberately NOT excluded. `proxy.ts` leaves it out
   * of its matcher because the proxy reads the request and Stripe's signature
   * is computed over the exact bytes that arrived — that is a *request*
   * concern. This config only adds headers to the *response*, which Stripe's
   * HTTP client discards. Copying that exclusion here would take its shape
   * without its reason and leave a gap for nothing.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            /**
             * The header that closes the defect above.
             *
             * One year, subdomains included, NOT preloaded.
             *
             * `includeSubDomains` because it costs nothing today — nothing is
             * served on a subdomain of bamstudio-shop.fly.dev — and because it
             * is the half that stops a stray http:// link to some future `www.`
             * or staging host being the plaintext request that carries the
             * cookie.
             *
             * `preload` is deliberately absent, and that is the decision worth
             * recording. Preloading submits the domain to a list baked into
             * shipped browsers: every host under it becomes https-only even for
             * people who have never visited, and coming back off the list is a
             * removal request plus months of waiting for browser releases to
             * roll out. bamstudioshop.com is bought but still parked, and the
             * move onto it is planned (fly.toml, SETUP.md Step 5f). Committing
             * a domain that has never once served the shop to browser-enforced
             * https on every subdomain, before anyone knows what else will live
             * there, is a one-way door for a pre-revenue sole trader. Add
             * `preload` once the custom domain is live and settled on https —
             * one word here, plus a submission at hstspreload.org.
             *
             * What leaving it off costs: HSTS is trust-on-first-use. It only
             * protects a browser that has already seen this header on a good
             * https response, so a browser's very first http:// navigation is
             * still exposed. That window is narrow today because the whole
             * `.dev` TLD is already on the preload list, so
             * bamstudio-shop.fly.dev is forced to https in Chrome, Edge and
             * Firefox whatever we send. It stops being narrow the day the shop
             * answers on bamstudioshop.com — a plain `.com` with no such
             * protection — which is precisely when this header starts doing the
             * work it is here for.
             */
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            // Worked out from this codebase's real subresources — see the long
            // note above contentSecurityPolicy(). Every directive is enforced;
            // none of it is report-only.
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(),
          },
          {
            // Says the same thing as `frame-ancestors 'none'` above, for
            // anything that only understands this one. Both are sent on
            // purpose, and they agree.
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Stops a browser second-guessing Content-Type. The case that
            // matters here is the public `product-photos` bucket: an upload
            // that is not the image it claims to be must not be served as
            // whatever the bytes look like instead.
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            /**
             * The floor, not the ceiling. Cross-origin requests carry only the
             * origin; https→http carries nothing.
             *
             * app/order/confirmed/page.tsx sets `referrer: "no-referrer"` in
             * its own metadata, which is stricter, and stays stricter: a
             * document's `<meta name="referrer">` overrides the header for that
             * document. That page's URL carries the Stripe session id that
             * reads back the customer's address, so it must leak nothing at
             * all. Do not "tidy up" that page by deleting its metadata on the
             * grounds that a global policy now exists — this header is weaker
             * than what that one page needs.
             */
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
