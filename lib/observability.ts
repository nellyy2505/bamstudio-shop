/**
 * Error reporting, sent straight to Sentry's HTTP envelope endpoint with
 * `fetch`. Inert until a DSN exists.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES
 *
 * Every failure path in this shop ended at `console.error` on a 512 MB Fly
 * machine whose logs are not retained and which nobody is watching. A Resend
 * 429 at 2am meant the customer was charged, the order was correct, and the
 * first anyone heard of it was the customer's email — through a contact form
 * that may well have failed the same way, because it depends on the same
 * provider. Nothing in the repo turned a failure into a notification.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY NO `@sentry/nextjs` DEPENDENCY — measured, not assumed
 *
 * The obvious move is `npm i @sentry/nextjs`. It was resolved and installed in
 * a scratch project to see what it actually costs before it was rejected:
 *
 *   * **197 packages** added, ~115 MB of `node_modules` attributable to it
 *     (`@sentry` 75 MB, `@opentelemetry` 22 MB, `@babel` 11 MB, rollup 7 MB) —
 *     against 449 packages in this whole project today. It would be, by
 *     package count, the largest single thing in the tree after Next itself.
 *     21 MB of that is `@sentry/cli-linux-x64`, a prebuilt binary whose only
 *     job is uploading source maps.
 *   * **It ships browser JavaScript.** A minimal errors-only client init with
 *     every integration switched off bundles to 85 KB minified / **29 KB
 *     gzipped**; importing the namespace the way the docs show is 451 KB /
 *     150 KB gzipped. This shop is server-rendered and every error worth
 *     hearing about — a webhook that fails after payment, an email that does
 *     not send, a database write that is refused — happens on the server. The
 *     client SDK would be paid for on every page load by every visitor on a
 *     mobile connection, in exchange for nothing this task needs.
 *   * **It would touch the CSP.** The browser SDK POSTs events to
 *     `https://oNNNN.ingest.<region>.sentry.io`, which `connect-src 'self'
 *     <supabase>` forbids (next.config.ts derives that list from a grep of the
 *     built bundles, on purpose). The alternatives are widening `connect-src`
 *     to a third-party ingest host or running Sentry's `tunnelRoute`, which is
 *     an app route that forwards arbitrary caller-supplied bodies to Sentry.
 *     Neither is free, and `script-src` must not be loosened at all.
 *   * **`withSentryConfig` wraps next.config.ts** and injects a bundler plugin
 *     into a build that already peaks at ~1.6 GB RSS on a remote builder, and
 *     `output: "standalone"` then has to trace `@sentry/node`'s OpenTelemetry
 *     auto-instrumentation, which patches modules by `require` hook — exactly
 *     the pattern file tracing is worst at.
 *
 * Against that: the wire format is one POST. The whole of what this file needs
 * — the DSN grammar, the envelope endpoint, the envelope serialisation — was
 * read out of `@sentry/core`'s own source (`utils/dsn.js`, `api.js`,
 * `utils/envelope.js`) rather than from memory, and it is fifty lines of it.
 * `lib/email.ts` made the same call about Resend for the same reason and the
 * reasoning has held. This module keeps `captureException` / `captureMessage`
 * named as Sentry names them, so if the shop ever does grow into the SDK the
 * swap is an import change at the call sites, not a rewrite.
 *
 * What is genuinely given up, stated plainly: no automatic breadcrumbs, no
 * performance tracing, no session replay, no source-map symbolication (the
 * stack frames point at the built `.next` output), no automatic capture of
 * anything this file is not explicitly wired into. For a sole trader who wants
 * to be told when a paid order goes wrong, that is the whole of the loss.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TWO RULES, the same two `lib/email.ts` is built on
 *
 * 1. **Reporting never throws and never blocks.** It is a side effect of a
 *    failure that has already happened. Every path resolves with a
 *    `CaptureResult`; a missing DSN, a malformed DSN, a dead network and a
 *    Sentry 429 all resolve, none reject. If reporting could fail a request
 *    it would be a second outage bolted to the first.
 * 2. **No customer PII leaves in an error payload. Ever.** Not a postal
 *    address, not a phone number, not an email, not a full name. This is
 *    enforced by an allow-list, not a filter: callers may pass scalar tags
 *    only, every string is run through `scrub()` on the way out, and nothing
 *    reads the request body, the query string, the headers or the cookies.
 *    §0.9 of WORKLOG.md is the defect where customer data reached the platform
 *    log stream; an error tracker is a log stream with a longer memory and a
 *    third-party operator, so the rule is stricter here, not looser.
 */

/** Sentry's envelope API version, from `@sentry/core`'s `SENTRY_API_VERSION`. */
const SENTRY_API_VERSION = "7";

/** Identifies this reporter in Sentry's UI. Not the shop's version. */
const CLIENT_ID = "bamstudio-shop-reporter/1.0.0";

/**
 * Short on purpose, and shorter than `lib/email.ts`'s 8s. A capture happens on
 * a path that is already failing, sometimes with a customer waiting on the
 * response behind it. Two seconds is enough for a healthy ingest endpoint in
 * ap-southeast and not enough to be noticed on top of a failure.
 */
const SEND_TIMEOUT_MS = 2_000;

/** Provider and error text is unbounded; a capped line is all that is useful. */
const MAX_VALUE_LENGTH = 500;

/** Deepest stack we bother sending. Beyond this it is framework plumbing. */
const MAX_FRAMES = 30;

/**
 * The same failure must not be reported more than once a minute.
 *
 * This is not tidiness. Sentry's free tier is 5,000 errors a month, and the
 * failures this shop actually produces arrive in bursts: Supabase goes away
 * and every request fails identically for as long as it is away. Without this,
 * one bad ten minutes spends a month's quota and the *next* failure — possibly
 * the one that matters — is dropped by Sentry rather than by us.
 */
const DEDUPE_WINDOW_MS = 60_000;

/**
 * A hard ceiling regardless of variety, for the same reason. Distinct
 * fingerprints defeat the dedupe above; this catches that case. Suppressed
 * counts are logged, so the burst is still visible in `fly logs` even when it
 * is not sent.
 */
const MAX_EVENTS_PER_HOUR = 60;
const HOUR_MS = 3_600_000;

/** Stops the dedupe map growing without bound on a long-lived instance. */
const MAX_DEDUPE_KEYS = 500;

export type CaptureLevel = "warning" | "error" | "fatal";

/**
 * Everything a caller is allowed to attach.
 *
 * Deliberately **not** a free-form object. There is no `user`, no `request`,
 * no `body` and no `extra: unknown`, because each of those is how a postal
 * address ends up in a third-party system by accident. Tags are scalars,
 * scrubbed and capped; anything richer belongs in the log line next to the
 * capture, where it is at least on infrastructure the studio controls.
 */
export type CaptureContext = {
  /**
   * Stable label for where this came from — "stripe-webhook", "track",
   * "contact". Becomes Sentry's `logger` and part of the fingerprint, so keep
   * it a fixed string and never interpolate anything variable into it.
   */
  scope: string;
  /** Defaults to "error". "fatal" is for money already taken. */
  level?: CaptureLevel;
  /**
   * Route path for grouping — **no query string**. See `stripQuery`: the
   * confirmation page carries a Stripe session id in its URL, and that id
   * reads a customer's address back out of Stripe.
   */
  route?: string | null;
  /** Fixed, low-cardinality facts. Values are scrubbed and length-capped. */
  tags?: Record<string, string | number | boolean | null | undefined>;
};

export type CaptureFailureReason =
  /** SENTRY_DSN is unset — nothing was attempted, and that is normal. */
  | "not_configured"
  /** SENTRY_DSN is set but is not a DSN. Logged once, then treated as unset. */
  | "invalid_dsn"
  /** Same fingerprint already reported inside DEDUPE_WINDOW_MS. */
  | "deduplicated"
  /** MAX_EVENTS_PER_HOUR reached; the count is logged instead. */
  | "rate_limited"
  /** Sentry did not answer inside SEND_TIMEOUT_MS. */
  | "timeout"
  /** DNS/TLS/socket failure — no HTTP response at all. */
  | "network_error"
  /** Sentry answered non-2xx. `status` carries the code (429 = quota). */
  | "provider_error";

export type CaptureResult =
  | { ok: true; eventId: string }
  | {
      ok: false;
      reason: CaptureFailureReason;
      /** HTTP status when there was one, otherwise null. Never a fake zero. */
      status: number | null;
      /** Safe to log: PII-scrubbed and length-capped. */
      detail: string;
    };

/**
 * Whether this process can actually report. **The single source of truth for
 * "the shop can report an error"** — the same condition `captureException`
 * itself checks, so nothing can claim a capability the reporter does not have.
 *
 * **Server-only, and it throws in the browser rather than lying.** `SENTRY_DSN`
 * is not `NEXT_PUBLIC_`, so Next replaces the read with `undefined` in a client
 * bundle and the answer would silently be `false` there while the server said
 * `true` — the same skew `isEmailConfigured()` in lib/email.ts guards against,
 * and the same hand-rolled stand-in for `import "server-only"`, which is not a
 * dependency of this project.
 *
 * On the `NEXT_PUBLIC_` question specifically: a Sentry DSN is not really a
 * secret — the browser SDK ships one to every visitor by design — so this is
 * not a leak guard. It is kept server-side because putting it in the client
 * bundle would mean browser events, which would mean widening `connect-src` in
 * next.config.ts to a third-party ingest host. Server-only reporting costs the
 * CSP nothing, and that is a deliberate trade, not an oversight.
 */
export function isReportingConfigured(): boolean {
  if (typeof window !== "undefined") {
    throw new Error(
      "isReportingConfigured() was called in the browser, where SENTRY_DSN is " +
        "undefined and it could only ever answer false. Error reporting in " +
        "this shop is server-side only — see lib/observability.ts.",
    );
  }
  return Boolean(process.env.SENTRY_DSN);
}

/* -------------------------------------------------------------- DSN parsing */

type Dsn = {
  publicKey: string;
  /** Fully-built envelope URL including the url-encoded auth query. */
  endpoint: string;
};

/**
 * `{protocol}://{publicKey}@{host}[:{port}][/{path}]/{projectId}`
 *
 * Built to match `@sentry/core`'s own `dsnFromString` + `getEnvelopeEndpoint
 * WithUrlEncodedAuth` (node_modules/@sentry/core/build/cjs/utils/dsn.js and
 * api.js): the project id is the LAST path segment, anything before it is a
 * path prefix that stays in the URL, and auth rides in the query string rather
 * than in an `X-Sentry-Auth` header so there is no preflight to think about.
 *
 * Returns null for anything that is not a DSN, which the caller treats exactly
 * like an unset one. A typo in a Fly secret must not break the shop.
 */
function parseDsn(raw: string): Dsn | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const publicKey = url.username;
  if (!publicKey || !url.hostname) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  const projectId = segments.pop();
  // Sentry project ids are numeric. Checking it here means a DSN with the
  // trailing id lopped off is rejected loudly rather than POSTing into a 404
  // for the life of the deploy.
  if (!projectId || !/^\d+$/.test(projectId)) return null;

  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";
  const auth = new URLSearchParams({
    sentry_version: SENTRY_API_VERSION,
    sentry_key: publicKey,
    sentry_client: CLIENT_ID,
  });

  return {
    publicKey,
    endpoint: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/?${auth}`,
  };
}

/** Parsed once per process; the DSN cannot change without a restart. */
let cachedDsn: Dsn | null = null;
let cachedDsnSource: string | null = null;
let warnedUnconfigured = false;
let warnedInvalid = false;

function currentDsn(): Dsn | null {
  const raw = process.env.SENTRY_DSN;
  if (!raw) return null;
  if (raw !== cachedDsnSource) {
    cachedDsnSource = raw;
    cachedDsn = parseDsn(raw);
  }
  return cachedDsn;
}

/* ----------------------------------------------------------------- scrubbing */

/**
 * Strips the shapes customer PII takes out of any text before it can be sent.
 *
 * A deny-list can only ever be the second line of defence — the first is that
 * callers may not pass free-form data at all (see `CaptureContext`). This
 * exists because the text that reaches here is often *not* ours: PostgREST
 * quotes the value that violated a constraint, Stripe quotes the address it
 * rejected, and a mail provider quotes the recipient it refused. The same
 * argument `lib/email.ts` makes for `scrub()`, applied to a wider set of
 * shapes because an error tracker sees more kinds of failure than a mailer.
 *
 *   * email addresses            → [address]
 *   * Australian phone numbers   → [phone]   (04xx, +614xx, 0x xxxx xxxx)
 *   * any run of 7+ digits       → [digits]  (catches postcodes-plus-street,
 *                                             card fragments, phone formats
 *                                             this file did not anticipate)
 *   * URL query strings          → ?[redacted]
 *
 * Names and street lines have no shape and cannot be matched. They are handled
 * by never being passed — which is why the allow-list, not this function, is
 * the actual guarantee.
 */
export function scrub(text: string): string {
  return text
    .replace(/[^\s"'<>,;:]+@[^\s"'<>,;:]+/g, "[address]")
    .replace(/(?:\+?61|0)[\s-]?[2-478](?:[\s-]?\d){8}/g, "[phone]")
    .replace(/\?[^\s"']+/g, "?[redacted]")
    .replace(/\d{7,}/g, "[digits]")
    .slice(0, MAX_VALUE_LENGTH);
}

/**
 * Drops the query string from a path.
 *
 * Load-bearing, not hygiene. Next's `onRequestError` hands over
 * `request.path` as "resource path, e.g. /blog?name=foo" — query string
 * included — and this shop has a page whose query string is a credential:
 * `/order/confirmed?session_id=cs_...` reads the customer's name, address and
 * basket back out of Stripe. `app/order/confirmed/page.tsx` sets
 * `referrer: "no-referrer"` for exactly that reason. Sending that id to an
 * error tracker would undo it.
 */
export function stripQuery(path: string): string {
  const cut = path.indexOf("?");
  const hashCut = path.indexOf("#");
  const end = Math.min(
    cut === -1 ? path.length : cut,
    hashCut === -1 ? path.length : hashCut,
  );
  return path.slice(0, end) || "/";
}

/* ------------------------------------------------------------ stack parsing */

type Frame = {
  filename: string;
  function: string | null;
  lineno: number | null;
  colno: number | null;
  in_app: boolean;
};

/**
 * Turns a V8 stack string into Sentry frames.
 *
 * Sentry renders frames oldest-first, so the parsed list is reversed. `in_app`
 * is false for anything under `node_modules` or inside Next's own output,
 * which is what makes the shop's own frames the ones highlighted.
 *
 * Frames point at the BUILT output (`.next/server/...`), because there is no
 * source-map upload without `@sentry/cli`. That is the cost of not taking the
 * dependency and it is written here so nobody spends an afternoon wondering
 * why the line numbers look wrong.
 */
function framesFrom(stack: string): Frame[] {
  const frames: Frame[] = [];

  for (const line of stack.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;

    const withName = /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/.exec(trimmed);
    const bare = /^at\s+(.+):(\d+):(\d+)$/.exec(trimmed);

    let filename: string;
    let fn: string | null;
    let lineno: number;
    let colno: number;

    if (withName) {
      fn = withName[1];
      filename = withName[2];
      lineno = Number(withName[3]);
      colno = Number(withName[4]);
    } else if (bare) {
      fn = null;
      filename = bare[1];
      lineno = Number(bare[2]);
      colno = Number(bare[3]);
    } else {
      continue;
    }

    frames.push({
      // A path is not PII, but a dev machine's home directory is more than
      // Sentry needs; only the tail is sent. The match is GREEDY on purpose:
      // the container's WORKDIR is /app and the Next app directory is also
      // `app`, so a real frame is `/app/app/api/...` and a lazy match would
      // trim nothing at all.
      filename: filename.replace(/^.*(\/(?:app|lib|components|\.next)\/)/, "$1"),
      function: fn,
      lineno: Number.isFinite(lineno) ? lineno : null,
      colno: Number.isFinite(colno) ? colno : null,
      in_app:
        !filename.includes("node_modules") && !filename.startsWith("node:"),
    });

    if (frames.length >= MAX_FRAMES) break;
  }

  return frames.reverse();
}

/* --------------------------------------------------------------- throttling */

const lastSeen = new Map<string, number>();
let hourStartedAt = 0;
let sentThisHour = 0;
let suppressedThisHour = 0;

/** Cheap, stable, non-cryptographic — this only has to group like with like. */
function fingerprint(parts: string[]): string {
  let hash = 5381;
  const text = parts.join("|");
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Decides whether this event is sent, and says why when it is not.
 *
 * Both limits log rather than going quiet: a suppressed burst still shows up
 * in `fly logs` as a single counted line, which is strictly more than the
 * shop had before this file existed.
 */
function admit(key: string, now: number): CaptureFailureReason | null {
  if (now - hourStartedAt >= HOUR_MS) {
    if (suppressedThisHour > 0) {
      console.warn(
        `[observability] ${suppressedThisHour} further error report(s) were ` +
          "suppressed in the last hour by the local cap — see " +
          "MAX_EVENTS_PER_HOUR in lib/observability.ts.",
      );
    }
    hourStartedAt = now;
    sentThisHour = 0;
    suppressedThisHour = 0;
  }

  const seenAt = lastSeen.get(key);
  if (seenAt !== undefined && now - seenAt < DEDUPE_WINDOW_MS) {
    suppressedThisHour += 1;
    return "deduplicated";
  }

  if (sentThisHour >= MAX_EVENTS_PER_HOUR) {
    suppressedThisHour += 1;
    return "rate_limited";
  }

  if (lastSeen.size >= MAX_DEDUPE_KEYS) {
    for (const [entry, at] of lastSeen) {
      if (now - at >= DEDUPE_WINDOW_MS) lastSeen.delete(entry);
    }
    // Still full means MAX_DEDUPE_KEYS distinct failures inside one window,
    // which the hourly cap has already caught. Drop the lot rather than grow.
    if (lastSeen.size >= MAX_DEDUPE_KEYS) lastSeen.clear();
  }

  lastSeen.set(key, now);
  sentThisHour += 1;
  return null;
}

/** Test seam. Not exported from an index; only scripts/check-observability.mjs
 *  uses it, so a fresh process and a fresh counter are the same thing. */
export function resetReportingState(): void {
  lastSeen.clear();
  hourStartedAt = 0;
  sentThisHour = 0;
  suppressedThisHour = 0;
  cachedDsn = null;
  cachedDsnSource = null;
  warnedUnconfigured = false;
  warnedInvalid = false;
}

/* --------------------------------------------------------------- the sender */

function eventId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, "");
  // Node 18 and the Edge runtime both have crypto.randomUUID; this exists so
  // the reporter degrades to a duplicate-prone id rather than throwing on some
  // runtime nobody has tried yet. Uniqueness is Sentry's problem, not ours.
  return Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0"),
  ).join("");
}

function safeTags(
  tags: CaptureContext["tags"],
): Record<string, string> | undefined {
  if (!tags) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tags)) {
    // Null and undefined are dropped rather than written as "null" or 0: a tag
    // that says nothing is better than one that says something false.
    if (value === null || value === undefined) continue;
    out[name] = scrub(String(value));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

type SentryEvent = Record<string, unknown>;

async function send(
  event: SentryEvent,
  key: string,
): Promise<CaptureResult> {
  const dsn = currentDsn();

  if (!process.env.SENTRY_DSN) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info(
        "[observability] not configured — set SENTRY_DSN to have failures " +
          "reported. Until then they are logged here and nowhere else.",
      );
    }
    return {
      ok: false,
      reason: "not_configured",
      status: null,
      detail: "SENTRY_DSN is unset.",
    };
  }

  if (!dsn) {
    if (!warnedInvalid) {
      warnedInvalid = true;
      console.error(
        "[observability] SENTRY_DSN is set but is not a valid DSN " +
          "(https://<key>@<host>/<project id>). Nothing will be reported. " +
          "The value is deliberately not logged.",
      );
    }
    return {
      ok: false,
      reason: "invalid_dsn",
      status: null,
      detail: "SENTRY_DSN could not be parsed.",
    };
  }

  const now = Date.now();
  const refused = admit(key, now);
  if (refused) {
    return {
      ok: false,
      reason: refused,
      status: null,
      detail:
        refused === "deduplicated"
          ? `Same failure already reported within ${DEDUPE_WINDOW_MS}ms.`
          : `Local cap of ${MAX_EVENTS_PER_HOUR} reports/hour reached.`,
    };
  }

  const id = String(event.event_id);

  // Envelope wire format, from @sentry/core's `serializeEnvelope`:
  //   <envelope headers JSON>\n<item headers JSON>\n<item payload JSON>
  // The `dsn` envelope header is only sent when tunnelling, which we do not do.
  const body =
    `${JSON.stringify({ event_id: id, sent_at: new Date(now).toISOString() })}\n` +
    `${JSON.stringify({ type: "event" })}\n` +
    `${JSON.stringify(event)}`;

  try {
    const response = await fetch(dsn.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      // Nothing about an error report is cacheable, and Next patches `fetch`.
      cache: "no-store",
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      return {
        ok: false,
        reason: "provider_error",
        status: response.status,
        detail: scrub(raw) || `HTTP ${response.status}`,
      };
    }

    return { ok: true, eventId: id };
  } catch (error) {
    // Same shape as lib/email.ts: AbortSignal.timeout rejects with a
    // DOMException named TimeoutError, and undici wraps transport failures.
    const timedOut =
      (error instanceof Error && error.name === "TimeoutError") ||
      (error instanceof Error &&
        error.cause instanceof Error &&
        error.cause.name === "TimeoutError");
    return {
      ok: false,
      reason: timedOut ? "timeout" : "network_error",
      status: null,
      detail: timedOut
        ? `No response in ${SEND_TIMEOUT_MS}ms.`
        : scrub(error instanceof Error ? error.message : "Unknown error."),
    };
  }
}

function baseEvent(context: CaptureContext, now: number): SentryEvent {
  const event: SentryEvent = {
    event_id: eventId(),
    // Sentry accepts unix seconds; `Date.now()` is milliseconds.
    timestamp: now / 1000,
    platform: "node",
    level: context.level ?? "error",
    logger: context.scope,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
  };

  // Nulls stay null by being absent: an event with no release is honest, an
  // event tagged `release: "unknown"` groups every deploy together and lies
  // about which build broke.
  if (process.env.SENTRY_RELEASE) event.release = process.env.SENTRY_RELEASE;
  // Which machine answered. Fly sets this; it is an infrastructure id, not a
  // customer fact, and it is the difference between "the app is broken" and
  // "one machine is broken" if this ever runs more than one.
  if (process.env.FLY_MACHINE_ID) event.server_name = process.env.FLY_MACHINE_ID;
  if (context.route) event.transaction = stripQuery(context.route);

  const tags = safeTags(context.tags);
  if (tags) event.tags = tags;

  return event;
}

/**
 * Report a thrown value. Resolves with a `CaptureResult`; never rejects.
 *
 * Awaiting it is safe on a path that has already failed and is about to return
 * an error response. Do NOT await it on a hot path — wrap it in `after()` from
 * next/server, as the Stripe webhook does, so a slow ingest endpoint cannot
 * delay the response.
 *
 *   const result = await captureException(error, { scope: "track" });
 *   // result.ok === false with reason "not_configured" is the normal,
 *   // expected answer on a deploy that has no DSN. It is not a failure.
 */
export async function captureException(
  error: unknown,
  context: CaptureContext,
): Promise<CaptureResult> {
  try {
    const now = Date.now();
    const isError = error instanceof Error;
    const type = isError ? error.name || "Error" : typeof error;
    const value = scrub(
      isError ? error.message : String(error ?? "Unknown error"),
    );

    const event = baseEvent(context, now);
    const frames = isError && error.stack ? framesFrom(error.stack) : [];

    event.exception = {
      values: [
        {
          type,
          value,
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
        },
      ],
    };

    // A React/Next `digest` is the only handle a server error has in the
    // browser, so it is what ties a customer's screenshot to an event.
    if (
      error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof (error as { digest: unknown }).digest === "string"
    ) {
      const tags = (event.tags ?? {}) as Record<string, string>;
      tags.digest = (error as { digest: string }).digest;
      event.tags = tags;
    }

    // Fingerprint on the shape of the failure, never on its details: an error
    // whose message quotes a different order number each time must still be
    // one group, or the dedupe above is defeated by the very burst it exists
    // to survive.
    return await send(
      event,
      fingerprint([context.scope, type, frames[frames.length - 1]?.filename ?? value]),
    );
  } catch (internal) {
    // The reporter failing must never be louder than what it was reporting.
    console.error(
      "[observability] capture failed internally:",
      internal instanceof Error ? internal.message : internal,
    );
    return {
      ok: false,
      reason: "network_error",
      status: null,
      detail: "Reporter threw.",
    };
  }
}

/**
 * Report a fact that is not a thrown error — a paid order that cannot be
 * honoured, a confirmation email a provider refused, a write that came back
 * with a constraint violation instead of an exception. Most of what goes wrong
 * in this shop is of this kind: nothing throws, a function returns `false`,
 * and the customer is the one who finds out.
 *
 * `message` must be a FIXED string. Put the variable part in `tags`, so the
 * fingerprint stays stable and the dedupe keeps working.
 */
export async function captureMessage(
  message: string,
  context: CaptureContext,
): Promise<CaptureResult> {
  try {
    const event = baseEvent(context, Date.now());
    event.message = { formatted: scrub(message) };
    return await send(event, fingerprint([context.scope, message]));
  } catch (internal) {
    console.error(
      "[observability] capture failed internally:",
      internal instanceof Error ? internal.message : internal,
    );
    return {
      ok: false,
      reason: "network_error",
      status: null,
      detail: "Reporter threw.",
    };
  }
}
