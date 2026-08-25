import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Gates every claim on this page about what an account does for you.
 *
 * Defect this closes: the subtitle promised "Save baskets, track orders,
 * reorder favourites" directly above a form that now says plainly that
 * accounts aren't switched on — the contradiction sat in one card, two lines
 * apart. None of the three is possible with no accounts system behind the
 * shop, and there is no saved-basket code at all. Same class as WORKLOG §0.1:
 * a customer-facing claim not gated on the capability behind it.
 *
 * Safe in a server component, and guaranteed to agree with the client form
 * below: `isSupabaseConfigured()` reads only `NEXT_PUBLIC_SUPABASE_URL` and
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY`. There is no secret here — the anon key is
 * public by design and Next inlines both into the client bundle — so server
 * and browser evaluate the same two values and cannot diverge. (The
 * server-only `isDatabaseConfigured()` would give the same answer here but not
 * in SignupForm, which is why both sides use this one helper.)
 */
const CAN_SIGN_UP = isSupabaseConfigured();

export const metadata: Metadata = {
  title: "Create account",
  description: CAN_SIGN_UP
    ? "Create a Bam Studio account to save baskets, track orders and reorder favourites."
    : "Bam Studio accounts aren't open yet, so there's nothing to create just now.",
};

export default function SignupPage() {
  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Create your account</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            {CAN_SIGN_UP
              ? "Save baskets, track orders, reorder favourites."
              : "Accounts aren't open yet, so there's nothing to set up just now. Pop back once we've switched them on."}
          </p>
          <SignupForm />
        </div>

        {/* "Already have an account?" asserts that accounts exist, so it is
            gated too rather than pointing at a sign-in that cannot run. */}
        <p className="mt-6 text-center text-sm text-muted">
          {CAN_SIGN_UP ? (
            <>
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              Signing in isn&apos;t open yet either —{" "}
              <Link
                href="/shop"
                className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                have a look around the shop
              </Link>{" "}
              in the meantime.
            </>
          )}
        </p>
      </div>
    </div>
  );
}
