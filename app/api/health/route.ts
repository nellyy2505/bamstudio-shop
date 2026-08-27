import { NextResponse } from "next/server";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/**
 * Liveness check for Fly's health checks. It answers exactly one question —
 * "is this process alive and serving HTTP?" — and it has to stay that cheap.
 *
 * It touches **no Supabase, no Stripe, no network, no filesystem**, on purpose,
 * for two reasons:
 *
 * 1. Cost. Fly polls this every few seconds for the whole life of the machine.
 *    Anything hung off it is permanent background load — a Supabase query here
 *    would spend free-tier request budget around the clock to tell us nothing.
 * 2. Blast radius. A check that fails when a *dependency* is down is a
 *    readiness check wearing a liveness check's clothes: Fly would kill and
 *    restart a perfectly healthy machine because Supabase or Stripe blinked,
 *    and restarting cannot fix either. The shop is built to browse on sample
 *    data with no database at all (see CLAUDE.md), so "Supabase is down" must
 *    not read as "this container is dead".
 *
 * If a dependency probe is ever wanted, it belongs at its own path, polled far
 * less often, and wired to alerting rather than to Fly's restart policy.
 *
 * `proxy.ts` excludes `api/health` from its matcher for reason 1 as well —
 * every matched request runs `supabase.auth.getUser()`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY `uptimeSeconds` IS HERE, AND WHY NOTHING ELSE IS
 *
 * This endpoint was asked to make an outage visible without a paid service.
 * Most of what could be added leaks more than it reveals, so exactly one field
 * was added and the rest are rejected on the record:
 *
 *   * **`uptimeSeconds`** — ADDED. `process.uptime()`, an in-process float,
 *     zero I/O, and it cannot fail. It turns Fly's "is it up" into "has it
 *     been up", which is the difference between a healthy machine and one
 *     crash-looping fast enough that every individual poll still succeeds.
 *     That matters more here than in most apps: a restart is precisely what
 *     wipes `lib/rate-limit.ts`'s in-process buckets, so a small number on a
 *     machine that should have been up for a week is the signal that somebody
 *     has been handed their order-number guessing budget back.
 *
 *   * **Dependency status** (Supabase, Stripe, Resend, Upstash) — REJECTED.
 *     Reason 2 above, unchanged: it would have Fly restart this app over
 *     somebody else's outage, every 15 seconds, forever.
 *
 *   * **Configuration flags** (`reporting: on/off`, `emailConfigured`,
 *     `rateLimitStore: shared/memory`) — REJECTED, though they were the
 *     obvious thing to add here. This route is unauthenticated because Fly's
 *     check is, so anything in it is public, and "nobody is watching this shop
 *     and its throttle resets on restart" is a sentence written for an attacker
 *     rather than for the owner. The same three facts are logged once at boot
 *     instead — `register()` in instrumentation.ts — where `fly logs` shows
 *     them to the owner and to nobody else.
 *
 *   * **An error counter since boot** — REJECTED for the same reason, more
 *     sharply: a public counter tells somebody probing this shop whether their
 *     probing is landing. With `SENTRY_DSN` set those errors go somewhere that
 *     can notify a person; without it they are in the log stream.
 *
 *   * **Build/release identity** (`FLY_IMAGE_REF`, a commit sha) — REJECTED as
 *     free reconnaissance, on exactly the argument `poweredByHeader: false` in
 *     next.config.ts already makes about announcing the framework to everyone
 *     who did not ask. `SENTRY_RELEASE` carries it to the error tracker, which
 *     is where it is actually needed.
 *
 * `ok` stays the first key and the body stays a flat JSON object, so anything
 * already reading this — Fly, a curl in a runbook — sees what it always did.
 */
export function GET() {
  return NextResponse.json(
    {
      ok: true,
      // Whole seconds. The fractional part is noise, and a float invites
      // somebody to time the machine with it.
      uptimeSeconds: Math.floor(process.uptime()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
