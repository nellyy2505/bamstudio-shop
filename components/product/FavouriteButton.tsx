"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
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

/**
 * The local store alone can't tell you what an account has hearted on another
 * device, so every heart on /shop would render empty for a shopper whose list
 * lives in the database. Reconcile the two once per page load.
 *
 * Memoised at module scope on purpose: /shop renders dozens of buttons and
 * they must share one round trip, not one each.
 */
let reconciliation: Promise<void> | null = null;

/** Set when a guest's local-only ids were pushed up, so a page can re-fetch. */
let guestListMigrated = false;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function reconcileFavourites(): Promise<void> {
  // Signed-out visitors never reach Supabase — the local list is the whole
  // truth for them, exactly as before.
  if (!isSupabaseConfigured()) return Promise.resolve();

  reconciliation ??= (async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("favourites")
        .select("product_id")
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);

      const remote = ((data ?? []) as { product_id: string }[]).map(
        (row) => row.product_id,
      );
      // hydrate(), not getSnapshot(): /account/favourites mounts the sync with
      // no heart on the page, so nothing has subscribed and the cache would
      // still hold the initial empty list — losing the guest ids to migrate.
      const local = favouritesStore.hydrate();

      // Union, not replace: anything hearted while signed out has to survive
      // signing in rather than being wiped by the account's list.
      const merged = [...new Set([...remote, ...local])];

      const remoteIds = new Set(remote);
      const localOnly = local.filter((id) => !remoteIds.has(id));
      if (localOnly.length > 0) {
        const { error: upsertError } = await supabase
          .from("favourites")
          .upsert(
            localOnly.map((id) => ({ user_id: user.id, product_id: id })),
          );
        if (!upsertError) guestListMigrated = true;
      }

      if (!sameIds(merged, local)) favouritesStore.set(merged);
    } catch {
      // Offline, or the table is unreachable. The local list still renders.
    }
  })();

  return reconciliation;
}

/** Reads the migration flag once, so only the first asker re-fetches. */
function takeGuestMigration(): boolean {
  const migrated = guestListMigrated;
  guestListMigrated = false;
  return migrated;
}

/**
 * Mount on a page that renders favourites from the database but has no hearts
 * of its own, so a guest list that just moved up is reflected immediately
 * rather than one navigation late.
 */
export function FavouritesSync() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    void reconcileFavourites().then(() => {
      if (alive && takeGuestMigration()) router.refresh();
    });
    return () => {
      alive = false;
    };
  }, [router]);

  return null;
}

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

  // Kicks the shared, once-per-load reconcile. The store — not setState —
  // carries the result, so nothing here sets state from an effect.
  useEffect(() => {
    void reconcileFavourites();
  }, []);

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
