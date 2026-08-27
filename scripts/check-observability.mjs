/**
 * Behavioural harness for the two operational modules added in this round:
 * `lib/observability.ts` and the durable half of `lib/rate-limit.ts`.
 *
 *   node scripts/check-observability.mjs
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT PROVES, AND WHY THOSE TWO THINGS
 *
 * Both modules are built on the same promise: **inert without configuration,
 * live the day one variable is set.** A promise like that has exactly two ways
 * to be broken, and both are silent —
 *
 *   1. it is not actually inert (a deploy with no DSN makes a network call, or
 *      slows down, or throws), and nobody notices because nothing visible
 *      changes; or
 *   2. it does not actually work when configured (the envelope is malformed,
 *      the auth is in the wrong place, PII leaks into the payload, the store's
 *      answer is misread), and nobody notices because the failure is in a
 *      system whose whole job is to be quiet.
 *
 * So every scenario below is one of those two halves. The unconfigured half
 * asserts on the ABSENCE of network calls, not just on the return value: "it
 * returned not_configured" is satisfied by an implementation that POSTs first
 * and gives up afterwards.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT RUNS AGAINST
 *
 * The REAL modules and the REAL /api/track and /api/health route handlers,
 * loaded through jiti so the TypeScript and the `@/` aliases resolve as Next
 * resolves them — the same approach as scripts/check-webhook.mjs, and for the
 * same reason: a test that asserts against a copy of the code is a test that
 * passes after the original is broken.
 *
 * Only two edges are faked: `globalThis.fetch` (so every outbound request is
 * recorded and can be made to fail, hang or answer 429) and Supabase for the
 * track route. Nothing inside the modules is stubbed.
 *
 * WHAT IT DOES NOT COVER
 *   * The Stripe webhook's capture points. scripts/check-webhook.mjs already
 *     drives that route end to end; the captures there are `report(...)`
 *     wrappers around the same two functions proved here.
 *   * `instrumentation.ts`. `onRequestError` is invoked by the Next runtime,
 *     which this harness does not boot. Its body is four lines over
 *     `captureException`, and `stripQuery` — the part of it that matters — is
 *     asserted directly.
 *   * Real Upstash and real Sentry. Both are asserted at the wire: the URL,
 *     the headers and the exact bytes of the body.
 */

import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = path.join(ROOT, "scripts", "observability-harness");

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/supabase/server": path.join(HARNESS, "fake-track-supabase.mjs"),
    "@": ROOT,
  },
  interopDefault: true,
});

const supabase = await jiti.import(
  path.join(HARNESS, "fake-track-supabase.mjs"),
);
const observability = await jiti.import(path.join(ROOT, "lib/observability.ts"));
const rateLimit = await jiti.import(path.join(ROOT, "lib/rate-limit.ts"));
const track = await jiti.import(path.join(ROOT, "app/api/track/route.ts"));
const health = await jiti.import(path.join(ROOT, "app/api/health/route.ts"));

/* ------------------------------------------------------------- assertions */

let passed = 0;
const failures = [];
let scenario = "";

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(`${scenario} — ${label}${detail ? `\n         ${detail}` : ""}`);
  console.log(`  FAIL ${label}${detail ? `  (${detail})` : ""}`);
}

/* ------------------------------------------------------------ fetch double */

const realFetch = globalThis.fetch;

/** Every outbound request this process attempted, in order. */
let requests = [];
/** Function (url, init) -> Response | "throw" | "hang", set per scenario. */
let responder = () => new Response("{}", { status: 200 });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : String(input.url ?? input);
  requests.push({ url, init, body: init.body ?? null });

  const outcome = responder(url, init);

  if (outcome === "throw") {
    throw new TypeError("fetch failed");
  }

  if (outcome === "hang") {
    // Exactly what undici does with an AbortSignal: reject with the signal's
    // reason, which for AbortSignal.timeout is a DOMException named
    // TimeoutError. Without this the timeout under test proves nothing.
    return new Promise((_resolve, reject) => {
      // A ref'd timer, because `AbortSignal.timeout()`'s own timer is UNREF'd
      // in Node: with nothing else pending the process would simply exit and
      // the await under test would never settle. Real fetch holds a socket
      // open, which is what keeps the loop alive in production.
      const keepAlive = setTimeout(() => reject(new Error("never aborted")), 30_000);
      const signal = init.signal;
      if (signal) {
        const fail = () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        };
        if (signal.aborted) return fail();
        signal.addEventListener("abort", fail, { once: true });
      }
    });
  }

  return outcome;
}

const CONFIG_KEYS = [
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "SENTRY_RELEASE",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "FLY_APP_NAME",
  "FLY_MACHINE_ID",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function begin(name) {
  scenario = name;
  console.log(`\n${name}`);
  requests = [];
  responder = () => new Response("{}", { status: 200 });
  for (const key of CONFIG_KEYS) delete process.env[key];
  observability.resetReportingState();
  rateLimit.resetRateLimitState();
  supabase.resetStore();
}

/** Parses the three-part envelope body into [headers, itemHeaders, payload]. */
function parseEnvelope(body) {
  const [headers, itemHeaders, payload] = String(body).split("\n");
  return [JSON.parse(headers), JSON.parse(itemHeaders), JSON.parse(payload)];
}

const DSN = "https://abc123def456@o987654.ingest.de.sentry.io/4507";

/* ═══════════════════════════════════════════════ 1. reporting, unconfigured */

begin("Reporting with no SENTRY_DSN is completely inert");
{
  check(
    "isReportingConfigured() is false",
    observability.isReportingConfigured() === false,
  );

  const thrown = await observability
    .captureException(new Error("boom"), { scope: "test" })
    .then((result) => result, (error) => ({ threw: error }));

  check("captureException resolves rather than rejecting", !thrown.threw);
  check(
    "it reports not_configured",
    thrown.ok === false && thrown.reason === "not_configured",
    JSON.stringify(thrown),
  );
  check(
    "status is null, not a plausible-looking zero",
    thrown.status === null,
    String(thrown.status),
  );

  const message = await observability.captureMessage("something", {
    scope: "test",
  });
  check(
    "captureMessage reports not_configured too",
    message.ok === false && message.reason === "not_configured",
  );

  check(
    "NOT ONE network request was attempted",
    requests.length === 0,
    `${requests.length} request(s): ${requests.map((r) => r.url).join(", ")}`,
  );
}

begin("A malformed SENTRY_DSN is treated as unset, not as a crash");
{
  for (const bad of [
    "not-a-url",
    "https://o1.ingest.sentry.io/4507", // no public key
    "https://key@o1.ingest.sentry.io/", // no project id
    "https://key@o1.ingest.sentry.io/not-numeric",
    "ftp://key@host/4507",
  ]) {
    process.env.SENTRY_DSN = bad;
    observability.resetReportingState();
    const result = await observability.captureMessage("x", { scope: "test" });
    check(
      `"${bad}" -> invalid_dsn, no request`,
      result.ok === false &&
        result.reason === "invalid_dsn" &&
        requests.length === 0,
      JSON.stringify(result),
    );
  }
}

/* ═══════════════════════════════════════════════ 2. reporting, configured */

begin("A configured DSN produces one correctly addressed Sentry envelope");
{
  process.env.SENTRY_DSN = DSN;
  process.env.SENTRY_ENVIRONMENT = "production";
  process.env.SENTRY_RELEASE = "2026-08-27-a";
  process.env.FLY_MACHINE_ID = "148e1234b56789";

  check("isReportingConfigured() is true", observability.isReportingConfigured());

  const error = new Error("order insert failed");
  error.stack = [
    "Error: order insert failed",
    "    at confirmOrder (/app/app/api/webhooks/stripe/route.ts:280:11)",
    "    at async POST (/app/app/api/webhooks/stripe/route.ts:1610:9)",
    "    at Object.run (/app/node_modules/next/dist/server/lib/x.js:12:3)",
  ].join("\n");

  const result = await observability.captureException(error, {
    scope: "stripe-webhook",
    level: "fatal",
    route: "/api/webhooks/stripe",
    tags: { orderNumber: "BS-1042", amountCents: 4500, missing: null },
  });

  check("it resolves ok", result.ok === true, JSON.stringify(result));
  check("exactly one request", requests.length === 1, String(requests.length));

  const sent = requests[0];
  const url = new URL(sent.url);
  check(
    "endpoint is <host>/api/<project>/envelope/",
    url.origin === "https://o987654.ingest.de.sentry.io" &&
      url.pathname === "/api/4507/envelope/",
    sent.url,
  );
  check(
    "auth rides in the query string, as @sentry/core builds it",
    url.searchParams.get("sentry_version") === "7" &&
      url.searchParams.get("sentry_key") === "abc123def456" &&
      (url.searchParams.get("sentry_client") ?? "").startsWith("bamstudio-shop"),
    url.search,
  );
  check(
    "content type is application/x-sentry-envelope",
    sent.init.headers["Content-Type"] === "application/x-sentry-envelope",
    JSON.stringify(sent.init.headers),
  );
  check(
    "the DSN secret is not in a header or the body",
    !JSON.stringify(sent.init.headers).includes("abc123def456") &&
      !String(sent.body).includes("abc123def456"),
  );

  const [envelopeHeaders, itemHeaders, payload] = parseEnvelope(sent.body);
  check(
    "envelope header carries event_id and sent_at",
    /^[0-9a-f]{32}$/.test(envelopeHeaders.event_id) &&
      !Number.isNaN(Date.parse(envelopeHeaders.sent_at)),
    JSON.stringify(envelopeHeaders),
  );
  check("item header is {type:'event'}", itemHeaders.type === "event");
  check(
    "payload event_id matches the envelope header",
    payload.event_id === envelopeHeaders.event_id,
  );
  check("level is carried through", payload.level === "fatal", payload.level);
  check("logger is the scope", payload.logger === "stripe-webhook");
  check("environment is SENTRY_ENVIRONMENT", payload.environment === "production");
  check("release is SENTRY_RELEASE", payload.release === "2026-08-27-a");
  check("server_name is the Fly machine", payload.server_name === "148e1234b56789");
  check("transaction is the route", payload.transaction === "/api/webhooks/stripe");
  check(
    "exception type and value survive",
    payload.exception.values[0].type === "Error" &&
      payload.exception.values[0].value === "order insert failed",
    JSON.stringify(payload.exception.values[0]),
  );

  const frames = payload.exception.values[0].stacktrace.frames;
  check("three frames were parsed", frames.length === 3, String(frames.length));
  check(
    "frames are oldest-first, as Sentry renders them",
    frames[frames.length - 1].function === "confirmOrder",
    JSON.stringify(frames.map((f) => f.function)),
  );
  check(
    "app frames are in_app and node_modules frames are not",
    frames[frames.length - 1].in_app === true && frames[0].in_app === false,
    JSON.stringify(frames.map((f) => [f.filename, f.in_app])),
  );
  check(
    "absolute paths are trimmed to the repo-relative tail",
    frames[frames.length - 1].filename === "/app/api/webhooks/stripe/route.ts",
    frames[frames.length - 1].filename,
  );
  check(
    "line and column survive as numbers",
    frames[frames.length - 1].lineno === 280 &&
      frames[frames.length - 1].colno === 11,
  );

  check(
    "scalar tags are carried",
    payload.tags.orderNumber === "BS-1042" && payload.tags.amountCents === "4500",
    JSON.stringify(payload.tags),
  );
  check(
    "a null tag is DROPPED, never written as 'null' or 0",
    !("missing" in payload.tags),
    JSON.stringify(payload.tags),
  );
}

begin("A React/Next digest is carried so a screenshot can find the event");
{
  process.env.SENTRY_DSN = DSN;
  const error = new Error("Digested");
  error.digest = "3921047751";
  await observability.captureException(error, { scope: "next:render" });
  const [, , payload] = parseEnvelope(requests[0].body);
  check("digest becomes a tag", payload.tags.digest === "3921047751");
}

begin("captureMessage sends a message event, not an exception");
{
  process.env.SENTRY_DSN = DSN;
  await observability.captureMessage("Order confirmation email was not sent", {
    scope: "stripe-webhook",
    tags: { reason: "provider_error", status: 429 },
  });
  const [, , payload] = parseEnvelope(requests[0].body);
  check(
    "message.formatted is the fixed string",
    payload.message.formatted === "Order confirmation email was not sent",
    JSON.stringify(payload.message),
  );
  check("no exception block", payload.exception === undefined);
  check("level defaults to error", payload.level === "error");
  check(
    "the variable part is in tags where the fingerprint cannot see it",
    payload.tags.reason === "provider_error" && payload.tags.status === "429",
  );
}

/* ═════════════════════════════════════════════════════════ 3. the PII rule */

begin("No customer PII reaches a Sentry payload");
{
  process.env.SENTRY_DSN = DSN;

  // Everything a provider error body has actually been observed to quote.
  const nasty = new Error(
    'insert violates check: email "jane.doe@example.com.au" ' +
      "phone 0412 345 678 mobile +61412345678 " +
      "card 4242424242424242 postcode-line 12 Example St 2000 " +
      "redirect https://shop.test/order/confirmed?session_id=cs_test_a1b2c3d4",
  );

  const result = await observability.captureException(nasty, {
    scope: "stripe-webhook",
    // The exact mistake this is here to catch: a full URL with the session id.
    route: "/order/confirmed?session_id=cs_test_a1b2c3d4",
    tags: { detail: "recipient jane.doe@example.com.au was rejected" },
  });

  check("it still sends", result.ok === true, JSON.stringify(result));
  const body = String(requests[0].body);

  check("no email address anywhere in the body", !body.includes("example.com.au"), body);
  check("no mobile number", !body.includes("0412") && !body.includes("61412345678"));
  check("no card-length digit run", !body.includes("4242424242424242"));
  check(
    "no Stripe session id — that URL reads back a customer's address",
    !body.includes("cs_test_a1b2c3d4"),
    body,
  );

  const [, , payload] = parseEnvelope(requests[0].body);
  check(
    "the query string is stripped from `transaction`",
    payload.transaction === "/order/confirmed",
    payload.transaction,
  );
  check(
    "the tag was scrubbed too, not just the message",
    payload.tags.detail === "recipient [address] was rejected",
    payload.tags.detail,
  );
  check(
    "what is left still identifies the failure",
    payload.exception.values[0].value.includes("insert violates check"),
    payload.exception.values[0].value,
  );
}

begin("stripQuery, used by instrumentation.ts on every reported request");
{
  const cases = [
    ["/order/confirmed?session_id=cs_live_abc", "/order/confirmed"],
    ["/track", "/track"],
    ["/search?q=jane%40example.com", "/search"],
    ["/page#frag", "/page"],
    ["?only=query", "/"],
  ];
  for (const [input, expected] of cases) {
    check(
      `${input} -> ${expected}`,
      observability.stripQuery(input) === expected,
      observability.stripQuery(input),
    );
  }
}

/* ════════════════════════════════════════════ 4. the reporter's own limits */

begin("The same failure is not reported twice inside the dedupe window");
{
  process.env.SENTRY_DSN = DSN;
  const first = await observability.captureMessage("Database write failed", {
    scope: "contact",
  });
  const second = await observability.captureMessage("Database write failed", {
    scope: "contact",
  });
  const other = await observability.captureMessage("A different failure", {
    scope: "contact",
  });

  check("the first is sent", first.ok === true);
  check(
    "the second is deduplicated",
    second.ok === false && second.reason === "deduplicated",
    JSON.stringify(second),
  );
  check("a different failure still gets through", other.ok === true);
  check("two requests, not three", requests.length === 2, String(requests.length));
}

begin("A burst of distinct failures cannot spend a month's Sentry quota");
{
  process.env.SENTRY_DSN = DSN;
  let lastReason = null;
  for (let i = 0; i < 200; i += 1) {
    const result = await observability.captureMessage(`failure number ${i}`, {
      scope: "burst",
    });
    if (!result.ok) lastReason = result.reason;
  }
  check(
    "the hourly cap holds at 60 sends",
    requests.length === 60,
    String(requests.length),
  );
  check(
    "and the reason says so rather than pretending success",
    lastReason === "rate_limited",
    String(lastReason),
  );
}

/* ════════════════════════════════════ 5. the reporter under provider failure */

begin("Sentry failing must never become the shop's problem");
{
  process.env.SENTRY_DSN = DSN;

  responder = () => new Response("quota exceeded", { status: 429 });
  const quota = await observability.captureMessage("m1", { scope: "s" });
  check(
    "a 429 resolves as provider_error with the real status",
    quota.ok === false && quota.reason === "provider_error" && quota.status === 429,
    JSON.stringify(quota),
  );

  responder = () => "throw";
  const dead = await observability.captureMessage("m2", { scope: "s" });
  check(
    "a dead network resolves as network_error",
    dead.ok === false && dead.reason === "network_error" && dead.status === null,
    JSON.stringify(dead),
  );

  responder = () => "hang";
  const startedAt = Date.now();
  const slow = await observability.captureMessage("m3", { scope: "s" });
  const elapsed = Date.now() - startedAt;
  check(
    "a hung endpoint gives up as timeout",
    slow.ok === false && slow.reason === "timeout",
    JSON.stringify(slow),
  );
  check(
    "and it gives up inside its own 2s budget",
    elapsed < 2_500,
    `${elapsed}ms`,
  );
}

/* ═══════════════════════════════════ 6. rate limiting, no store configured */

begin("With no Upstash configured the limiter is byte-for-byte the old one");
{
  check(
    "isSharedStoreConfigured() is false",
    rateLimit.isSharedStoreConfigured() === false,
  );

  // The same key, the same limit, the same window, through both entry points.
  const sync = [];
  for (let i = 0; i < 12; i += 1) {
    sync.push(rateLimit.rateLimit("cmp:1.2.3.4", 10, 60_000));
  }
  rateLimit.resetRateLimitState();
  const durable = [];
  for (let i = 0; i < 12; i += 1) {
    durable.push(await rateLimit.rateLimitDurable("cmp:1.2.3.4", 10, 60_000));
  }

  check(
    "the same 12 decisions, in the same order",
    sync.every(
      (decision, i) =>
        decision.ok === durable[i].ok &&
        decision.retryAfter === durable[i].retryAfter,
    ),
    JSON.stringify({ sync, durable }),
  );
  check(
    "the 11th request is the first refusal, as before",
    sync[9].ok === true && sync[10].ok === false,
  );
  check("every decision says it came from memory", durable.every((d) => d.store === "memory"));
  check(
    "NOT ONE network request was attempted",
    requests.length === 0,
    `${requests.length} request(s)`,
  );
}

/* ══════════════════════════════════════ 7. rate limiting, store configured */

function upstash(counts) {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-store.upstash.io/";
  process.env.UPSTASH_REDIS_REST_TOKEN = "AX_secret_token";
  let call = 0;
  responder = () => {
    const [count, ttlMs] = counts[Math.min(call, counts.length - 1)];
    call += 1;
    return new Response(
      JSON.stringify([{ result: count }, { result: 1 }, { result: ttlMs }]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
}

begin("A configured store is asked in exactly one round trip");
{
  upstash([[1, 60_000]]);
  const decision = await rateLimit.rateLimitDurable("track:1.2.3.4", 10, 60_000);

  check("allowed", decision.ok === true && decision.retryAfter === 0);
  check("and it says the answer came from the shared store", decision.store === "shared");
  check("exactly one request", requests.length === 1, String(requests.length));

  const sent = requests[0];
  check(
    "posted to the pipeline endpoint, with the trailing slash normalised",
    sent.url === "https://fake-store.upstash.io/pipeline",
    sent.url,
  );
  check(
    "bearer token in the Authorization header, never in the URL",
    sent.init.headers.Authorization === "Bearer AX_secret_token" &&
      !sent.url.includes("AX_secret_token"),
  );
  check(
    "three commands: INCR, PEXPIRE ... NX, PTTL",
    JSON.stringify(JSON.parse(sent.body)) ===
      JSON.stringify([
        ["INCR", "rl:track:1.2.3.4"],
        ["PEXPIRE", "rl:track:1.2.3.4", 60000, "NX"],
        ["PTTL", "rl:track:1.2.3.4"],
      ]),
    sent.body,
  );
  check(
    "the key is namespaced so the database can be shared",
    JSON.parse(sent.body)[0][1].startsWith("rl:"),
  );
  check(
    "fetch is told not to cache — Next patches fetch and caches by default",
    sent.init.cache === "no-store",
    String(sent.init.cache),
  );
}

begin("The store's count is what decides, and PTTL is what Retry-After says");
{
  upstash([[11, 42_300]]);
  const decision = await rateLimit.rateLimitDurable("track:1.2.3.4", 10, 60_000);
  check("over the limit is refused", decision.ok === false);
  check("store answered", decision.store === "shared");
  check(
    "retryAfter is the remaining TTL rounded up to whole seconds",
    decision.retryAfter === 43,
    String(decision.retryAfter),
  );
}

begin("A key with no TTL falls back to the full window, never to zero");
{
  // PTTL returns -1 for a key that exists with no expiry. A 0 here would tell
  // the client to retry immediately, forever.
  upstash([[11, -1]]);
  const decision = await rateLimit.rateLimitDurable("track:9.9.9.9", 10, 60_000);
  check("refused", decision.ok === false);
  check(
    "retryAfter is the whole window, not 0",
    decision.retryAfter === 60,
    String(decision.retryAfter),
  );
}

/* ════════════════════════════════ 8. the decision that matters: store down */

begin("An unreachable store degrades to the in-process limiter, not to open");
{
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-store.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "AX_secret_token";
  responder = () => "throw";

  const decisions = [];
  for (let i = 0; i < 12; i += 1) {
    decisions.push(await rateLimit.rateLimitDurable("track:5.5.5.5", 10, 60_000));
  }

  check("nothing threw", decisions.length === 12);
  check(
    "it did NOT fail open — the 11th is still refused",
    decisions[9].ok === true && decisions[10].ok === false,
    JSON.stringify(decisions.map((d) => d.ok)),
  );
  check(
    "it did NOT fail closed — the first ten are allowed",
    decisions.slice(0, 10).every((d) => d.ok === true),
  );
  check(
    "every decision admits it came from memory",
    decisions.every((d) => d.store === "memory"),
  );
  check(
    "the circuit breaker stops calling a dead store after 3 attempts",
    requests.length === 3,
    `${requests.length} request(s)`,
  );
}

begin("Failing over does NOT hand an attacker a fresh allowance");
{
  // This is the assertion the whole fallback design rests on. Ten requests are
  // allowed by a healthy store; the store then dies. If the in-process buckets
  // had not been kept warm all along, the attacker would get ten more.
  upstash([
    [1, 60_000],
    [2, 60_000],
    [3, 60_000],
    [4, 60_000],
    [5, 60_000],
    [6, 60_000],
    [7, 60_000],
    [8, 60_000],
    [9, 60_000],
    [10, 60_000],
  ]);
  for (let i = 0; i < 10; i += 1) {
    await rateLimit.rateLimitDurable("track:7.7.7.7", 10, 60_000);
  }
  responder = () => "throw";
  const afterOutage = await rateLimit.rateLimitDurable("track:7.7.7.7", 10, 60_000);

  check(
    "the first request after the store dies is refused",
    afterOutage.ok === false,
    JSON.stringify(afterOutage),
  );
  check("and it is honest about which layer refused it", afterOutage.store === "memory");
  check(
    "with a real Retry-After, not zero",
    afterOutage.retryAfter > 0 && afterOutage.retryAfter <= 60,
    String(afterOutage.retryAfter),
  );
}

begin("A slow store cannot hang a checkout");
{
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-store.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "AX_secret_token";
  responder = () => "hang";

  const startedAt = Date.now();
  const decision = await rateLimit.rateLimitDurable("checkout:1.1.1.1", 10, 60_000);
  const elapsed = Date.now() - startedAt;

  check("the request was still allowed", decision.ok === true);
  check("served from memory", decision.store === "memory");
  check(
    "and it waited no longer than the 500ms budget",
    elapsed < 900,
    `${elapsed}ms`,
  );

  // The breaker is what keeps the SECOND, THIRD ... requests fast.
  responder = () => "hang";
  for (let i = 0; i < 2; i += 1) {
    await rateLimit.rateLimitDurable("checkout:1.1.1.2", 10, 60_000);
  }
  const breakerStartedAt = Date.now();
  await rateLimit.rateLimitDurable("checkout:1.1.1.3", 10, 60_000);
  const breakerElapsed = Date.now() - breakerStartedAt;
  check(
    "once the breaker is open the store is not called at all",
    breakerElapsed < 50,
    `${breakerElapsed}ms`,
  );
}

begin("Every other way a store can misbehave is the same decision");
{
  const cases = [
    ["HTTP 500", () => new Response("nope", { status: 500 })],
    ["HTTP 401 (a rotated token)", () => new Response("", { status: 401 })],
    [
      "a per-command error",
      () =>
        new Response(JSON.stringify([{ error: "ERR unknown command" }, {}, {}]), {
          status: 200,
        }),
    ],
    ["a truncated pipeline", () => new Response(JSON.stringify([{ result: 1 }]), { status: 200 })],
    [
      "a non-numeric count",
      () =>
        new Response(JSON.stringify([{ result: "?" }, { result: 1 }, { result: 1 }]), {
          status: 200,
        }),
    ],
    ["invalid JSON", () => new Response("<html>502</html>", { status: 200 })],
  ];

  for (const [label, response] of cases) {
    begin(`  store misbehaviour: ${label}`);
    process.env.UPSTASH_REDIS_REST_URL = "https://fake-store.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "AX_secret_token";
    responder = response;
    const decision = await rateLimit.rateLimitDurable("misc:1.1.1.1", 10, 60_000);
    check(
      "resolves, allows, and says memory",
      decision.ok === true && decision.store === "memory",
      JSON.stringify(decision),
    );
  }
}

begin("Half-configured is read as not configured");
{
  process.env.UPSTASH_REDIS_REST_URL = "https://fake-store.upstash.io";
  // ...and no token.
  check("isSharedStoreConfigured() is false", !rateLimit.isSharedStoreConfigured());
  const decision = await rateLimit.rateLimitDurable("half:1.1.1.1", 10, 60_000);
  check("allowed from memory", decision.ok === true && decision.store === "memory");
  check("no request attempted", requests.length === 0, String(requests.length));
}

/* ══════════════════════════════════════════════════════════ 9. clientKey */

begin("clientKey caps the length of a caller-supplied bucket key");
{
  const request = new Request("https://shop.test/api/track", {
    headers: { "x-forwarded-for": `1.2.3.4, ${"A".repeat(5000)}` },
  });
  const key = rateLimit.clientKey(request, "track");
  check(
    "a 5000-character header does not become a 5000-character Redis key",
    key.length < 100,
    String(key.length),
  );
  check("the scope prefix survives", key.startsWith("track:"));

  const normal = new Request("https://shop.test/api/track", {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  check(
    "a real address is untouched",
    rateLimit.clientKey(normal, "track") === "track:203.0.113.9",
  );
}

/* ═══════════════════════════════════════════════════ 10. the real routes */

begin("/api/health stays a cheap liveness answer");
{
  const response = health.GET();
  const body = await response.json();
  check("200", response.status === 200);
  check("`ok` is still the first key anything reads", body.ok === true);
  check(
    "uptimeSeconds is a whole number",
    Number.isInteger(body.uptimeSeconds) && body.uptimeSeconds >= 0,
    JSON.stringify(body),
  );
  check(
    "it leaks no configuration — no DSN, no store, no build",
    !("reporting" in body) &&
      !("rateLimitStore" in body) &&
      !("release" in body) &&
      !("version" in body),
    JSON.stringify(body),
  );
  check("it made no network call and no database call", requests.length === 0);
}

function trackRequest(body) {
  return new Request("https://shop.test/api/track", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.44",
    },
    body: JSON.stringify(body),
  });
}

begin("/api/track behaves exactly as before on an unconfigured deploy");
{
  // No Supabase keys, no DSN, no Upstash: the shop's out-of-the-box state.
  const response = await track.POST(
    trackRequest({ orderNumber: "BS-1042", email: "jane@example.com" }),
  );
  const body = await response.json();
  check("200 with a miss", response.status === 200 && body.found === false);
  check(
    "and nothing but the miss — no reason leaked to the caller",
    Object.keys(body).length === 1,
    JSON.stringify(body),
  );
  check("no error report was attempted", requests.length === 0);
  check("no database call was attempted", supabase.store.rpc.length === 0);
}

begin("/api/track still throttles at 10 a minute, now durably");
{
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  supabase.store.rows = [];

  let refusedAt = null;
  for (let i = 1; i <= 12; i += 1) {
    const response = await track.POST(
      trackRequest({ orderNumber: `BS-10${i}`, email: "jane@example.com" }),
    );
    if (response.status === 429 && refusedAt === null) refusedAt = i;
  }
  check("the 11th attempt is the first 429", refusedAt === 11, String(refusedAt));
}

begin("/api/track reports a database failure it deliberately hides");
{
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.SENTRY_DSN = DSN;
  supabase.store.failWith = {
    code: "57014",
    message: 'canceled: lookup_order(p_email => "jane.doe@example.com")',
  };

  const response = await track.POST(
    trackRequest({ orderNumber: "BS-1042", email: "jane.doe@example.com" }),
  );
  const body = await response.json();

  check(
    "the customer still sees an ordinary miss",
    response.status === 200 && body.found === false,
    JSON.stringify(body),
  );
  check("but somebody is told", requests.length === 1, String(requests.length));

  const [, , payload] = parseEnvelope(requests[0].body);
  check("the report names the route", payload.transaction === "/api/track");
  check("and the failure", payload.message.formatted.includes("Order lookup failed"));
  check("with the SQLSTATE for triage", payload.tags.code === "57014");
  check(
    "and NOT the email address PostgREST quoted back at us",
    !String(requests[0].body).includes("jane.doe@example.com"),
    String(requests[0].body),
  );
  check(
    "nor the order number the caller guessed",
    !String(requests[0].body).includes("BS-1042"),
  );
}

begin("/api/track reports a thrown database failure the same way");
{
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
  process.env.SENTRY_DSN = DSN;
  supabase.store.throwWith = new Error("fetch failed: ECONNREFUSED");

  const response = await track.POST(
    trackRequest({ orderNumber: "BS-1042", email: "jane@example.com" }),
  );
  check("still a miss to the caller", (await response.json()).found === false);
  check("one report", requests.length === 1, String(requests.length));
  const [, , payload] = parseEnvelope(requests[0].body);
  check(
    "sent as an exception, with the type intact",
    payload.exception.values[0].type === "Error" &&
      payload.exception.values[0].value.includes("ECONNREFUSED"),
    JSON.stringify(payload.exception.values[0]),
  );
}

begin("A bad request is still refused before anything else happens");
{
  process.env.SENTRY_DSN = DSN;
  const response = await track.POST(trackRequest({ orderNumber: "x" }));
  check("400", response.status === 400);
  check("nothing reported — a typo is not an incident", requests.length === 0);
  check("no database call", supabase.store.rpc.length === 0);
}

/* ------------------------------------------------------------------ result */

globalThis.fetch = realFetch;

console.log(`\n${"─".repeat(70)}`);
if (failures.length === 0) {
  console.log(`All ${passed} assertions passed.`);
  process.exit(0);
}
console.log(`${passed} passed, ${failures.length} FAILED:\n`);
for (const failure of failures) console.log(`  • ${failure}`);
process.exit(1);
