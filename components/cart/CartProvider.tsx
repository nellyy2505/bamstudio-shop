"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { CartLine } from "@/lib/types";
import { SHIPPING } from "@/lib/config";
import { createLocalStore } from "@/lib/local-store";

const STORAGE_KEY = "bamstudio.cart.v1";

function isCartLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<CartLine>;
  return (
    typeof line.key === "string" &&
    typeof line.product_id === "string" &&
    typeof line.unit_price === "number" &&
    Number.isFinite(line.unit_price) &&
    typeof line.quantity === "number" &&
    line.quantity > 0
  );
}

const EMPTY: CartLine[] = [];
const SERVER_NOT_READY = () => false;

/** Stored carts are untrusted input — drop anything malformed. */
const cartStore = createLocalStore<CartLine[]>(STORAGE_KEY, EMPTY, (value) =>
  Array.isArray(value) ? value.filter(isCartLine) : EMPTY,
);

type CartContextValue = {
  lines: CartLine[];
  /** False until the stored cart has been read, so SSR and first paint agree. */
  ready: boolean;
  count: number;
  subtotal: number;
  freeShippingRemaining: number;
  add: (line: Omit<CartLine, "key"> & { key?: string }) => void;
  setQuantity: (key: string, quantity: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  lastAdded: string | null;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Two basket lines merge only when they are genuinely the same thing to print.
 * The personalisation has to be part of that: without it, a bowl for "Mochi"
 * and one for "Luna" collapse into quantity 2 of "Mochi" — two bowls charged
 * and both printed with the wrong name.
 */
function lineKey(line: Omit<CartLine, "key">): string {
  const custom = line.custom
    ? `${line.custom.collection_slug}:${line.custom.letters}:${line.custom.with_charm}`
    : "";
  return [
    line.product_id,
    line.colour ?? "",
    line.attachment_id ?? "",
    custom,
    line.personalisation_text ?? "",
  ].join("|");
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const lines = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.getSnapshot,
    cartStore.getServerSnapshot,
  );

  // Both reads share one subscription; `hydrated` flips during subscribe, and
  // React's post-subscribe consistency check picks the change up.
  const ready = useSyncExternalStore(
    cartStore.subscribe,
    cartStore.isHydrated,
    SERVER_NOT_READY,
  );

  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const add = useCallback((incoming: Omit<CartLine, "key"> & { key?: string }) => {
    const key = incoming.key ?? lineKey(incoming);
    const line: CartLine = { ...incoming, key };
    cartStore.set((current) => {
      const existing = current.find((l) => l.key === key);
      return existing
        ? current.map((l) =>
            l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l,
          )
        : [...current, line];
    });
    setLastAdded(key);
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    cartStore.set((current) =>
      quantity <= 0
        ? current.filter((l) => l.key !== key)
        : current.map((l) => (l.key === key ? { ...l, quantity } : l)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    cartStore.set((current) => current.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => cartStore.set(EMPTY), []);

  const value = useMemo<CartContextValue>(() => {
    const subtotal = lines.reduce(
      (sum, l) => sum + l.unit_price * l.quantity,
      0,
    );
    return {
      lines,
      ready,
      count: lines.reduce((sum, l) => sum + l.quantity, 0),
      subtotal,
      freeShippingRemaining: Math.max(0, SHIPPING.freeThreshold - subtotal),
      add,
      setQuantity,
      remove,
      clear,
      lastAdded,
    };
  }, [lines, ready, add, setQuantity, remove, clear, lastAdded]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
