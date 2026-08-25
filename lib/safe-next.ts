/**
 * Validation for the `next=` parameter that survives sign-in and the auth
 * callback.
 *
 * `next` is attacker-controllable, so it must only ever name a place on this
 * origin. The obvious check — "does it start with `/` and not `//`" — is not
 * enough, and was the bug this file replaces:
 *
 *   /login?next=%2F%09%2F%2Fevil.com
 *
 * decodes to `/<TAB>//evil.com`. That passes a prefix check, because the
 * string genuinely begins with a single `/`. But the WHATWG URL parser strips
 * tab, CR and LF *anywhere* in the input before it parses, so by the time
 * `new URL(next, origin)` or `router.push(next)` sees it, it is `///evil.com`
 * — protocol-relative, and the user lands on evil.com seconds after a real
 * sign-in. `/\evil.com` does the same via backslash normalisation.
 *
 * So the only safe test is to parse the value exactly as the consumers will
 * and compare the origin the parser arrived at. Anything that reaches a
 * different origin — absolute URLs, protocol-relative, whitespace-smuggled,
 * or a scheme like `javascript:` (whose origin is `null`) — is discarded.
 *
 * The value returned is the *reparsed* path, never the caller's string, so no
 * consumer can re-derive a different destination from what was validated.
 */

/**
 * A base that cannot be a real origin, so `next` is judged the same way in
 * every consumer — a server component with no request URL to hand, a route
 * handler that has one, and the client router. `.invalid` is reserved by
 * RFC 2606 and can never resolve.
 */
const SENTINEL_ORIGIN = "https://safe-next.invalid";

/** Where a rejected or absent `next` sends people. */
export const DEFAULT_NEXT = "/account/orders";

/**
 * Resolves `value` to a same-origin path, or `fallback` if it points anywhere
 * else. The result always starts with `/` and carries no tab, CR or LF.
 */
export function safeNext(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (!value) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }

  // The whole check. `origin` is what the browser will treat as the
  // destination's origin, after every normalisation the parser applies.
  if (resolved.origin !== SENTINEL_ORIGIN) return fallback;

  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
