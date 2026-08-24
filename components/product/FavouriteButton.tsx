"use client";

import { useSyncExternalStore } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { createLocalStore } from "@/lib/local-store";

const STORAGE_KEY = "bamstudio.favourites.v1";
const EMPTY: string[] = [];

/**
 * Guests keep favourites in localStorage; signed-in shoppers also get a row
 * in `favourites`, so the list follows them between devices.
 */
const favouritesStore = createLocalStore<string[]>(STORAGE_KEY, EMPTY, (value) =>
  Array.isArray(value) ? value.filter((id) => typeof id === "string") : EMPTY,
);

export function FavouriteButton({
  productId,
  name,
  className = "absolute top-2.5 right-2.5",
}: {
  productId: string;
  name: string;
  className?: string;
}) {
  const favourites = useSyncExternalStore(
    favouritesStore.subscribe,
    favouritesStore.getSnapshot,
    favouritesStore.getServerSnapshot,
  );

  const on = favourites.includes(productId);

  async function toggle() {
    const next = !on;
    favouritesStore.set((current) =>
      next
        ? [...new Set([...current, productId])]
        : current.filter((id) => id !== productId),
    );

    if (!isSupabaseConfigured()) return;

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      if (next) {
        await supabase
          .from("favourites")
          .upsert({ user_id: user.id, product_id: productId });
      } else {
        await supabase
          .from("favourites")
          .delete()
          .eq("user_id", user.id)
          .eq("product_id", productId);
      }
    } catch {
      // Offline or misconfigured: the local list still records the intent.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`}
      className={`${className} flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-sm transition-colors hover:text-accent`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={on ? "var(--color-accent)" : "none"}
        stroke={on ? "var(--color-accent)" : "currentColor"}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20S4 14.7 4 9.5A4.5 4.5 0 0 1 12 6.8a4.5 4.5 0 0 1 8 2.7C20 14.7 12 20 12 20Z" />
      </svg>
    </button>
  );
}
