/**
 * Postage rate cache.
 *
 * PAC answers in 0.8–1.9 s. That is a second and a half added to a cart render
 * for a number that changes roughly once a year, so essentially every lookup
 * should be a hit. The rate limit (~1000/min) is not the constraint; the
 * customer waiting is.
 *
 * ## Shape
 *
 * L1 is an in-process `Map` with a `sweep()`, deliberately the same shape as
 * `lib/rate-limit.ts` — per-process, reset by a restart or a deploy, which on
 * Fly is one always-on container. The same caveat applies as there: scale past
 * one machine and each machine keeps its own copy. For a cache rather than a
 * limiter that is harmless — the worst case is n times as many API calls, and
 * n is small.
 *
 * ## The L2 seam — read this before adding the database layer
 *
 * `lookupRate` and `storeRate` are **async even though L1 is synchronous**.
 * That is the entire point: `quote.ts` already awaits them, so adding an L2
 * database tier changes this file and nothing else. Two clearly marked blocks
 * below are where it goes.
 *
 * The table exists — `public.shipping_rate_cache`, added by separate work in
 * `supabase/migrations/0002_shipping.sql`:
 *
 *     key           text primary key   -- exactly what rateCacheKey() returns
 *     service_code  text not null
 *     amount_cents  integer not null
 *     source        text not null      -- 'live' | 'fallback'
 *     fetched_at    timestamptz not null default now()
 *
 * Three things to get right when wiring it up:
 *
 * 1. **It has no `expires_at`.** Staleness is judged at read time, so an L2
 *    read must discard a row older than `RATE_TTL_MS` itself rather than
 *    trusting whatever it finds.
 * 2. **Only ever write `source = 'live'` from here.** This cache exists to
 *    avoid repeating an API call. Persisting a fallback price would turn a
 *    two-second outage into six hours of deliberately-inflated quotes, and
 *    would outlive the outage that justified them.
 * 3. **RLS denies every row to anon and authenticated**, by design — this is
 *    internal pricing data. Read and write it through the server-side admin
 *    client only, the way `lib/supabase/` already does.
 *
 * It is **not** implemented here on purpose: that is a different agent's
 * surface, and this module must not be the thing that decides how the shop
 * talks to its database.
 *
 * Whoever adds it: an L2 failure must be swallowed, not thrown. A cache that
 * can break a sale is worse than no cache. `lookupRate` returning `null` and
 * `storeRate` doing nothing are both always-correct outcomes.
 */

import { CACHE_WEIGHT_BAND_GRAMS, roundUpGrams } from "./dimensions";

/** A price we have already paid for once, and what it was a price *of*. */
export type CachedRate = {
  amountCents: number;
  serviceCode: string;
  /** Which weight band this price was fetched for, not the exact basket. */
  weightBandGrams: number;
};

type CacheEntry = { value: CachedRate; expiresAt: number };

const entries = new Map<string, CacheEntry>();

/**
 * How long a rate is trusted.
 *
 * Retail rates change on the carrier's schedule — in practice once a year,
 * announced. Six hours is not about their volatility, it is a bound on how
 * long a wrong entry could survive if one ever got in: at most a quarter of a
 * day, and a deploy clears it sooner. It also keeps the API call count at four
 * per key per day, which is nothing against the rate limit.
 */
export const RATE_TTL_MS = 6 * 60 * 60 * 1000;

/** Above this, sweeping is cheaper than the memory. Same trigger as rate-limit.ts. */
const SWEEP_THRESHOLD = 5000;

/** Stops the map growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (entries.size < SWEEP_THRESHOLD) return;
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

export type RateKeyInput = {
  serviceCode: string;
  weightGrams: number;
  /** Omitted for letters, whose price ignores dimensions entirely. */
  dimensionsMm?: { lengthMm: number; widthMm: number; heightMm: number };
};

/**
 * `service|weightBand|dims`, with weight rounded **up** to the next 50 g.
 *
 * Rounding up rather than to nearest is the same rule as everywhere else in
 * this module: the cached entry is then the price of a basket at least as
 * heavy as the real one, so a key collision can only ever overcharge. Rounding
 * to nearest would let a 274 g basket be quoted at a 250 g price, which is a
 * cache that loses money.
 *
 * Letters key on `letter` rather than on dimensions because the letter
 * calculator takes only a service code and a weight — including dimensions
 * would fragment the cache across keys that all hold the same price.
 */
export function rateCacheKey(input: RateKeyInput): string {
  const band = roundUpGrams(input.weightGrams, CACHE_WEIGHT_BAND_GRAMS);
  const dims = input.dimensionsMm
    ? `${input.dimensionsMm.lengthMm}x${input.dimensionsMm.widthMm}x${input.dimensionsMm.heightMm}`
    : "letter";
  return `${input.serviceCode}|${band}|${dims}`;
}

/** The weight band a key was built from — needed to store alongside a price. */
export function weightBandGrams(weightGrams: number): number {
  return roundUpGrams(weightGrams, CACHE_WEIGHT_BAND_GRAMS);
}

/**
 * Read a rate. Async by contract, not by need — see the L2 seam note above.
 * Never throws; a miss and a broken cache are the same answer.
 */
export async function lookupRate(key: string): Promise<CachedRate | null> {
  const now = Date.now();
  const entry = entries.get(key);
  if (entry && entry.expiresAt > now) return entry.value;
  if (entry) entries.delete(key);

  // ---- L2 SEAM (read) -------------------------------------------------
  // Select `service_code, amount_cents, fetched_at` from
  // `public.shipping_rate_cache` where `key` = this key. Discard the row if
  // `now - fetched_at >= RATE_TTL_MS` (the table has no `expires_at`). On a
  // live hit, write it into L1 with the *remaining* TTL before returning, so
  // the next request in this process skips the round trip. Wrap the whole
  // thing so a database error resolves to `null` rather than rejecting.
  // ---------------------------------------------------------------------

  return null;
}

/**
 * Store a rate. Async by contract, not by need. Never throws.
 */
export async function storeRate(key: string, value: CachedRate): Promise<void> {
  const now = Date.now();
  sweep(now);
  entries.set(key, { value, expiresAt: now + RATE_TTL_MS });

  // ---- L2 SEAM (write) ------------------------------------------------
  // Upsert into `public.shipping_rate_cache` on `key`, setting
  // `service_code`, `amount_cents`, `source = 'live'` and `fetched_at = now()`.
  // Only `quote.ts`'s live branch reaches this function, so 'live' is always
  // the honest value — see point 2 in the file comment for why a fallback
  // price must never be persisted. Swallow every error: a failed cache write
  // must never fail the quote that produced it.
  // ---------------------------------------------------------------------
}

/** Drops every L1 entry. For tests and for a deliberate rate refresh. */
export function clearRateCache(): void {
  entries.clear();
}

/** L1 occupancy, for a health endpoint or a test. */
export function rateCacheSize(): number {
  return entries.size;
}
