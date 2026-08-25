"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

/**
 * Whether the browser holds the keys it needs to reach Supabase Auth.
 *
 * Defect this closes: with no Supabase env vars — the shop's state today, and
 * a supported mode of this app — `createClient()` ran outside any `try` (it
 * was the bare statement after `setPending(true)`) and threw. The rejection
 * was unhandled, and because `setPending(false)` existed only on the branches
 * further down that returned normally, none of them ran: the button sat on
 * "Saving…" forever with no error ever reaching the customer. Identical shape
 * to the hang already fixed in LoginForm, SignupForm and ForgotPasswordForm,
 * and the same class as WORKLOG §0.1 — a customer-facing claim not gated on
 * the capability behind it, plus a hang.
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
 */
const CAN_SET_PASSWORD = isSupabaseConfigured();

/**
 * Shown when the shop has no accounts system behind it. Plain, in the shop's
 * voice, and it never names an env var, prints an exception or blames the
 * password the customer typed — none of that is theirs to fix.
 */
const UNAVAILABLE =
  "Password changes aren't switched on yet — this shop isn't connected to its accounts system, so we can't save a new password. Nothing you type here would reach us. Please try again later.";

const OFFLINE =
  "We couldn't reach the shop just now. Check your connection and try again.";

const SAVE_FAILED =
  "We couldn't save that new password just now. Please try again in a moment.";

/** Supabase raises this (status 0) when the request never got a response. */
function isOffline(error: { name?: string; status?: number }): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === 0;
}

/**
 * Password-update errors that are safe to show, keyed by Supabase's stable
 * error code — the same allow-list shape LoginForm and SignupForm use. Every
 * entry is about what the visitor just typed or how fast they typed it.
 */
const SAFE_UPDATE_ERRORS: Record<string, string> = {
  weak_password: `That password is too weak. Use at least ${MIN_LENGTH} characters, with a number and a symbol.`,
  same_password: "That's the password you already have. Please pick a different one.",
  validation_failed: "Please check the passwords you entered and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  reauthentication_needed:
    "This reset link has expired. Request a fresh one and open it on this device.",
  session_not_found:
    "This reset link has expired. Request a fresh one and open it on this device.",
};

/**
 * Was `setError(updateError.message)`. Supabase's own text is developer copy —
 * "Failed to fetch", "AuthApiError: …" — and putting it on the page hands the
 * customer a string they can neither read nor act on.
 */
function updateMessage(error: {
  code?: string;
  name?: string;
  status?: number;
}): string {
  const safe = error.code ? SAFE_UPDATE_ERRORS[error.code] : undefined;
  if (safe) return safe;
  if (error.status === 429) return SAFE_UPDATE_ERRORS.over_request_rate_limit;
  // A request that never landed is not the shopper's password being wrong;
  // telling them to check something they typed correctly sends them in circles.
  if (isOffline(error)) return OFFLINE;
  return SAVE_FAILED;
}

/**
 * `viaRecovery` comes from the httpOnly `bs_pw_recovery` cookie that
 * /auth/callback sets after exchanging an emailed reset link.
 *
 * When it is true the visitor proved control of the mailbox and by definition
 * cannot know the old password, so new + confirm is all we ask for. When it is
 * false this is just an ordinary signed-in session — which Supabase would
 * happily let change the password on its own — so we re-authenticate first,
 * exactly as account/settings/PasswordCard does. Without that, any borrowed or
 * shared browser left signed in could take the account over silently.
 *
 * The gating below never touches that waiver: every branch that reads
 * `viaRecovery` is unchanged, so someone who followed a reset link is still
 * never asked for the password they have forgotten.
 */
export function ResetPasswordForm({ viaRecovery }: { viaRecovery: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Defence in depth: the fields and button below are disabled while
    // unconfigured, so a submit should not be reachable — but if one arrives
    // it must say something true rather than throw into a dead promise.
    if (!CAN_SET_PASSWORD) {
      setError(UNAVAILABLE);
      return;
    }

    const missingCurrent = !viaRecovery && !current;
    const tooShort = password.length < MIN_LENGTH;
    const mismatch = password !== confirm;
    setCurrentError(
      missingCurrent ? "Enter your current password." : undefined,
    );
    setPasswordError(
      tooShort ? `Use at least ${MIN_LENGTH} characters.` : undefined,
    );
    setConfirmError(!tooShort && mismatch ? "Passwords don't match." : undefined);
    if (missingCurrent || tooShort || mismatch) return;

    setPending(true);
    // The only path that deliberately leaves the button busy is the one that
    // is navigating away. Every other path — a returned error, a throw —
    // hands the button back.
    let leaving = false;
    try {
      // Was outside the try, one line below setPending(true): this call is
      // exactly what throws when the shop has no Supabase project.
      const supabase = createClient();

      if (!viaRecovery) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user?.email) {
          setError(
            "We couldn't confirm who you're signed in as. Please sign in again.",
          );
          return;
        }

        // Supabase updates a password from the session alone, so re-signing in
        // is what actually proves the person at the keyboard knows the old one.
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: current,
        });
        if (signInError) {
          // A dead connection is not a wrong password. Blaming the field would
          // send someone who typed it correctly round in circles.
          if (isOffline(signInError)) {
            setError(OFFLINE);
            return;
          }
          setCurrentError("That current password isn't right.");
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateMessage(updateError));
        return;
      }

      // No need to clear `bs_pw_recovery` by hand: it is path-scoped to
      // /reset-password (so it is never sent to any other route) and expires 15
      // minutes after the link was opened, which caps how long the waiver lasts
      // and leaves nothing that can be replayed elsewhere.
      router.push("/account/settings");
      router.refresh();
      leaving = true;
    } catch {
      // Anything that throws on the way out — a client that refuses to build,
      // a blocked request — still has to land as copy the customer can act on.
      // The exception itself is never shown: no stack trace, no env-var name.
      setError(CAN_SET_PASSWORD ? OFFLINE : UNAVAILABLE);
    } finally {
      // Runs on every path, including the throw that used to leave the button
      // stuck on "Saving…" with no error ever reaching the customer.
      if (!leaving) setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not an error the customer caused, so it renders before they touch
          anything rather than after a submit that cannot work. */}
      {!CAN_SET_PASSWORD ? <Alert tone="error">{UNAVAILABLE}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {viaRecovery ? null : (
          <Field
            label="Current password"
            htmlFor="current-password"
            error={currentError}
          >
            <input
              id="current-password"
              name="current-password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              disabled={!CAN_SET_PASSWORD}
              className={inputClass}
            />
          </Field>
        )}

        <Field label="New password" htmlFor="password" error={passwordError}>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!CAN_SET_PASSWORD}
            className={inputClass}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="confirm-password"
          error={confirmError}
        >
          <input
            id="confirm-password"
            name="confirm-password"
            type="password"
            required
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={!CAN_SET_PASSWORD}
            className={inputClass}
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          full
          disabled={pending || !CAN_SET_PASSWORD}
        >
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
