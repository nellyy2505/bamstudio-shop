/**
 * Transactional email, sent straight to the Resend HTTP API with `fetch`.
 *
 * No npm client: the whole surface we need is one POST, and a dependency-free
 * module keeps `package.json` untouched and the cold start small.
 *
 * Two rules shape everything below.
 *
 * 1. **Sending never throws.** Email is a side effect of a checkout, a webhook
 *    or a form post — none of which may fail because a mail provider is slow,
 *    rate-limited or unconfigured. Every path returns an `EmailResult`; the
 *    caller decides what to tell the customer. A webhook that 500s because
 *    Resend was down would make Stripe retry a completed order.
 * 2. **Nothing here logs message content or a recipient address.** This module
 *    only ever handles customer PII, and the platform log stream is not a
 *    place customer data belongs (WORKLOG §0.9 is exactly that defect). Logs
 *    get a masked address at most; failure detail is scrubbed of anything
 *    email-shaped before it is handed back, because provider validation errors
 *    quote the address they rejected.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Short on purpose. A form POST is a foreground request with a customer
 * waiting on it, so a hung provider must give up well inside any platform
 * timeout rather than holding the connection open.
 */
const SEND_TIMEOUT_MS = 8_000;

/** Provider error bodies are unbounded; we only need the first line of one. */
const MAX_DETAIL_LENGTH = 300;

export type EmailMessage = {
  /** One address or several. Never logged, never echoed back in a result. */
  to: string | string[];
  subject: string;
  /** Required: a text part keeps the mail readable and out of spam folders. */
  text: string;
  html?: string;
  /** Set this to the customer so a reply from the studio reaches them. */
  replyTo?: string;
};

export type EmailFailureReason =
  /** RESEND_API_KEY / EMAIL_FROM missing — nothing was attempted. */
  | "not_configured"
  /** The provider did not answer inside SEND_TIMEOUT_MS. */
  | "timeout"
  /** DNS/TLS/socket failure — the request never got an HTTP response. */
  | "network_error"
  /** Resend answered with a non-2xx. `status` carries the code. */
  | "provider_error";

export type EmailResult =
  | { ok: true; id: string | null }
  | {
      ok: false;
      reason: EmailFailureReason;
      /** HTTP status when there was one, otherwise null. */
      status: number | null;
      /** Safe to log: PII-scrubbed and length-capped. */
      detail: string;
    };

/**
 * Whether this process can actually send. **The single source of truth for
 * "the shop can send email"** — the same condition `sendEmail` itself checks,
 * so nothing on the site can claim a capability the sender does not have.
 *
 * It gates three real flows: the itemised order confirmation from the Stripe
 * webhook (on this alone), and — together with `SHOP.hasSupportEmail` — the
 * contact-form enquiry and the newsletter sign-up notification. Supabase Auth's
 * signup-confirmation and password-reset mail is independent of all of it.
 *
 * **Server-only, and it throws in the browser rather than lying.** Neither
 * variable is `NEXT_PUBLIC_`, so Next replaces both reads with `undefined` in a
 * client bundle: the secret cannot leak, but the answer would silently be
 * `false` there while the server said `true`. That is exactly the skew the old
 * `NEXT_PUBLIC_EMAIL_ENABLED` flag institutionalised, and a silent `false` in
 * the browser would also render different words than the server did and trip a
 * hydration mismatch. A client component must therefore receive the answer as a
 * prop from its server parent; see lib/contact.ts.
 *
 * The guard is a hand-rolled stand-in for `import "server-only"`, which is not
 * a dependency of this project and cannot be added from here. It fires during
 * client-side render, not during SSR of a client component, so a bad import
 * surfaces the moment the page is exercised in dev.
 */
export function isEmailConfigured(): boolean {
  if (typeof window !== "undefined") {
    throw new Error(
      "isEmailConfigured() was called in the browser, where the Resend " +
        "secrets are undefined and it could only ever answer false. Read it " +
        "in a server component and pass the boolean down as a prop.",
    );
  }
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** Logged at most once per process, so an unconfigured deploy is visible in
 *  the logs without every submission adding a line. */
let warnedUnconfigured = false;

/**
 * `a***@example.com` — enough to tell two failures apart in a log without
 * writing a customer's address to it.
 */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

function isNamed(value: unknown, name: string): boolean {
  return value instanceof Error && value.name === name;
}

/** Strips anything email-shaped out of provider text before it can be logged. */
function scrub(text: string): string {
  return text
    .replace(/[^\s"'<>,;:]+@[^\s"'<>,;:]+/g, "[address]")
    .slice(0, MAX_DETAIL_LENGTH);
}

/**
 * Send one message. Resolves with an `EmailResult`; never rejects.
 *
 * The caller is expected to keep working either way:
 *   const result = await sendEmail({ ... });
 *   if (!result.ok) console.error("[contact] send failed", result.reason);
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info(
        "[email] not configured — set RESEND_API_KEY and EMAIL_FROM to send. " +
          "Nothing is queued; callers must not claim delivery.",
      );
    }
    return {
      ok: false,
      reason: "not_configured",
      status: null,
      detail: "RESEND_API_KEY and/or EMAIL_FROM are unset.",
    };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        // Resend's field is snake_case; the caller's is camelCase.
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Read the body for the reason, but never trust it to be PII-free.
      const raw = await response.text().catch(() => "");
      return {
        ok: false,
        reason: "provider_error",
        status: response.status,
        detail: scrub(raw) || `HTTP ${response.status}`,
      };
    }

    const payload: unknown = await response.json().catch(() => null);
    const id =
      payload && typeof payload === "object" && "id" in payload
        ? String((payload as { id: unknown }).id)
        : null;
    return { ok: true, id };
  } catch (error) {
    // AbortSignal.timeout rejects with a TimeoutError DOMException; everything
    // else here is a transport failure. Neither is worth a stack trace in the
    // log, and the message can quote the request, so it is scrubbed too.
    // Verified against Node's fetch: the abort surfaces as a DOMException
    // named "TimeoutError". `cause` is checked too in case a future runtime
    // wraps it in a TypeError, which is what undici does for other failures.
    const timedOut =
      isNamed(error, "TimeoutError") ||
      (error instanceof Error && isNamed(error.cause, "TimeoutError"));
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
