import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
  description:
    "Sign in to your Bam Studio account to track orders, see favourites and check out faster.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `next` comes from the URL, so anything that could leave the origin
 * (absolute URLs, `//host`, `/\host`) falls back to the account area.
 */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/")) return "/account/orders";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/account/orders";
  return value;
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
            Sign in to track orders, see favourites and check out faster.
          </p>
          <LoginForm next={next} initialError={error} />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          New to Bam Studio?{" "}
          <Link
            href="/signup"
            className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
