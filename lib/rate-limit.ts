/**
 * Small in-memory rate limiter for unauthenticated endpoints.
 *
 * Deliberately simple: it is per-instance, so a serverless deployment running
 * several instances multiplies the effective allowance, and a cold start
 * resets it. That is enough to blunt casual scripted abuse of checkout and
 * order lookup. If the shop ever needs a real guarantee, move this to Upstash
 * Redis or Vercel KV — the call site does not change.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived instance. */
function sweep(now: number) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Best-effort client identity. `x-forwarded-for` is set by Vercel's proxy;
 * it is spoofable when the app is served without one, which is another reason
 * this limiter is a speed bump rather than a security control.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  return `${scope}:${ip}`;
}
