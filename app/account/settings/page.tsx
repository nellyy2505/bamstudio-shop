import type { Metadata } from "next";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { EmailPreferences } from "./EmailPreferences";
import { PasswordCard } from "./PasswordCard";
import { ProfileCard } from "./ProfileCard";
import { requireAccount, type Profile } from "../data";
import { isEmailConfigured } from "@/lib/email";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your details, password and email preferences.",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const { supabase, user } = await requireAccount();

  let profile: Profile | null = null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("account profile query failed:", error.message);
    } else {
      profile = (data ?? null) as Profile | null;
    }
  } catch {
    // Database unreachable — the cards fall back to empty defaults.
  }

  const email = user.email ?? "";

  /**
   * The single read of "can this shop send email", for this whole page.
   *
   * Server component, so it reads the `RESEND_API_KEY` / `EMAIL_FROM` secrets
   * directly — the same condition the Stripe webhook and /api/contact check.
   * The three cards below are client components and CANNOT read it: a
   * non-public env var is `undefined` in the browser, so they would render
   * "we send no email" after hydration over a server render that said the
   * opposite. It is threaded down as a plain boolean prop instead, which
   * serialises identically on both sides.
   */
  const canSendEmail = isEmailConfigured();

  return (
    <div>
      <h1 className="mb-1.5 text-3xl md:text-4xl">Settings</h1>
      {/* Kept deliberately free of any claim about what does or does not land
          in an inbox — that belongs in EmailPreferences, which is gated on the
          capability. What is true here in every configuration is only that
          these are the settings. */}
      <p className="mb-7 text-sm text-muted">
        Your details, sign-in and email preferences.
      </p>

      <div className="flex flex-col gap-6">
        <ProfileCard
          userId={user.id}
          canSendEmail={canSendEmail}
          email={email}
          firstName={profile?.first_name ?? ""}
          lastName={profile?.last_name ?? ""}
          phone={profile?.phone ?? ""}
        />

        <PasswordCard email={email} />

        {/* Every one of these defaults to off. A preference the customer never
            set must not read back as consent they never gave — the same rule
            that leaves the sign-up checkbox unticked. */}
        <EmailPreferences
          userId={user.id}
          canSendEmail={canSendEmail}
          marketingOptIn={profile?.marketing_opt_in ?? false}
          reviewReminders={profile?.review_reminders ?? false}
          restockAlerts={profile?.restock_alerts ?? false}
        />

        <DeleteAccountCard canSendEmail={canSendEmail} />
      </div>
    </div>
  );
}
