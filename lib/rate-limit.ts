/**
 * Small in-memory rate limiter for unauthenticated endpoints.
 *
 * Deliberately simple: it is per-process, and a restart or a deploy resets it.
 * On Fly that is now one always-on container, so the allowance no longer
 * multiplies across serverless instances the way it did on Vercel — but scale
 * the app past one machine and it does again. That is enough to blunt casual
 * scripted abuse of checkout and order lookup. If the shop ever needs a real
 * guarantee, move this to Upstash Redis — the call site does not change.
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
 * Client identity for a bucket key.
 *
 * This used to take the **first** value of `x-forwarded-for`. That was safe on
 * Vercel, whose proxy overwrites the header, and is unsafe on Fly, whose proxy
 * *appends* to whatever the caller sent ("x-forwarded-for supports appending
 * IPs to the previous header" — Fly staff, community.fly.io/t/3278). So on Fly
 * the first value is just a string the caller chose: send
 * `X-Forwarded-For: 1.2.3.4`, get a bucket of your own, send a different one
 * next request and get another. Unlimited attempts, dressed as a rate limit.
 *
 * That is not academic. This limiter is now the *only* thing in front of
 * `/api/track`, which returns a customer's postal address to anyone holding an
 * order number and the matching email — and an order number is a sequence plus
 * four hex characters, i.e. guessable if you are allowed to keep guessing.
 *
 * So: trust `Fly-Client-IP`, and only that, when we are actually running on
 * Fly. It is the header Fly's proxy sets to the client address as the proxy
 * sees it, and Fly's own documentation points at it in preference to
 * `X-Forwarded-For` for exactly this reason
 * (https://fly.io/docs/networking/request-headers/). The `FLY_APP_NAME` guard
 * matters: that variable is set by the Machines runtime, never by a request,
 * so anywhere that is not a Fly machine a caller-supplied `Fly-Client-IP` is
 * ignored rather than believed.
 *
 * Caveats, stated because they are load-bearing:
 *
 * - Fly's docs do **not** say in so many words that the proxy overwrites a
 *   client-supplied `Fly-Client-IP`; they recommend the header without
 *   promising it. If that promise ever proves false, this is back to being a
 *   speed bump and the fix is a real store, not a different header.
 * - Behind *another* reverse proxy in front of Fly (Cloudflare, say),
 *   `Fly-Client-IP` becomes that proxy's address and every visitor collapses
 *   into one bucket — documented Fly behaviour, and a throttle far too tight
 *   rather than too loose. Adding such a proxy means revisiting this function.
 * - The `x-forwarded-for` fallback takes the **last** hop, not the first: the
 *   value appended by the proxy nearest the app is the only one the app did
 *   not let the caller write. It is for hosts that are not Fly. On Fly the
 *   last value is the app's own shared or dedicated address (again, Fly's
 *   docs) — the same string for every caller — which is why the header is a
 *   fallback here and not the answer.
 *
 * Making this a real cross-instance limiter (Upstash/Redis) is a recorded
 * follow-up and deliberately not done here; this only fixes *which value*
 * identifies the caller.
 */
export function clientKey(request: Request, scope: string): string {
  // `FLY_APP_NAME` is set by the Fly Machines runtime, not by the request.
  if (process.env.FLY_APP_NAME) {
    const flyClientIp = request.headers.get("fly-client-ip")?.trim();
    if (flyClientIp) return `${scope}:${flyClientIp}`;
  }

  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  // Last, never first — see above.
  const ip = hops[hops.length - 1] ?? "unknown";
  return `${scope}:${ip}`;
}
