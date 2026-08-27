import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_NEXT, safeNext } from "@/lib/safe-next";
import { siteUrl } from "@/lib/stripe";

export const runtime = "nodejs";

/** The one destination that earns a verified-recovery marker. */
const RECOVERY_NEXT = "/reset-password";

/**
 * Only these codes reach the sign-in page. The provider's own
 * `error_description` is attacker-controllable via a crafted callback URL —
 * reflecting it would let anyone put convincing text ("call support on…") on
 * the real login screen.
 */
export type AuthErrorCode = "denied" | "expired" | "invalid" | "failed";

function loginWithError(code: AuthErrorCode, detail?: string) {
  if (detail) console.warn(`Auth callback failed (${code}):`, detail);
  return NextResponse.redirect(new URL(`/login?error=${code}`, siteUrl()));
}

/**
 * Lands here after OAuth, email confirmation and password-reset links.
 *
 * **Every redirect out of this route is built on `siteUrl()`, never on
 * `url.origin`.** `request.url` is assembled from the address the *server* is
 * listening on, and on Fly that is the container's own bind address — so
 * `url.origin` was `http://0.0.0.0:8080` in production and every successful
 * Google sign-in ended on `ERR_ADDRESS_INVALID`. The session cookie was set
 * correctly on the way past, which is why pressing Back showed the user signed
 * in: the authentication worked and only the redirect was thrown away. Email
 * confirmation and password-reset links landed in the same dead end.
 *
 * This is the round-8 defect exactly — `siteUrl()` silently returning
 * localhost, so a customer was charged and then sent to their own machine —
 * found in `lib/stripe.ts` and fixed there, and missed here.
 *
 * Do not "fix" this with `x-forwarded-host` instead. That would be a second
 * answer to "what is this shop's address", which is the pattern this codebase
 * has been burned by twice; and the header is caller-supplied, which on the
 * error path below would hand an attacker an open redirect off the real login
 * screen. One source of truth: `NEXT_PUBLIC_SITE_URL`, baked in at build.
 */
export async function GET(request: Request) {
  // Path and query off request.url are fine — only its ORIGIN is wrong here.
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Sign-in, sign-up and the confirmation email all put `next` on this URL, so
  // by the time we are here it is the only record of where the person was
  // headed — there is no state on our side to fall back on. The customer
  // default is stated rather than inherited, and it is genuinely a guess: if
  // Supabase declined the redirect it was handed (the callback URL, query
  // string and all, has to be on the project's Redirect URLs list) then `next`
  // never arrived and an invited person lands on their orders instead of their
  // invitation. That is why /signup's confirmation screen tells them to reopen
  // the original link rather than leaving them to work it out.
  const next = safeNext(url.searchParams.get("next"), DEFAULT_NEXT);

  const providerError =
    url.searchParams.get("error") ?? url.searchParams.get("error_description");
  if (providerError) {
    const code =
      providerError.includes("denied") || providerError.includes("access_denied")
        ? "denied"
        : "failed";
    return loginWithError(code, providerError);
  }

  if (!code) {
    return loginWithError("invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const expired = /expire|invalid/i.test(error.message);
    return loginWithError(expired ? "expired" : "failed", error.message);
  }

  const response = NextResponse.redirect(new URL(next, siteUrl()));

  // A session on its own says nothing about *how* it was obtained, so
  // /reset-password cannot tell "just clicked the emailed recovery link" from
  // "someone walked up to a browser that was left signed in". This cookie is
  // the only place that distinction exists: we set it exactly once, here,
  // after a code exchange that the user reached by following a reset link.
  // /reset-password waives the current-password check only when it sees it.
  //
  // Deliberately narrow: httpOnly (script can't forge or read it), path-scoped
  // to /reset-password (never sent anywhere else), and 15 minutes — long
  // enough to pick a password, too short to be a standing bypass.
  if (next === RECOVERY_NEXT) {
    response.cookies.set("bs_pw_recovery", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: RECOVERY_NEXT,
      maxAge: 900,
    });
  }

  return response;
}
