"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Sign-in errors that are safe to show, keyed by Supabase's stable error code
 * — the same allow-list shape /login/page.tsx uses for the auth-callback
 * codes. Every entry here is about how fast the visitor is going or about the
 * project's configuration; none of them depend on whether the address typed
 * into the form has an account.
 */
const SAFE_SIGNIN_ERRORS: Record<string, string> = {
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  over_email_send_rate_limit: "Too many attempts. Please wait a minute and try again.",
  user_banned: "This account is locked. Please contact us to get back in.",
  validation_failed: "Please enter both your email address and your password.",
  email_provider_disabled: "Signing in with an email address isn't available right now.",
  provider_disabled: "That sign-in method isn't available right now.",
};

/**
 * Everything not on the list above collapses to this one message.
 *
 * Supabase distinguishes "Invalid login credentials" (invalid_credentials —
 * no such address, OR the wrong password) from "Email not confirmed"
 * (email_not_confirmed — the address exists but has never been confirmed).
 * Rendering those separately turns this form into the account oracle that
 * /signup and /forgot-password were both hardened against, so all three
 * outcomes produce exactly this string.
 *
 * That leaves the genuine need behind "Email not confirmed": someone who
 * signed up an hour ago and never opened the email has no way to guess why
 * they are stuck. The resolution is to fold the hint into the generic copy —
 * it tells anyone who HAS just signed up where to look, while asserting
 * nothing about the address that was typed. Someone probing addresses reads
 * the identical sentence back for every one of them.
 */
const GENERIC_SIGNIN_ERROR =
  "We couldn't sign you in. Check your email address and password. If you've just created an account, open the confirmation email we sent you first.";

function signInMessage(
  code: string | undefined,
  status: number | undefined,
  fallback: string = GENERIC_SIGNIN_ERROR,
): string {
  const safe = code ? SAFE_SIGNIN_ERRORS[code] : undefined;
  if (safe) return safe;
  // Responses can arrive rate-limited without a code.
  if (status === 429) return SAFE_SIGNIN_ERRORS.over_request_rate_limit;
  return fallback;
}

export function LoginForm({
  next,
  initialError,
}: {
  next: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // signInWithPassword has no per-call persistence flag — the Supabase SSR
  // client owns cookie lifetime — so this only records the shopper's intent.
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (oauthError) {
      // No address has been typed at this point, so nothing can be enumerated
      // here — but the raw text is provider/config noise, not shopper copy.
      setError(
        signInMessage(
          oauthError.code,
          oauthError.status,
          "We couldn't start sign-in with Google. Please try again.",
        ),
      );
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInMessage(signInError.code, signInError.status));
      setPending(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button
        type="button"
        variant="soft"
        full
        onClick={signInWithGoogle}
        disabled={pending}
      >
        <GoogleMark />
        Continue with Google
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11.5px] font-extrabold tracking-[0.14em] text-faint">
          OR
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

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

        <Field
          label="Password"
          htmlFor="password"
          action={
            <Link
              href="/forgot-password"
              className="text-[13px] font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
            >
              Forgot password?
            </Link>
          }
        >
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>

        <label
          htmlFor="keep-signed-in"
          className="flex items-center gap-2.5 text-[13.5px] text-muted"
        >
          <input
            id="keep-signed-in"
            name="keep-signed-in"
            type="checkbox"
            checked={keepSignedIn}
            onChange={(e) => setKeepSignedIn(e.target.checked)}
            className="h-4 w-4 rounded border-line2 accent-accent"
          />
          Keep me signed in
        </label>

        <Button type="submit" size="lg" full disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
