"use client";

import { useEffect, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const STORAGE_KEY = "bamstudio.favourites.v1";

function readLocal(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Hearts a product. Signed-in shoppers get a row in `favourites`;
 * guests get localStorage, which merges on their next sign-in.
 */
export function FavouriteButton({
  productId,
  name,
  className = "absolute top-2.5 right-2.5",
}: {
  productId: string;
  name: string;
  className?: string;
}) {
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOn(readLocal().includes(productId));
    setReady(true);
  }, [productId]);

  async function toggle() {
    const next = !on;
    setOn(next);

    const current = readLocal();
    const updated = next
      ? [...new Set([...current, productId])]
      : current.filter((id) => id !== productId);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Storage unavailable — the server write below still counts.
    }

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
      // Not configured or offline: the local list keeps the intent.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={ready ? on : undefined}
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
