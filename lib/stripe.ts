import Stripe from "stripe";

let cached: Stripe | null = null;

/**
 * Lazily constructed so a missing key fails at request time with a clear
 * message rather than breaking the build.
 */
export function getStripe(): Stripe {
  if (cached) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local to run locally, " +
        "and set it on the server with `fly secrets set` — it is a runtime " +
        "secret, never a build arg. See SETUP.md.",
    );
  }

  // Pinned so a future Stripe API release can't change behaviour underneath us.
  cached = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return cached;
}

/**
 * Absolute site URL. Everything customer-facing that has to be a real origin
 * is built from this: Stripe's `success_url`/`cancel_url`, the `/track` link
 * in the confirmation email, the product JSON-LD, and `metadataBase` in
 * `app/layout.tsx` (so every canonical and OG URL too).
 *
 * Closes the defect where this silently returned `http://localhost:3000`.
 * The old fallback chain was `NEXT_PUBLIC_SITE_URL` → `https://$VERCEL_URL` →
 * localhost. Off Vercel `VERCEL_URL` is never set, so with the variable unset
 * a *production* build was measured sending Stripe
 * `success_url=http://localhost:3000/order/confirmed?session_id=...`. The card
 * is charged, Stripe redirects the customer to their own machine, connection
 * refused — and the webhook records the order anyway. A paid order, and a
 * customer certain it failed. So this now throws: the failure is a dead build
 * or a dead boot, which someone sees, instead of a silent charge, which nobody
 * does.
 *
 * `metadataBase` calls this at module scope, so the throw surfaces during
 * `next build`. That is where it fires, and that is the protection: the
 * Dockerfile passes the value as a build arg and hard-fails without it, so a
 * bad image cannot be produced in the first place.
 *
 * The guard is `!== "development"` and must never be rewritten as
 * `=== "production"`: Turbopack was measured constant-folding exactly that
 * comparison in a production build of this repo, silently making another guard
 * unconditional. Written this way it survives the optimiser.
 *
 * MEASURED, and not what you would assume: Turbopack CONSTANT-FOLDS this read
 * into the server bundle. The literal ends up inside
 * `.next/server/chunks/lib_stripe_ts_*.js`, so at runtime the variable is
 * ignored entirely. Booting the built server with a different
 * `NEXT_PUBLIC_SITE_URL` still emits the value it was built with, and booting
 * it with the variable removed does not throw — it serves the baked one.
 *
 * The consequence, which is the thing to remember: **changing the shop's
 * domain requires a REBUILD, not an env change and a restart.** Update the
 * `NEXT_PUBLIC_SITE_URL` build arg (the GitHub Actions variable, or the
 * `--build-arg` on `fly deploy`) and deploy again. Setting it as a Fly secret
 * does nothing.
 *
 * `siteUrl()` has no client callers, and the value is absent from
 * `.next/static`, so this is a server-bundle bake only — nothing here leaks a
 * secret. Do not call `siteUrl()` from a client component.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // The `https://$VERCEL_URL` branch is deleted rather than kept. The shop
  // runs on Fly.io now, which sets nothing of the sort, so on the only target
  // we have it was unreachable code — and an unreachable branch that ends in a
  // *silent* default is precisely how the localhost bug survived. One source
  // of truth, or a throw.
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set. It must be the shop's public origin " +
        "(e.g. https://shop.bamstudio.com.au), and it is needed AT BUILD " +
        "TIME — it is baked into the bundle: Stripe's success/cancel " +
        "redirects, the " +
        "/track link in confirmation emails and every canonical URL are " +
        "built from it. Without it customers are charged and then redirected " +
        "to localhost. See SETUP.md.",
    );
  }

  return "http://localhost:3000";
}
