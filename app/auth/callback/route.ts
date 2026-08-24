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

function loginWithError(origin: string, message: string) {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(message)}`, origin),
  );
}

/** Lands here after OAuth, email confirmation and password-reset links. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  const providerError =
    url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) {
    return loginWithError(url.origin, providerError);
  }

  if (!code) {
    return loginWithError(url.origin, "That sign-in link is missing its code.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return loginWithError(url.origin, error.message);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
