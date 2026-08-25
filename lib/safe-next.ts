/**
 * Validation for the `next=` parameter that survives sign-in and the auth
 * callback.
 *
 * `next` is attacker-controllable, so it must only ever name a place on this
 * origin. Two bugs have lived here, and both defeat the obvious check:
 *
 *   /login?next=%2F%09%2F%2Fevil.com   →  "/<TAB>//evil.com"
 *
 * passes a "starts with `/` but not `//`" test, because it genuinely starts
 * with one slash. But the WHATWG URL parser strips tab, CR and LF *anywhere*
 * in the input before parsing, so the consumer sees `///evil.com` and the
 * user lands on evil.com seconds after a real sign-in.
 *
 *   /login?next=/..//evil.com          →  normalises to "//evil.com"
 *
 * defeats the fix for the first one: the value resolves same-origin, but the
 * *path the parser produces* is itself protocol-relative, so returning it
 * hands the caller an off-site redirect.
 *
 * So both the input and the output are checked, by parsing each exactly as
 * the consumers will and comparing the origin the parser arrived at. Anything
 * reaching a different origin — absolute, protocol-relative, whitespace
 * -smuggled, dot-segment-smuggled, or a scheme like `javascript:` (origin
 * `null`) — is discarded. The value returned is always the reparsed path, so
 * no consumer can re-derive a different destination from what was validated.
 */

/**
 * A base that cannot be a real origin, so `next` is judged identically in
 * every consumer — a server component with no request URL to hand, a route
 * handler that has one, and the client router. `.invalid` is reserved by
 * RFC 2606 and can never resolve.
 */
const SENTINEL_ORIGIN = "https://safe-next.invalid";

/** Where a rejected or absent `next` sends people. */
export const DEFAULT_NEXT = "/account/orders";

/** Does this value stay on our origin once a browser has parsed it? */
function staysOnOrigin(value: string): boolean {
  try {
    return new URL(value, SENTINEL_ORIGIN).origin === SENTINEL_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Resolves `value` to a same-origin path, or `fallback` if it points anywhere
 * else. The result always starts with a single `/` and carries no tab, CR
 * or LF.
 */
export function safeNext(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT,
): string {
  if (!value || !staysOnOrigin(value)) return fallback;

  const resolved = new URL(value, SENTINEL_ORIGIN);
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;

  // Checking the output matters as much as checking the input: `/..//evil.com`
  // clears the test above and still normalises to a protocol-relative path.
  return staysOnOrigin(path) ? path : fallback;
}
