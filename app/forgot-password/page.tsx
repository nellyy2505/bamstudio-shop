import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Supabase Auth's password-reset email is real and genuinely sends once the
 * project is connected, so the promise below is true in production and stays
 * word for word. It is only gated: while the shop has no Supabase project this
 * page was telling the customer, ungated, that a link was on its way and that
 * it expires in 30 minutes — for an email nothing had even attempted to send
 * (the submit threw before reaching Supabase at all). Gate the claim on the
 * capability, the same way `SHOP.gstRegistered` gates every GST surface.
 *
 * `isSupabaseConfigured()` reads only `NEXT_PUBLIC_*` vars, so this server
 * component and the client component it renders reach the identical answer —
 * see the note on `CAN_RESET` in ForgotPasswordForm.tsx.
 */
const CAN_RESET = isSupabaseConfigured();

export const metadata: Metadata = {
  title: "Reset your password",
  description: CAN_RESET
    ? "Send yourself a link to set a new password for your Bam Studio account."
    : "Setting a new password for your Bam Studio account isn't available just yet.",
};

export default function ForgotPasswordPage() {
  return (
    <div className="wrap flex justify-center py-12 md:py-16">
      <div className="w-full max-w-[460px]">
        <div className="card px-6 py-8 sm:px-8">
          <h1 className="text-[28px]">Reset your password</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted">
            {CAN_RESET
              ? "Pop in your email and we'll send you a link to set a new one."
              : "Setting a new password isn't available just yet."}
          </p>
          <ForgotPasswordForm />
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
