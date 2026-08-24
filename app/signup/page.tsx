import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Create account",
  description:
    "Create a Bam Studio account to save baskets, track orders and reorder favourites.",
};

export default function SignupPage() {
  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Create your account</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            Save baskets, track orders, reorder favourites.
          </p>
          <SignupForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
