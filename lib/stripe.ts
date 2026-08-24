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
      "STRIPE_SECRET_KEY is not set. Add it in .env.local (and in Vercel).",
    );
  }

  // Pinned so a future Stripe API release can't change behaviour underneath us.
  cached = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
  return cached;
}

/** Absolute site URL, used for Stripe success/cancel redirects. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  // Vercel sets this on preview and production deployments.
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
