"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Icon, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: `${location.origin}/auth/callback?next=/reset-password` },
    );

    // Rate limits and outages are worth surfacing; an unknown address is not.
    // Supabase resolves those quietly, and echoing "no such account" would let
    // anyone probe which emails are registered here.
    if (resetError && resetError.status !== 400) {
      setError(resetError.message);
      setPending(false);
      return;
    }

    setSent(true);
    setPending(false);
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
            className={inputClass}
          />
        </Field>

        <Button type="submit" size="lg" full disabled={pending}>
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <Alert tone="info">
        The link expires after 30 minutes. If it hasn&apos;t landed in a couple
        of minutes, check your spam folder.
      </Alert>
    </div>
  );
}
