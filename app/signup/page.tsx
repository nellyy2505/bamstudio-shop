import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./SignupForm";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DEFAULT_NEXT, safeNext } from "@/lib/safe-next";

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
  /*
   * Not for the index, and robots.txt is the wrong tool for saying so.
   *
   * The sign-in page and the header both link here.
   *
   * Google therefore finds it whatever /robots.txt says, and a `Disallow`
   * would only stop it FETCHING the page, leaving it free to list the bare
   * URL from those links with no directive it is allowed to read. `noindex`
   * on a page that stays crawlable is what actually keeps it out. The
   * default `follow` is kept, so link equity still flows through to the shop
   * pages linked from here. See `app/robots.ts`.
   */
  robots: { index: false },
  description: CAN_SIGN_UP
    ? "Create a Bam Studio account to save baskets, track orders and reorder favourites."
    : "Bam Studio accounts aren't open yet, so there's nothing to create just now.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Next 16 hands searchParams over as a Promise, and repeats may be arrays. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Where somebody who arrived here under their own steam — no `next` — is sent
 * once the account exists.
 *
 * Passed to `safeNext()` explicitly rather than leaning on its built-in
 * default. The two values happen to agree today, but the point is that this
 * page decides its own answer: `DEFAULT_NEXT` is the *customer's* destination,
 * and this page also serves people arriving from an invitation, for whom
 * /account/orders is simply the wrong room. Their answer travels in `next`, and
 * the fallback must never quietly overrule it. Changing the shared default to
 * suit invitees would break every other consumer, so the caller states its
 * preference here instead.
 */
const SIGNUP_FALLBACK = DEFAULT_NEXT;

/**
 * Defect this closes: /admin/join?token=… is the route that turns a staff
 * invitation into studio access, and it needs an account. `proxy.ts` sends a
 * signed-out visitor to /login?next=/admin/join?token=…, and sign-in honours
 * that — but somebody invited who has no account yet clicks through to sign up,
 * and this page ignored `next` entirely while `SignupForm` hardcoded
 * /account/orders. They finished signing up in the shop's account area, with
 * the invitation still sitting unopened in their messages, and had to go and
 * find the link a second time.
 *
 * `next` is now read here, validated once by `safeNext()` — never re-derived
 * further down — and handed to the form, which carries it through sign-up, the
 * confirmation email and /auth/callback. It also travels on the link across to
 * /login, because a round trip that survives the form and dies on a "Sign in"
 * link is still broken.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const next = safeNext(one(params.next), SIGNUP_FALLBACK);
  // True only when the visitor was sent here from somewhere that wants them
  // back. Everyone else gets plain links, rather than the shop's own default
  // spelled out as a parameter on every URL.
  const carried = next !== SIGNUP_FALLBACK;

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
          <SignupForm next={next} carried={carried} />
        </div>

        {/* "Already have an account?" asserts that accounts exist, so it is
            gated too rather than pointing at a sign-in that cannot run. */}
        <p className="mt-6 text-center text-sm text-muted">
          {CAN_SIGN_UP ? (
            <>
              Already have an account?{" "}
              <Link
                href={carried ? `/login?next=${encodeURIComponent(next)}` : "/login"}
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
