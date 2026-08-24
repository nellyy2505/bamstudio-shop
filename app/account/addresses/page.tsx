import type { Metadata } from "next";
import { AddressManager } from "./AddressManager";
import { requireAccount, type SavedAddress } from "../data";

export const metadata: Metadata = {
  title: "Your addresses",
  description: "Saved delivery addresses for a faster checkout.",
  robots: { index: false, follow: false },
};

export default async function AddressesPage() {
  const { supabase, user } = await requireAccount();

  let addresses: SavedAddress[] = [];
  try {
    const { data, error } = await supabase
      .from("addresses")
      .select("*")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("account addresses query failed:", error.message);
    } else {
      addresses = (data ?? []) as SavedAddress[];
    }
  } catch {
    // Database unreachable — the manager starts from an empty list.
  }

  return (
    <div>
      <h1 className="mb-1.5 text-3xl md:text-4xl">Your addresses</h1>
      <p className="mb-7 text-sm text-muted">
        Save the places you post to most — your default one is filled in at
        checkout.
      </p>

      <AddressManager initial={addresses} userId={user.id} />
    </div>
  );
}
