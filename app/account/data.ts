import { redirect } from "next/navigation";
import { isDatabaseConfigured } from "@/lib/queries";
import { createClient, getUser } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/types";

export type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  marketing_opt_in: boolean;
  review_reminders: boolean;
  restock_alerts: boolean;
};

export type SavedAddress = {
  id: string;
  label: string;
  first_name: string;
  last_name: string;
  line1: string;
  line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  phone: string | null;
  is_default: boolean;
};

/**
 * Every /account page needs the same signed-in pair. A missing session — or a
 * clone with no Supabase env vars — goes back to /login instead of throwing.
 */
export async function requireAccount() {
  let user = null;
  if (isDatabaseConfigured()) {
    try {
      user = await getUser();
    } catch {
      user = null;
    }
  }
  if (!user) redirect("/login");

  const supabase = await createClient();
  return { supabase, user };
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Awaiting payment",
  confirmed: "Confirmed",
  printing: "Printing",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<OrderStatus, "warn" | "good" | "neutral"> = {
  pending: "neutral",
  confirmed: "warn",
  printing: "warn",
  packed: "warn",
  shipped: "good",
  delivered: "good",
  cancelled: "neutral",
};

/** Supabase returns a to-one embed as an object, but types it as either. */
export function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
