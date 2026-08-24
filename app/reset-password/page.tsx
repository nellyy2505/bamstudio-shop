import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Bam Studio account.",
};

export default function ResetPasswordPage() {
  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Set a new password</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            Pick something you haven&apos;t used before — at least 8 characters.
          </p>
          <ResetPasswordForm />
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/login"
            className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
          >
            ← Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
