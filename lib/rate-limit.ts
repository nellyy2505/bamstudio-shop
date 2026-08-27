import { captureMessage } from "@/lib/observability";

/**
 * Rate limiting for unauthenticated endpoints, in two layers.
 *
 * `rateLimit()` — in-process, synchronous, per-machine. Deliberately simple: a
 * restart or a deploy resets it. On Fly that is now one always-on container, so
 * the allowance no longer multiplies across serverless instances the way it did
 * on Vercel — but scale the app past one machine and it does again. Unchanged
 * by this round, and still the whole story on a deploy with no shared store.
 *
 * `rateLimitDurable()` — the same decision, taken in a shared store when one is
 * configured, so a restart, a deploy or a second machine no longer hands an
 * attacker a fresh allowance. Falls back to `rateLimit()` when the store is
 * absent, slow or unreachable.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES
 *
 * This module was a plain `Map`, and it is the ONLY thing in front of
 * `POST /api/track`, which returns a customer's postal address for an order
 * number plus the matching email. Order numbers are a public incrementing
 * sequence plus four hex characters — roughly 65k guesses — so "you may keep
 * guessing after every restart" is not a theoretical weakness. `fly.toml` pins
 * the app to one always-on machine partly because of this file, and HANDOFF.md
 * has carried "move it to Upstash/Redis" as an unmet pre-launch item for
 * several rounds.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE OLD COMMENT'S PROMISE COULD ONLY HALF BE KEPT
 *
 * The comment that stood here said: "move this to Upstash Redis — the call site
 * does not change." That is true of the **arguments and the result shape**,
 * which are identical below, and false of **synchrony**: a decision taken over
 * the network has to be awaited, and there is no honest way around it. One
 * trick was considered and rejected — returning a value that is both a thenable
 * and carries a synchronous best-effort answer — because a reader could not
 * tell which of the two answers they had been given, and a limiter nobody can
 * read is a limiter nobody can trust.
 *
 * So `rateLimit()` is left EXACTLY as it was and the durable decision is a
 * second export. That is not timidity; it is the only safe move. Making
 * `rateLimit()` itself async would leave `const limit = rateLimit(...)` holding
 * a Promise at seven call sites, `limit.ok` would be `undefined`, `!limit.ok`
 * would be true, and **every request to checkout, shipping quotes, search
 * suggestions, order tracking, the contact form, the newsletter box and the
 * confirmation page would answer 429** — a silent total outage from a one-word
 * change, in files this round does not own.
 *
 * Migrating a call site is therefore exactly one keyword:
 *
 *     const limit = rateLimit(clientKey(request, "track"), 10, 60_000);
 *     const limit = await rateLimitDurable(clientKey(request, "track"), 10, 60_000);
 *
 * Every route handler is now on the durable path: `/api/track`, `/api/contact`,
 * `/api/newsletter`, `/api/checkout`, `/api/shipping/quote` and
 * `/api/search/suggest`.
 *
 * `/order/confirmed` is deliberately NOT, and it is the one place the argument
 * runs the other way. Its whole premise is that a throttled visit costs
 * nothing, and asking a shared store is itself a round trip; the allowance it
 * guards opens a Stripe lookup keyed by an unguessable `session_id`, so there
 * is nothing to enumerate the way `/api/track`'s order numbers can be; and the
 * 500ms timeout plus three-strike breaker would land on a customer refreshing
 * the page mid-payment. The reason is here so nobody "finishes the migration"
 * without reading it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY UPSTASH OVER HTTP, AND WHY NO DEPENDENCY
 *
 * Upstash's REST API fits this deployment: a plain HTTPS POST, so there is no
 * TCP connection pool to keep warm, nothing to reconnect after a Fly machine
 * restart, and no cold-start penalty on a 512 MB box. The official
 * `@upstash/redis` client is a `fetch` wrapper over that same endpoint plus a
 * command-typing layer this file does not need — the whole interaction is one
 * pipeline of three commands. `lib/email.ts` made the same call about Resend
 * and `lib/observability.ts` about Sentry.
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
 * Durability is now available — `rateLimitDurable()` below — but this function
 * is unchanged in what it reads. Identity and durability were always two
 * separate problems and the shared store does not make a forged header true.
 */
export function clientKey(request: Request, scope: string): string {
  // `FLY_APP_NAME` is set by the Fly Machines runtime, not by the request.
  if (process.env.FLY_APP_NAME) {
    const flyClientIp = request.headers.get("fly-client-ip")?.trim();
    if (flyClientIp) return `${scope}:${cap(flyClientIp)}`;
  }

  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  // Last, never first — see above.
  const ip = hops[hops.length - 1] ?? "unknown";
  return `${scope}:${cap(ip)}`;
}

/**
 * Bucket keys are built from a header, and off Fly that header is whatever the
 * caller sent. An IPv6 address with a zone id is 45 characters; anything longer
 * is not an address, it is somebody feeding the `Map` — and now a Redis key —
 * a megabyte at a time. Truncating can only ever merge two callers into one
 * bucket, which throttles harder rather than softer, so the failure direction
 * is the safe one.
 */
function cap(value: string): string {
  return value.length > 64 ? value.slice(0, 64) : value;
}

/* ------------------------------------------------------- the durable layer */

/**
 * How long a rate-limit decision may take before the request stops waiting.
 *
 * This is the number that decides whether a slow store can hang a checkout,
 * and it is the tightest of any timeout in the codebase on purpose — 500ms
 * against `lib/email.ts`'s 8s and `lib/observability.ts`'s 2s. Upstash's
 * ap-southeast region answers a pipeline in single-digit milliseconds from
 * Sydney; anything approaching half a second means the store is unwell, and a
 * throttle is not worth making a paying customer wait for.
 */
const STORE_TIMEOUT_MS = 500;

/**
 * After this many consecutive store failures, stop calling it for
 * `BREAKER_COOLDOWN_MS` and serve from memory.
 *
 * Without a breaker, an Upstash outage costs every single request a full
 * `STORE_TIMEOUT_MS` — for as long as the outage lasts, on every endpoint,
 * including checkout. Three strikes is enough to distinguish a genuine outage
 * from one unlucky packet.
 */
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

/**
 * Whether a shared store is configured. **The single source of truth for "this
 * limiter survives a restart"** — the same condition `rateLimitDurable()`
 * itself checks, in the shape `isEmailConfigured()` established in
 * lib/email.ts, so nothing can claim a durability the limiter does not have.
 *
 * Both variables or neither. One without the other is a half-configured deploy
 * that would fail every call, and silently falling back forever is exactly the
 * "looks fine, protects nothing" state this whole round exists to remove.
 *
 * Server-only, and it throws in the browser rather than lying: neither variable
 * is `NEXT_PUBLIC_`, so both read as `undefined` in a client bundle and the
 * answer could only ever be `false` there.
 */
export function isSharedStoreConfigured(): boolean {
  if (typeof window !== "undefined") {
    throw new Error(
      "isSharedStoreConfigured() was called in the browser, where the Upstash " +
        "credentials are undefined and it could only ever answer false.",
    );
  }
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
  );
}

export type RateLimitDecision = {
  ok: boolean;
  retryAfter: number;
  /**
   * Which layer answered. Additive — `{ ok, retryAfter }` destructuring at an
   * existing call site is untouched — and it exists so a route can log that it
   * is running unprotected-across-restarts without having to guess.
   */
  store: "shared" | "memory";
};

type PipelineReply = { result?: unknown; error?: string };

/**
 * One round trip, three commands, fixed-window semantics identical to the
 * in-process `Map` above:
 *
 *   INCR  key                  → the count including this request
 *   PEXPIRE key windowMs NX    → start the window, only on the first hit
 *   PTTL  key                  → what is left of it, for Retry-After
 *
 * `NX` is what keeps this a FIXED window rather than a sliding one: without it
 * every request would push the expiry out and a steady stream of traffic would
 * never reset, which is a different (and much harsher) limiter than the one
 * every call site was tuned against. It needs Redis 7+, which Upstash is.
 *
 * The pipeline endpoint returns one object per command, in order, each with
 * either `result` or `error`. A partial failure is treated as a whole failure:
 * a count without a window is a key that never expires, and this function is
 * not going to guess its way past that.
 */
async function askStore(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const response = await fetch(`${url.replace(/\/+$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // `rl:` namespaces the keys so the shop can share a free Upstash database
    // with anything else without either side stepping on the other.
    body: JSON.stringify([
      ["INCR", `rl:${key}`],
      ["PEXPIRE", `rl:${key}`, windowMs, "NX"],
      ["PTTL", `rl:${key}`],
    ]),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
    // Next patches `fetch` and caches by default. A rate-limit counter that is
    // served from a cache is not a rate-limit counter.
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`store answered HTTP ${response.status}`);
  }

  const replies = (await response.json()) as PipelineReply[];
  if (!Array.isArray(replies) || replies.length !== 3) {
    throw new Error("store returned an unexpected pipeline shape");
  }
  const failed = replies.find((reply) => reply.error);
  if (failed) throw new Error(`store command failed: ${failed.error}`);

  const count = Number(replies[0].result);
  const ttl = Number(replies[2].result);
  if (!Number.isFinite(count)) {
    throw new Error("store returned a non-numeric count");
  }

  // PTTL is -1 for a key with no expiry and -2 for one that is already gone.
  // Either means the window is not what we think it is, so repair it and fall
  // back to the full window for Retry-After — never a plausible-looking zero.
  return { count, ttlMs: Number.isFinite(ttl) && ttl > 0 ? ttl : -1 };
}

/**
 * Note that the store failed, and — the first time it trips the breaker —
 * make that visible somewhere other than a log line nobody reads.
 *
 * Reported once per outage, not once per request: the reporter has its own
 * one-a-minute dedupe (lib/observability.ts), but a store outage is also
 * exactly the kind of thing that produces thousands of identical events, so
 * this gate is the belt to that braces.
 */
function noteFailure(reason: string, now: number): void {
  consecutiveFailures += 1;
  if (consecutiveFailures !== BREAKER_THRESHOLD) return;

  breakerOpenUntil = now + BREAKER_COOLDOWN_MS;
  console.error(
    `[rate-limit] shared store unreachable (${reason}) — falling back to the ` +
      `in-process limiter for ${BREAKER_COOLDOWN_MS / 1000}s. Throttling still ` +
      "applies per machine; it no longer survives a restart.",
  );
  // Fire and forget: a rate-limit check must not wait on an error report.
  // The reporter never throws, but a floating promise still needs a catch or
  // an unhandled rejection is what an operator sees instead of the outage.
  void captureMessage(
    "Rate-limit store unreachable; throttling degraded to in-process",
    {
      scope: "rate-limit",
      level: "warning",
      tags: { reason, consecutiveFailures },
    },
  ).catch(() => {});
}

function noteSuccess(): void {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

/**
 * The durable decision. Same arguments and same `ok`/`retryAfter` as
 * `rateLimit()`; `await` it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENS WHEN THE STORE IS UNREACHABLE MID-REQUEST — and why
 *
 * The three candidate answers, and what each costs on THIS shop:
 *
 *   * **Fail open** (allow everything). Removes the protection silently, and
 *     removes it precisely when an attacker would most like it removed —
 *     anyone who can make Upstash slow can then guess order numbers at
 *     `/api/track` without limit. Rejected.
 *   * **Fail closed** (deny everything). Locks out real customers over a
 *     dependency that has nothing to do with them, and the same call sits in
 *     front of `/api/checkout`: a bad minute at a rate-limit provider would
 *     stop the shop taking money. A throttle that can close the shop is worse
 *     than the abuse it prevents. Rejected.
 *   * **Fall back to the in-process limiter.** Chosen. It is neither open nor
 *     closed: it degrades to exactly the protection this shop has been running
 *     on for its whole life, which is a real fixed-window limiter on a machine
 *     `fly.toml` pins to a single always-on instance. What is lost during the
 *     outage is durability across restarts — not the throttle.
 *
 * The fallback is only as good as its counters, so **the in-process bucket is
 * incremented on every call, whether the store answers or not.** That is the
 * `rateLimit()` call on the first line below, and it is the whole reason
 * failover is not a free reset: without it, an attacker who could knock the
 * store over would be handed a clean local allowance at the same moment. Its
 * decision is discarded when the store answers, because the store sees every
 * machine and this process only sees itself.
 *
 * And "a slow store must not hang a checkout" is enforced twice: a hard
 * `AbortSignal.timeout` of `STORE_TIMEOUT_MS` on the request, and a circuit
 * breaker so a sustained outage costs one timeout per `BREAKER_COOLDOWN_MS`
 * rather than one per request.
 *
 * Never throws. A limiter that can throw is a 500 on every route it guards.
 */
export async function rateLimitDurable(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  // Always. See above: this is what makes the fallback meaningful, and it is
  // the same code path an unconfigured deploy takes, so "no configuration =
  // behaviour identical to today" is true by construction rather than by
  // resemblance.
  const local = rateLimit(key, limit, windowMs);

  if (!isSharedStoreConfigured()) {
    return { ...local, store: "memory" };
  }

  const now = Date.now();
  if (now < breakerOpenUntil) {
    return { ...local, store: "memory" };
  }

  try {
    const answer = await askStore(key, windowMs);
    if (!answer) return { ...local, store: "memory" };

    noteSuccess();

    if (answer.count > limit) {
      return {
        ok: false,
        // A missing TTL falls back to the full window rather than to 0 — a
        // zero here would tell a client to retry immediately, forever.
        retryAfter: Math.ceil(
          (answer.ttlMs > 0 ? answer.ttlMs : windowMs) / 1000,
        ),
        store: "shared",
      };
    }
    return { ok: true, retryAfter: 0, store: "shared" };
  } catch (error) {
    // Timeout, DNS, TLS, a 500 from Upstash, a malformed body — all the same
    // decision. AbortSignal.timeout surfaces as a DOMException named
    // TimeoutError, as in lib/email.ts.
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" ||
        (error.cause instanceof Error && error.cause.name === "TimeoutError"));
    noteFailure(
      timedOut
        ? `no answer in ${STORE_TIMEOUT_MS}ms`
        : error instanceof Error
          ? error.message
          : "unknown",
      now,
    );
    return { ...local, store: "memory" };
  }
}

/** Test seam for scripts/check-observability.mjs. A fresh process is the
 *  same thing; this only exists so one run can exercise several states. */
export function resetRateLimitState(): void {
  buckets.clear();
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}
