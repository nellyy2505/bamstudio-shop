import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_NEXT = "/account/orders";

/**
 * `next` is attacker-controllable, so only same-origin paths are allowed.
 * `//host` and `/\host` are protocol-relative to a browser — an open redirect.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/")) return DEFAULT_NEXT;
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_NEXT;
  return value;
}

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

  return NextResponse.redirect(new URL(next, url.origin));
}
