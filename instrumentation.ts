import type { Instrumentation } from "next";
import { captureException, isReportingConfigured, stripQuery } from "@/lib/observability";
import { isSharedStoreConfigured } from "@/lib/rate-limit";
import { isEmailConfigured } from "@/lib/email";

/**
 * Next's instrumentation hooks. This file is why an unhandled error anywhere
 * in the app reaches somebody, rather than dying as a `console.error` on a
 * machine whose logs are not retained.
 *
 * `onRequestError` has been stable since Next 15 (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * instrumentation.md, "Version History") and this app is on 16.3.2. It fires
 * for a throw in a **route handler**, a **server action** and a **server
 * component render** — the whole of requirement "an unhandled error in any
 * route handler or server action", in one place, with no dependency and no
 * per-route wiring that a new route can forget to add.
 *
 * What it does NOT catch, stated so nobody assumes otherwise:
 *
 *   * Errors that are **caught** by the code that produced them. Most of this
 *     shop's real failures are of that kind on purpose — the Stripe webhook,
 *     `/api/contact` and `/api/track` all swallow their failures so a customer
 *     is not shown a 500. Those are reported explicitly at the point of
 *     failure instead; see the `captureMessage` calls in those files.
 *   * Anything in the browser. Reporting here is server-side only, deliberately
 *     — lib/observability.ts explains what that buys and what it costs.
 *   * Work detached from a request, i.e. inside `after()`. The webhook's
 *     confirmation-email task guards itself.
 */

/**
 * Runs once, before the server accepts its first request.
 *
 * One line, no I/O. It exists because the whole of this shop's operational
 * configuration is "inert unless a secret is present", and an operator
 * therefore has no way to tell a deploy that is quietly doing nothing from one
 * that is working — which is the exact failure mode this round of work is
 * about. `lib/email.ts` logs its own unconfigured state the first time
 * somebody tries to send; this says it at boot, before anyone has to.
 *
 * It prints capability booleans only. No DSN, no token, no URL.
 */
export function register(): void {
  // The Edge runtime has no Fly machine and no secrets worth summarising here;
  // only the Node server serves requests in this deployment.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  console.info(
    "[boot] bamstudio-shop ready — " +
      `error reporting: ${isReportingConfigured() ? "on" : "OFF (set SENTRY_DSN)"}; ` +
      `rate-limit store: ${isSharedStoreConfigured() ? "shared" : "in-memory only (resets on restart)"}; ` +
      `email: ${isEmailConfigured() ? "on" : "OFF (set RESEND_API_KEY + EMAIL_FROM)"}`,
  );
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  // Awaited, as the Next docs require: an un-awaited promise here may be
  // dropped when the runtime finishes with the request. The reporter's own
  // 2s timeout is what bounds it, and this path has already failed, so there
  // is no customer response left to delay.
  await captureException(error, {
    scope: `next:${context.routeType}`,
    level: "error",
    // `context.routePath` is the route FILE path ("/app/track/page"), which is
    // low-cardinality and carries nothing from the request. `request.path` is
    // the resource path and DOES carry the query string, which on
    // /order/confirmed is a Stripe session id that reads back a customer's
    // address — so it goes through stripQuery() and nothing else from the
    // request is touched at all. No headers: they hold the session cookie and
    // the client IP.
    route: context.routePath || stripQuery(request.path),
    tags: {
      method: request.method,
      routerKind: context.routerKind,
      routeType: context.routeType,
      renderSource: context.renderSource ?? null,
      revalidateReason: context.revalidateReason ?? null,
      path: stripQuery(request.path),
    },
  });
};
