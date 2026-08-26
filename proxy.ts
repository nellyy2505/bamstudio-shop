import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Paths nobody signed-out may reach. Prefixes, matched with a boundary so
 * `/accountant` — a page that does not exist today but might — is not
 * accidentally covered, and so `/admin-something` is not silently guarded
 * while looking like it is.
 */
const SIGNED_IN_ONLY = ["/account", "/admin"] as const;

function needsSignIn(pathname: string): boolean {
  return SIGNED_IN_ONLY.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

/**
 * Refreshes the Supabase auth cookie on every request and guards /account and
 * /admin. Without this, server components see a stale (expired) session.
 *
 * Note what this file can and cannot do. It only has the anon client, and the
 * `staff` table is unreadable with the anon key by design (see the header of
 * lib/auth/staff.ts). So the gate below establishes "signed in at all" and
 * nothing more — it is a cheap first pass that keeps signed-out visitors off
 * the staff area. Whether a signed-in account is *staff* is decided by
 * `requireStaff()`, on the server, in every page, route handler and server
 * action under /admin. Do not be tempted to add a role check here.
 */
/**
 * The header the root layout reads to decide whether to draw the shop's own
 * chrome around a page.
 *
 * A layout cannot see the path it is rendering — that is by design in the App
 * Router, so a layout cannot re-render on navigation. The proxy can, and it
 * already runs on every matched request, so it stamps the path on the request
 * on the way through.
 */
export const PATH_HEADER = "x-bamstudio-path";

function withPath(request: NextRequest): NextResponse {
  // Set on the REQUEST headers, not the response: this is for the server
  // rendering the page, and it must never be echoed back to the browser.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

export async function proxy(request: NextRequest) {
  let response = withPath(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Before Supabase is configured the shop still browses on sample data.
  // Nobody can be signed in, so there is nothing behind these paths to reach.
  if (!url || !anonKey) {
    if (needsSignIn(request.nextUrl.pathname)) {
      // No `next` here on purpose: with Supabase unconfigured nobody can sign
      // in, so there is nowhere to come back from. The inherited query is
      // dropped rather than carried onto /login as stray parameters.
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.search = "";
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
          response = withPath(request);
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

  if (!user && needsSignIn(request.nextUrl.pathname)) {
    // The query string is part of where they were going, not decoration.
    // /admin/join?token=... IS the invitation: sending only the pathname meant
    // an invited person signed in, landed back on the join page with no token,
    // and was told the link was not valid. `search` is carried, and the
    // inherited params are cleared first so the original query is not also
    // repeated on /login as loose parameters of its own.
    const back = request.nextUrl.pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", back);
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
