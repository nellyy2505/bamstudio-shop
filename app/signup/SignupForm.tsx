"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Icon, cx, inputClass } from "@/components/ui";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Whether the browser holds the keys it needs to reach Supabase Auth.
 *
 * Defect this closes: with no Supabase env vars — the shop's state today, and
 * a supported mode of this app — `createClient()` threw inside the submit
 * handler. The rejection was unhandled, `setPending(false)` never ran and the
 * button sat on "Creating account…" forever with no error ever reaching the
 * customer. Same class as WORKLOG §0.1: a customer-facing claim ("Check your
 * email to confirm") not gated on the capability behind it, plus a hang.
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
const CAN_SIGN_UP = isSupabaseConfigured();

/**
 * Shown when the shop has no accounts system behind it. Plain, in the shop's
 * voice, and it never names an env var, prints an exception or blames the
 * details the customer typed — none of that is theirs to fix.
 */
const UNAVAILABLE =
  "Accounts aren't switched on yet — this shop isn't connected to its accounts system, so we can't create one for you. Nothing you type here would reach us. Have a browse in the meantime and try again later.";

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

/** Tailwind scans statically, so every meter colour must appear literally. */
const METER_FILL = [
  "bg-line",
  "bg-danger",
  "bg-star",
  "bg-good",
  "bg-good",
] as const;

const METER_LABEL = ["", "Weak", "Fair", "Good", "Strong"] as const;

/**
 * Sign-up errors that are safe to show verbatim-ish, keyed by Supabase's
 * stable error code. Every one of these is about what the visitor just typed
 * or how fast they typed it — none of them reveal whether an address is
 * already registered here.
 */
const SAFE_SIGNUP_ERRORS: Record<string, string> = {
  weak_password: "That password is too weak. Use at least 8 characters, with a number and a symbol.",
  email_address_invalid: "That email address doesn't look right. Please check it.",
  validation_failed: "Please check the details you entered and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  over_email_send_rate_limit: "Too many attempts. Please wait a minute and try again.",
  signup_disabled: "New accounts are temporarily closed. Please try again later.",
  email_provider_disabled: "Signing up with an email address isn't available right now.",
};

/**
 * Supabase reports an existing address as "User already registered" whenever
 * email confirmation is off. Echoing that turns this form into an oracle:
 * anyone could type addresses at it and learn which ones have accounts —
 * precisely the leak /forgot-password goes out of its way to avoid. So we
 * treat it as indistinguishable from success: the visitor sees the same
 * "check your email to confirm" screen either way, and the real owner of the
 * address is the only person who learns anything from what does (or doesn't)
 * arrive in their inbox.
 */
function isAlreadyRegistered(code: string | undefined, message: string): boolean {
  if (code === "user_already_exists" || code === "email_exists") return true;
  return /already\s*(registered|exists|in use)/i.test(message);
}

function strengthOf(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[a-zA-Z]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  return score;
}

/**
 * `next` arrives already validated.
 *
 * Defect this closes: this form used to hold its own `AFTER_SIGNUP =
 * "/account/orders"` and ignore `next` completely, so an invited person who
 * signed up from /signup?next=/admin/join?token=… landed in the shop's account
 * area with the invitation unopened. It is a prop now, resolved once by
 * `safeNext()` in page.tsx.
 *
 * It is deliberately NOT re-checked here. `safe-next.ts` returns the reparsed
 * path precisely so no consumer can arrive at a different destination from the
 * one that was validated, and a second validator in a client component is the
 * second answer that file exists to prevent. This mirrors `LoginForm`, which
 * takes `next` the same way.
 */
export function SignupForm({
  next,
  carried,
}: {
  next: string;
  /**
   * True when `next` came from the URL rather than being the page's own
   * fallback — the difference between "we'll put you back where you were" and
   * "we'll take you to your orders". Only ever used to choose honest wording
   * and to decide whether a link needs the parameter; the destination itself is
   * `next` either way.
   */
  carried: boolean;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Unticked by default: the privacy policy says marketing only goes to people
  // who asked for it, and a pre-ticked box is not asking.
  const [marketing, setMarketing] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  const score = strengthOf(password);

  async function signUpWithGoogle() {
    setError(null);

    // Defence in depth: this button is disabled while unconfigured, so the
    // click should not be reachable — but if it arrives it must say something
    // true rather than throw into a dead promise.
    if (!CAN_SIGN_UP) {
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
        // Was `oauthError.message`: Supabase's own text is provider and
        // configuration noise ("Failed to fetch"), not shop copy, and no
        // address has been typed here for it to say anything about.
        setError(
          isOffline(oauthError)
            ? OFFLINE
            : "We couldn't start sign-up with Google. Please try again.",
        );
        return;
      }
      // signInWithOAuth redirects the tab itself once it resolves cleanly.
      leaving = true;
    } catch {
      // The exception is never shown — no stack trace, no env-var name.
      setError(CAN_SIGN_UP ? OFFLINE : UNAVAILABLE);
    } finally {
      if (!leaving) setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // See signUpWithGoogle: the fields below are disabled while unconfigured.
    if (!CAN_SIGN_UP) {
      setError(UNAVAILABLE);
      return;
    }

    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    setPasswordError(undefined);
    setPending(true);
    let leaving = false;
    try {
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
          // This is the only place `next` can be put where it survives the
          // person leaving the browser: Supabase copies `emailRedirectTo` into
          // the confirmation link's `redirect_to`, so the parameter travels in
          // the email itself rather than in any state we hold locally. The
          // whole callback URL — query string included — has to be on the
          // project's Redirect URLs list, exactly as the Google button above
          // already requires. If it is not, Supabase drops it and falls back to
          // the project's Site URL; the confirmation screen below says what to
          // do when that happens instead of pretending it cannot.
          emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (signUpError) {
        // A request that never landed says nothing about the address typed,
        // so it must not be dressed up as "check your details" — and it must
        // not reach the confirmation screen either, because no mail was sent.
        if (isOffline(signUpError)) {
          setError(OFFLINE);
          return;
        }

        // Same screen as the success path below — see isAlreadyRegistered.
        if (isAlreadyRegistered(signUpError.code, signUpError.message)) {
          setConfirmSent(true);
          return;
        }

        const safe = signUpError.code
          ? SAFE_SIGNUP_ERRORS[signUpError.code]
          : undefined;
        setError(
          safe ??
            "We couldn't create that account. Please check your details and try again.",
        );
        return;
      }

      // No session means the project requires email confirmation first.
      if (!data.session) {
        setConfirmSent(true);
        return;
      }

      // Confirmation is off, so there is a session already and no round trip
      // through the inbox at all — straight to where they were headed.
      router.push(next);
      router.refresh();
      leaving = true;
    } catch {
      setError(CAN_SIGN_UP ? OFFLINE : UNAVAILABLE);
    } finally {
      // Runs on every path, including the throw that used to leave the button
      // stuck on "Creating account…" with no error ever reaching the customer.
      if (!leaving) setPending(false);
    }
  }

  // Only reachable once CAN_SIGN_UP is true — every path that sets
  // confirmSent runs after a real Supabase signUp call. Supabase Auth's
  // confirmation email genuinely sends once the project is connected, so this
  // claim is true wherever it can be rendered at all; it is gated by
  // construction rather than softened.
  if (confirmSent) {
    return (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
          <Icon name="mail" size={26} />
        </span>
        <div>
          <h2 className="text-xl">Check your email to confirm</h2>
          {/* Where they are going is described, never printed. `next` is a
              path out of the URL, and the sign-in page's rule holds here too:
              text that arrived in a query string does not get rendered, or a
              crafted link turns this card into a message from us. */}
          <p className="mt-1.5 text-sm text-muted">
            We&apos;ve sent a confirmation link to <b>{email}</b>. Open it and
            you&apos;ll be signed straight in
            {carried ? ", then brought back to where you left off" : ""}.
          </p>
          {/* Said plainly rather than hidden: the destination rides in the
              confirmation link, so it depends on Supabase honouring the
              redirect it was given. If it does not, this person is signed in
              and standing in the wrong room with no idea why. Telling them to
              reopen the original link is the one instruction that fixes it,
              and it costs nothing when the link works. */}
          {carried ? (
            <p className="mt-2 text-sm text-muted">
              If it signs you in but leaves you somewhere else, open the link
              that sent you here again — it will pick up from there.
            </p>
          ) : null}
        </div>
        <Alert tone="info">
          Nothing yet? Give it a minute, then check your spam folder.
        </Alert>
        {/* Carries `next` as well: somebody who realises here that they already
            have an account must not lose their destination on the way to
            sign in. */}
        <Link
          href={carried ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not an error the customer caused, so it renders before they touch
          anything rather than after a submit that cannot work. */}
      {!CAN_SIGN_UP ? <Alert tone="error">{UNAVAILABLE}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <Button
        type="button"
        variant="soft"
        full
        onClick={signUpWithGoogle}
        disabled={pending || !CAN_SIGN_UP}
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
              disabled={!CAN_SIGN_UP}
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
              disabled={!CAN_SIGN_UP}
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
            disabled={!CAN_SIGN_UP}
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
              disabled={!CAN_SIGN_UP}
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
            disabled={!CAN_SIGN_UP}
            className="mt-0.5 h-4 w-4 rounded border-line2 accent-accent"
          />
          {/* Nothing sends marketing email, so this records a preference rather
              than starting a subscription. Saying otherwise would promise mail
              that no code writes. */}
          Count me in for news about new drops and restocks. There is no mailing
          list yet, so nothing will be sent for now — you can change this any
          time in your account settings.
        </label>

        <Button
          type="submit"
          size="lg"
          full
          disabled={pending || !CAN_SIGN_UP}
        >
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
