import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie on every request and guards /account.
 * Without this, server components see a stale (expired) session.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Before Supabase is configured the shop still browses on sample data.
  // Nobody can be signed in, so /account has nothing to guard.
  if (!url || !anonKey) {
    if (request.nextUrl.pathname.startsWith("/account")) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      return NextResponse.redirect(redirect);
    }
    return response;
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/account")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, the Stripe webhook and the health
     * check.
     *
     * `api/webhooks` must receive an untouched raw body — Stripe's signature
     * is computed over the exact bytes that arrived.
     *
     * `api/health` is excluded because every matched request runs
     * `supabase.auth.getUser()` above, which is a network round trip to
     * Supabase. Fly health-checks that endpoint every few seconds for the life
     * of the machine, so leaving it matched would spend Supabase free-tier
     * request budget continuously — on a request that carries no cookies and
     * can never be signed in.
     *
     * This is a single negative lookahead, and every alternative inside it is
     * a path *prefix* written without a leading slash. Get one wrong — a stray
     * `/`, a misplaced `|` — and nothing errors: the exclusion silently
     * widens, and the first thing to stop working is the `/account` guard
     * below, quietly. After any edit, re-check `/account`,
     * `/account/orders`, `/api/health` and `/api/webhooks/stripe` against the
     * pattern before trusting it.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
