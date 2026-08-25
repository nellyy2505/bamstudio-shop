import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./LoginForm";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";

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
  const next = safeNext(one(params.next));
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
            gated too rather than left pointing at a form that cannot run. */}
        <p className="mt-6 text-center text-sm text-muted">
          {CAN_SIGN_IN ? (
            <>
              New to Bam Studio?{" "}
              <Link
                href="/signup"
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
