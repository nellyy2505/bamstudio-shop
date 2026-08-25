"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Whether the browser holds the keys it needs to reach Supabase Auth.
 *
 * Defect this closes: with no Supabase env vars — the shop's state today, and
 * a supported mode of this app — `createClient()` threw inside the submit
 * handler. The rejection was unhandled, `setPending(false)` never ran and the
 * button sat on "Signing in…" forever with no error ever reaching the
 * customer. Same class as WORKLOG §0.1: a customer-facing claim (below, "open
 * the confirmation email we sent you") not gated on the capability behind it,
 * plus a hang.
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
const CAN_SIGN_IN = isSupabaseConfigured();

/**
 * Shown when the shop has no accounts system behind it. Plain, in the shop's
 * voice, and it never names an env var, prints an exception or blames the
 * details the customer typed — none of that is theirs to fix.
 */
const UNAVAILABLE =
  "Signing in isn't switched on yet — this shop isn't connected to its accounts system, so we can't sign anyone in. Nothing you type here would reach us. Have a browse in the meantime and try again later.";

const OFFLINE =
  "We couldn't reach the shop just now. Check your connection and try again.";

/** Supabase raises this (status 0) when the request never got a response. */
function isOffline(error: { name?: string; status?: number }): boolean {
  return error.name === "AuthRetryableFetchError" || error.status === 0;
}

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
 *
 * The confirmation-email sentence is a claim about mail actually arriving.
 * Supabase Auth's sign-up confirmation email is real and genuinely sends once
 * the project is connected, so the wording is kept exactly — it is only gated
 * on there being a project at all, never softened.
 */
const GENERIC_SIGNIN_ERROR =
  "We couldn't sign you in. Check your email address and password." +
  (CAN_SIGN_IN
    ? " If you've just created an account, open the confirmation email we sent you first."
    : "");

function signInMessage(
  code: string | undefined,
  status: number | undefined,
  fallback: string = GENERIC_SIGNIN_ERROR,
): string {
  const safe = code ? SAFE_SIGNIN_ERRORS[code] : undefined;
  if (safe) return safe;
  // Responses can arrive rate-limited without a code.
  if (status === 429) return SAFE_SIGNIN_ERRORS.over_request_rate_limit;
  // A request that never landed is not the shopper's password being wrong;
  // telling them to check details they typed correctly sends them in circles.
  if (isOffline({ status })) return OFFLINE;
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

    // Defence in depth: this button is disabled while unconfigured, so the
    // click should not be reachable — but if it arrives it must say something
    // true rather than throw into a dead promise.
    if (!CAN_SIGN_IN) {
      setError(UNAVAILABLE);
      return;
    }

    setPending(true);
    // The only path that deliberately leaves the button busy is the one that
    // is navigating away. Every other path — a returned error, a throw —
    // hands the button back.
    let leaving = false;
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      if (oauthError) {
        // No address has been typed at this point, so nothing can be
        // enumerated here — but the raw text is provider/config noise, not
        // shopper copy.
        setError(
          signInMessage(
            oauthError.code,
            oauthError.status,
            "We couldn't start sign-in with Google. Please try again.",
          ),
        );
        return;
      }
      // signInWithOAuth redirects the tab itself once it resolves cleanly.
      leaving = true;
    } catch {
      // The exception is never shown — no stack trace, no env-var name.
      setError(CAN_SIGN_IN ? OFFLINE : UNAVAILABLE);
    } finally {
      if (!leaving) setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // See signInWithGoogle: the fields below are disabled while unconfigured.
    if (!CAN_SIGN_IN) {
      setError(UNAVAILABLE);
      return;
    }

    setPending(true);
    let leaving = false;
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInMessage(signInError.code, signInError.status));
        return;
      }

      router.push(next);
      router.refresh();
      leaving = true;
    } catch {
      setError(CAN_SIGN_IN ? OFFLINE : UNAVAILABLE);
    } finally {
      // Runs on every path, including the throw that used to leave the button
      // stuck on "Signing in…" with no error ever reaching the customer.
      if (!leaving) setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not an error the customer caused, so it renders before they touch
          anything rather than after a submit that cannot work. */}
      {!CAN_SIGN_IN ? <Alert tone="error">{UNAVAILABLE}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button
        type="button"
        variant="soft"
        full
        onClick={signInWithGoogle}
        disabled={pending || !CAN_SIGN_IN}
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
            disabled={!CAN_SIGN_IN}
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
            disabled={!CAN_SIGN_IN}
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
            disabled={!CAN_SIGN_IN}
            className="h-4 w-4 rounded border-line2 accent-accent"
          />
          Keep me signed in
        </label>

        <Button
          type="submit"
          size="lg"
          full
          disabled={pending || !CAN_SIGN_IN}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
