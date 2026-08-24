import type { Metadata } from "next";
import { DeleteAccountCard } from "./DeleteAccountCard";
import { EmailPreferences } from "./EmailPreferences";
import { PasswordCard } from "./PasswordCard";
import { ProfileCard } from "./ProfileCard";
import { requireAccount, type Profile } from "../data";

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

  return (
    <div>
      <h1 className="mb-1.5 text-3xl md:text-4xl">Settings</h1>
      <p className="mb-7 text-sm text-muted">
        Your details, sign-in and what lands in your inbox.
      </p>

      <div className="flex flex-col gap-6">
        <ProfileCard
          userId={user.id}
          email={email}
          firstName={profile?.first_name ?? ""}
          lastName={profile?.last_name ?? ""}
          phone={profile?.phone ?? ""}
        />

        <PasswordCard email={email} />

        <EmailPreferences
          userId={user.id}
          marketingOptIn={profile?.marketing_opt_in ?? false}
          reviewReminders={profile?.review_reminders ?? true}
          restockAlerts={profile?.restock_alerts ?? false}
        />

        <DeleteAccountCard />
      </div>
    </div>
  );
}
