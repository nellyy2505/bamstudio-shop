import { AccountNav } from "./AccountNav";
import { SignOutButton } from "./SignOutButton";
import { requireAccount, type Profile } from "./data";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user } = await requireAccount();

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (data ?? null) as Profile | null;
  const email = user.email ?? "";
  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    email.split("@")[0] ||
    "Your account";
  const initial = (profile?.first_name || email || "?").charAt(0).toUpperCase();

  return (
    <div className="wrap grid items-start gap-8 pt-8 pb-16 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
      <aside className="card p-5 lg:sticky lg:top-28">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-lilac font-display text-lg font-semibold"
          >
            {initial}
          </span>
          <div className="min-w-0">
            <b className="block truncate font-display text-[15.5px]">{name}</b>
            <span className="block truncate text-[13px] text-muted">
              {email}
            </span>
          </div>
        </div>

        <hr className="my-4 border-line" />

        <AccountNav />

        <hr className="my-4 border-line" />

        <SignOutButton />
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
