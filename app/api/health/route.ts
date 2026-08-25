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
 */
export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
