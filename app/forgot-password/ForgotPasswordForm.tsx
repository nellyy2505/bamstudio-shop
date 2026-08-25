"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Icon, inputClass } from "@/components/ui";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Whether the browser holds the keys it needs to reach Supabase Auth.
 *
 * Defect this closes: with no Supabase env vars — the shop's state today, and
 * a supported mode of this app — `createClient()` threw inside `onSubmit`.
 * The rejection was unhandled, `setPending(false)` never ran and the button
 * sat on "Sending…" forever, while the page had already told the customer the
 * link expires in 30 minutes and to go and check their spam folder for an
 * email that was never even attempted. Same class as WORKLOG §0.1: a
 * customer-facing claim not gated on the capability behind it, plus a hang
 * with no error.
 *
 * `isSupabaseConfigured()` (lib/supabase/client.ts) rather than
 * `isDatabaseConfigured()` (lib/queries.ts): the two booleans are identical,
 * but lib/queries imports the *server* client and therefore `next/headers`,
 * which a "use client" module may not pull in. This helper also lives beside
 * the `createClient()` that throws and is literally the negation of that
 * throw, so the gate cannot drift from the thing it guards.
 *
 * Hydration: it reads only `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which Next inlines into the client bundle
 * at build time, so the server render and the hydrated render reach the
 * identical answer and the markup matches.
 *
 * This is not the public-mirror pattern lib/config.ts warns against (see the
 * note where `SHOP.canSendEmail` used to be). That flag mirrored a server-only
 * secret and the two could disagree. These two variables are not a mirror of
 * anything: the anon key is public by design and the browser genuinely needs
 * both to talk to Supabase at all, so this reads the browser's own capability
 * directly — the one fact, in the one place, checked by the one helper.
 */
const CAN_RESET = isSupabaseConfigured();

/**
 * Shown when the shop has no accounts system behind it. Plain, in the shop's
 * voice, and it never names an env var, prints an exception or blames the
 * address the customer typed — none of that is theirs to fix.
 */
const UNAVAILABLE =
  "Password resets aren't switched on yet — this shop isn't connected to its accounts system, so we can't send you a reset link. Nothing you type here would reach us. Please try again later.";

const OFFLINE =
  "We couldn't reach the shop just now. Check your connection and try again.";

const RESET_FAILED =
  "We couldn't send that reset link just now. Please try again in a moment.";

/** Supabase raises this (status 0) when the request never got a response. */
function isOffline(error: { name?: string; status?: number }): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === 0;
}

/**
 * Never render Supabase's own text — "Failed to fetch" and friends are
 * developer strings, not shop copy.
 */
function resetMessage(error: { name?: string; status?: number }): string {
  if (isOffline(error)) return OFFLINE;
  if (error.status === 429)
    return "Too many attempts. Please wait a minute and try again.";
  return RESET_FAILED;
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Defence in depth: the field and button below are disabled while
    // unconfigured, so a submit should not be reachable — but if one arrives
    // it must say something true rather than throw into a dead promise.
    if (!CAN_RESET) {
      setError(UNAVAILABLE);
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo: `${location.origin}/auth/callback?next=/reset-password` },
      );

      // Rate limits and outages are worth surfacing; an unknown address is
      // not. Supabase resolves those quietly, and echoing "no such account"
      // would let anyone probe which emails are registered here.
      if (resetError && resetError.status !== 400) {
        setError(resetMessage(resetError));
        return;
      }

      setSent(true);
    } catch {
      // Anything that throws on the way out — a client that refuses to build,
      // a blocked request — still has to land as copy the customer can act on.
      // The exception itself is never shown.
      setError(CAN_RESET ? OFFLINE : UNAVAILABLE);
    } finally {
      // Runs on every path, including the throw that used to leave the button
      // stuck on "Sending…" with no error ever reaching the customer.
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
          <Icon name="mail" size={26} />
        </span>
        <div>
          <h2 className="text-xl">Check your inbox</h2>
          <p className="mt-1.5 text-sm text-muted">
            If <b>{email}</b> has an account with us, a reset link is on its
            way.
          </p>
        </div>
        <Alert tone="info">
          The link expires after 30 minutes. If it hasn&apos;t landed in a
          couple of minutes, check your spam folder.
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not an error the customer caused, so it renders before they touch
          anything rather than after a submit that cannot work. */}
      {!CAN_RESET ? <Alert tone="error">{UNAVAILABLE}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!CAN_RESET}
            className={inputClass}
          />
        </Field>

        <Button type="submit" size="lg" full disabled={pending || !CAN_RESET}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      {/* Supabase Auth's reset email is real and genuinely sends once the
          project is connected, so this wording stays exactly as it was — only
          gated, never softened. Without a project it is a promise of mail that
          nothing can send. */}
      {CAN_RESET ? (
        <Alert tone="info">
          The link expires after 30 minutes. If it hasn&apos;t landed in a
          couple of minutes, check your spam folder.
        </Alert>
      ) : null}
    </div>
  );
}
