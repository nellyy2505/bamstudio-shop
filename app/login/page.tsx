import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DEFAULT_NEXT, safeNext } from "@/lib/safe-next";

/**
 * Gates every claim on this page about what an account does for you.
 *
 * Defect this closes: the subtitle promised "track orders, see favourites and
 * check out faster" while the form directly beneath it now says plainly that
 * signing in isn't switched on — the contradiction sat in one card, two lines
 * apart. None of the three is possible with no accounts system behind the
 * shop. Same class as WORKLOG §0.1: a customer-facing claim not gated on the
 * capability behind it.
 *
 * Safe in a server component, and guaranteed to agree with the client form
 * below: `isSupabaseConfigured()` reads only `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`. There is no secret here — the anon key is
 * public by design and Next inlines both into the client bundle — so server
 * and browser evaluate the same two values and cannot diverge. (The
 * server-only `isDatabaseConfigured()` would give the same answer here but not
 * in LoginForm, which is why both sides use this one helper.)
 */
const CAN_SIGN_IN = isSupabaseConfigured();

export const metadata: Metadata = {
  title: "Sign in",
  /*
   * Not for the index, and robots.txt is the wrong tool for saying so.
   *
   * The header links "Sign in" from every signed-out page, and /signup,
   * /forgot-password and the `proxy.ts` account guard all point here.
   *
   * Google therefore finds it whatever /robots.txt says, and a `Disallow`
   * would only stop it FETCHING the page, leaving it free to list the bare
   * URL from those links with no directive it is allowed to read. `noindex`
   * on a page that stays crawlable is what actually keeps it out. The
   * default `follow` is kept, so link equity still flows through to the shop
   * pages linked from here. See `app/robots.ts`.
   */
  robots: { index: false },
  description: CAN_SIGN_IN
    ? "Sign in to your Bam Studio account to track orders, see favourites and check out faster."
    : "Bam Studio accounts aren't open yet, so there's nothing to sign in to just now.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // The fallback is stated rather than inherited: it is this page's answer for
  // a customer who wandered in on their own, not a shared constant the shop is
  // obliged to use. See the note on SIGNUP_FALLBACK in app/signup/page.tsx.
  const next = safeNext(one(params.next), DEFAULT_NEXT);
  // Whether somebody was sent here from somewhere that wants them back — which
  // decides whether the link across to sign-up has to carry `next` too.
  const carried = next !== DEFAULT_NEXT;
  // Map the callback's error code to our own copy — never render text that
  // arrived in the URL.
  const AUTH_ERRORS: Record<string, string> = {
    denied: "Sign-in was cancelled. You can try again below.",
    expired: "That sign-in link has expired. Request a new one.",
    invalid: "That sign-in link was incomplete. Try signing in again.",
    failed: "We couldn't complete sign-in. Please try again.",
  };
  const errorCode = one(params.error);
  const error = errorCode ? (AUTH_ERRORS[errorCode] ?? AUTH_ERRORS.failed) : undefined;

  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Welcome back</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            {CAN_SIGN_IN
              ? "Sign in to track orders, see favourites and check out faster."
              : "Accounts aren't open yet, so there's nothing to sign in to just now. The whole shop is here to browse in the meantime."}
          </p>
          <LoginForm next={next} initialError={error} />
        </div>

        {/* "Create an account" is the same promise one page along, so it is
            gated too rather than left pointing at a form that cannot run.

            It also carries `next`. Someone invited to the studio who has no
            account yet arrives on /login?next=/admin/join?token=… from
            `proxy.ts` and leaves through this link; without the parameter the
            invitation is dropped on the doorstep and they have to go back to
            their messages and open it again. The value has already been through
            `safeNext()` above and is not re-derived here. */}
        <p className="mt-6 text-center text-sm text-muted">
          {CAN_SIGN_IN ? (
            <>
              New to Bam Studio?{" "}
              <Link
                href={carried ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
                className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                Create an account
              </Link>
            </>
          ) : (
            <>
              Nothing to sign in to yet —{" "}
              <Link
                href="/shop"
                className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                have a look around the shop
              </Link>{" "}
              instead.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
