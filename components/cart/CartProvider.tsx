"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartLine } from "@/lib/types";
import { SHIPPING } from "@/lib/config";

const STORAGE_KEY = "bamstudio.cart.v1";

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
  /** Set by the "added to basket" flow so the header can flash a confirmation. */
  lastAdded: string | null;
};

const CartContext = createContext<CartContextValue | null>(null);

function lineKey(line: Omit<CartLine, "key">): string {
  const custom = line.custom
    ? `${line.custom.collection_slug}:${line.custom.letters}:${line.custom.with_charm}`
    : "";
  return [line.product_id, line.colour ?? "", line.attachment_id ?? "", custom].join(
    "|",
  );
}

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

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  // Load once on mount. Stored data is untrusted — validate every line.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setLines(parsed.filter(isCartLine));
      }
    } catch {
      // Corrupt or unavailable storage: start empty rather than crash.
    }
    setReady(true);
  }, []);

  // Persist after every change (but not before the initial read).
  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Private mode / quota — the cart still works for this page view.
    }
  }, [lines, ready]);

  const add = useCallback((incoming: Omit<CartLine, "key"> & { key?: string }) => {
    const key = incoming.key ?? lineKey(incoming);
    const line: CartLine = { ...incoming, key };
    setLines((current) => {
      const existing = current.find((l) => l.key === key);
      if (existing) {
        return current.map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + line.quantity } : l,
        );
      }
      return [...current, line];
    });
    setLastAdded(key);
  }, []);

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) =>
      quantity <= 0
        ? current.filter((l) => l.key !== key)
        : current.map((l) => (l.key === key ? { ...l, quantity } : l)),
    );
  }, []);

  const remove = useCallback((key: string) => {
    setLines((current) => current.filter((l) => l.key !== key));
  }, []);

  const clear = useCallback(() => setLines([]), []);

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
