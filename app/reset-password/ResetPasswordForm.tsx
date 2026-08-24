"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

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
    const supabase = createClient();

    if (!viaRecovery) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.email) {
        setError(
          "We couldn't confirm who you're signed in as. Please sign in again.",
        );
        setPending(false);
        return;
      }

      // Supabase updates a password from the session alone, so re-signing in
      // is what actually proves the person at the keyboard knows the old one.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
      if (signInError) {
        setCurrentError("That current password isn't right.");
        setPending(false);
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message);
      setPending(false);
      return;
    }

    // No need to clear `bs_pw_recovery` by hand: it is path-scoped to
    // /reset-password (so it is never sent to any other route) and expires 15
    // minutes after the link was opened, which caps how long the waiver lasts
    // and leaves nothing that can be replayed elsewhere.
    router.push("/account/settings");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
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
            className={inputClass}
          />
        </Field>

        <Button type="submit" size="lg" full disabled={pending}>
          {pending ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </div>
  );
}
