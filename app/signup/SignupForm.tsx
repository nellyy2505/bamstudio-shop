"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Icon, cx, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const AFTER_SIGNUP = "/account/orders";

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

/** Tailwind scans statically, so every meter colour must appear literally. */
const METER_FILL = [
  "bg-line",
  "bg-danger",
  "bg-star",
  "bg-good",
  "bg-good",
] as const;

const METER_LABEL = ["", "Weak", "Fair", "Good", "Strong"] as const;

function strengthOf(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[a-zA-Z]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  return score;
}

export function SignupForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [marketing, setMarketing] = useState(true);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  const score = strengthOf(password);

  async function signUpWithGoogle() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(AFTER_SIGNUP)}`,
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    setPasswordError(undefined);
    setPending(true);

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          marketing_opt_in: marketing,
        },
        emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(AFTER_SIGNUP)}`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setPending(false);
      return;
    }

    // No session means the project requires email confirmation first.
    if (!data.session) {
      setConfirmSent(true);
      setPending(false);
      return;
    }

    router.push(AFTER_SIGNUP);
    router.refresh();
  }

  if (confirmSent) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
          <Icon name="mail" size={26} />
        </span>
        <div>
          <h2 className="text-xl">Check your email to confirm</h2>
          <p className="mt-1.5 text-sm text-muted">
            We&apos;ve sent a confirmation link to <b>{email}</b>. Open it and
            you&apos;ll be signed straight in.
          </p>
        </div>
        <Alert tone="info">
          Nothing yet? Give it a minute, then check your spam folder.
        </Alert>
        <Link
          href="/login"
          className="text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button
        type="button"
        variant="soft"
        full
        onClick={signUpWithGoogle}
        disabled={pending}
      >
        <GoogleMark />
        Sign up with Google
      </Button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11.5px] font-extrabold tracking-[0.14em] text-faint">
          OR
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="first-name">
            <input
              id="first-name"
              name="first-name"
              type="text"
              required
              autoComplete="given-name"
              placeholder="Mia"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Last name" htmlFor="last-name">
            <input
              id="last-name"
              name="last-name"
              type="text"
              required
              autoComplete="family-name"
              placeholder="Nguyen"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

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
          error={passwordError}
          hint="At least 8 characters, with a number and a symbol."
        >
          <>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="flex flex-1 gap-1.5" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cx(
                      "h-1.5 flex-1 rounded-full",
                      i < score ? METER_FILL[score] : "bg-line",
                    )}
                  />
                ))}
              </span>
              <span className="w-12 text-right text-[11.5px] font-bold text-muted">
                {METER_LABEL[score]}
              </span>
            </div>
            <span className="sr-only" aria-live="polite">
              {score > 0 ? `Password strength: ${METER_LABEL[score]}` : ""}
            </span>
          </>
        </Field>

        <label
          htmlFor="marketing"
          className="flex items-start gap-2.5 text-[13.5px] text-muted"
        >
          <input
            id="marketing"
            name="marketing"
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-line2 accent-accent"
          />
          Email me new drops and the occasional restock. No spam, promise.
        </label>

        <Button type="submit" size="lg" full disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>

        <p className="text-center text-xs text-faint">
          By creating an account you agree to our{" "}
          <Link href="/legal/terms" className="underline underline-offset-2 hover:text-ink">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline underline-offset-2 hover:text-ink">
            Privacy policy
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
