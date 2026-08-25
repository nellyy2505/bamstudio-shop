import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

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

function loginWithError(origin: string, code: AuthErrorCode, detail?: string) {
  if (detail) console.warn(`Auth callback failed (${code}):`, detail);
  return NextResponse.redirect(new URL(`/login?error=${code}`, origin));
}

/** Lands here after OAuth, email confirmation and password-reset links. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  const providerError =
    url.searchParams.get("error") ?? url.searchParams.get("error_description");
  if (providerError) {
    const code =
      providerError.includes("denied") || providerError.includes("access_denied")
        ? "denied"
        : "failed";
    return loginWithError(url.origin, code, providerError);
  }

  if (!code) {
    return loginWithError(url.origin, "invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const expired = /expire|invalid/i.test(error.message);
    return loginWithError(url.origin, expired ? "expired" : "failed", error.message);
  }

  const response = NextResponse.redirect(new URL(next, url.origin));

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
