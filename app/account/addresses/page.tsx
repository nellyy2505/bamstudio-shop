import type { Metadata } from "next";
import { AddressManager } from "./AddressManager";
import { requireAccount, type SavedAddress } from "../data";

export const metadata: Metadata = {
  title: "Your addresses",
  description: "An address book you can copy from at checkout.",
  robots: { index: false, follow: false },
};

// TODO: actually prefill checkout. Stripe collects the delivery address from
// scratch (`shipping_address_collection` in app/api/checkout/route.ts), so
// nothing saved here reaches it. Prefilling means creating a Stripe Customer
// for the shopper, keeping its `shipping` in step with the default address
// below, and passing `customer` on the Checkout Session — until that lands,
// the copy on this page must not promise a filled-in checkout.

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
        An address book for the places you post to most, so you can copy one
        across instead of digging out a postcode. Checkout still asks for the
        delivery address itself — these are not filled in for you yet.
      </p>

      <AddressManager initial={addresses} userId={user.id} />
    </div>
  );
}
