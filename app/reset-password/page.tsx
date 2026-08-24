import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { getUser } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Set a new password",
  description: "Choose a new password for your Bam Studio account.",
};

export default async function ResetPasswordPage() {
  // Set by /auth/callback after a successful exchange of an emailed recovery
  // link, and only then. Its presence is the sole proof that the person here
  // proved control of the mailbox — which is why it, rather than the mere
  // existence of a session, is what waives the current-password check.
  const cookieStore = await cookies();
  const viaRecovery = cookieStore.get("bs_pw_recovery")?.value === "1";

  let signedIn = false;
  try {
    signedIn = Boolean(await getUser());
  } catch {
    // Supabase unconfigured — treat as signed out and show the recovery route.
  }

  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Set a new password</h1>

          {signedIn ? (
            <>
              <p className="mt-1.5 mb-6 text-sm text-muted">
                {viaRecovery
                  ? "Pick something you haven't used before — at least 8 characters."
                  : "Confirm your current password, then pick a new one — at least 8 characters."}
              </p>
              <ResetPasswordForm viaRecovery={viaRecovery} />
            </>
          ) : (
            <>
              <p className="mt-1.5 mb-6 text-sm text-muted">
                This link has expired, or you&apos;re not signed in on this
                device.
              </p>
              <Alert tone="info">
                Password reset links are single-use and expire after 30 minutes.
                Request a fresh one and open it on this device.
              </Alert>
              <p className="mt-6 text-sm text-muted">
                <Link
                  href="/forgot-password"
                  className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
                >
                  Send me a new reset link
                </Link>
              </p>
            </>
          )}
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
