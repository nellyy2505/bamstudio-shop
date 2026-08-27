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
import { BASKET_LIMITS, SHIPPING } from "@/lib/config";
import { createLocalStore } from "@/lib/local-store";

const STORAGE_KEY = "bamstudio.cart.v1";

/**
 * What a basket did with an item it was asked to take.
 *
 * The caps themselves are BASKET_LIMITS in lib/config.ts — a business rule the
 * two API routes enforce as well. This type is only the shape of the answer
 * `add()` gives back, so it lives with `add()`.
 */
export type AddToCartResult =
  /** Taken in full. */
  | "added"
  /** Taken, but capped at `maxLineQuantity` — fewer than asked for. */
  | "clamped"
  /** Refused: the basket already holds `maxLines` different items. */
  | "full";

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

/** Whole units only, never above the cap, never below one. */
function clampQuantity(quantity: number): number {
  return Math.min(
    BASKET_LIMITS.maxLineQuantity,
    Math.max(1, Math.floor(quantity)),
  );
}

/**
 * Stored carts are untrusted input — drop anything malformed, and bring what
 * survives inside the caps checkout will accept.
 *
 * The clamp here is not belt-and-braces. A basket saved before the caps were
 * enforced, or one edited in devtools, is read back through this function, and
 * a cart that loads over the limit is precisely the basket checkout refuses
 * with a blanket "Invalid basket." Enforcing on the way in means every reader
 * downstream can take the invariant for granted.
 */
const cartStore = createLocalStore<CartLine[]>(STORAGE_KEY, EMPTY, (value) =>
  Array.isArray(value)
    ? value
        .filter(isCartLine)
        .slice(0, BASKET_LIMITS.maxLines)
        .map((line) =>
          line.quantity === clampQuantity(line.quantity)
            ? line
            : { ...line, quantity: clampQuantity(line.quantity) },
        )
    : EMPTY,
);

type CartContextValue = {
  lines: CartLine[];
  /** False until the stored cart has been read, so SSR and first paint agree. */
  ready: boolean;
  count: number;
  subtotal: number;
  freeShippingRemaining: number;
  /**
   * Takes what it can and says what it took. The caps are the server's, so a
   * caller that ignores the answer still cannot build a basket checkout will
   * refuse — but a caller that shows it can tell the customer why they got
   * fewer than they asked for.
   */
  add: (line: Omit<CartLine, "key"> & { key?: string }) => AddToCartResult;
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

  const add = useCallback(
    (incoming: Omit<CartLine, "key"> & { key?: string }): AddToCartResult => {
      const key = incoming.key ?? lineKey(incoming);
      const line: CartLine = { ...incoming, key };
      // Held in an object rather than a `let` so the outcome survives the
      // callback: TypeScript narrows a `let` to its initialiser and cannot see
      // an assignment made inside a function it does not inline.
      const outcome: { value: AddToCartResult } = { value: "added" };

      // `cartStore.set` runs its updater synchronously and exactly once, so the
      // outcome can be read straight back out below.
      cartStore.set((current) => {
        const existing = current.find((l) => l.key === key);

        if (existing) {
          const wanted = existing.quantity + line.quantity;
          const capped = clampQuantity(wanted);
          if (capped < wanted) outcome.value = "clamped";
          if (capped === existing.quantity) return current;
          return current.map((l) =>
            l.key === key ? { ...l, quantity: capped } : l,
          );
        }

        // A new line, and the basket is already at the line cap. Refuse rather
        // than add a forty-first: checkout rejects the whole basket over one
        // bad line, so the forty-first would take the other forty down with it.
        if (current.length >= BASKET_LIMITS.maxLines) {
          outcome.value = "full";
          return current;
        }

        const capped = clampQuantity(line.quantity);
        if (capped < line.quantity) outcome.value = "clamped";
        return [...current, { ...line, quantity: capped }];
      });

      // Nothing was added, so nothing should flash "added to basket".
      if (outcome.value !== "full") setLastAdded(key);
      return outcome.value;
    },
    [],
  );

  const setQuantity = useCallback((key: string, quantity: number) => {
    cartStore.set((current) =>
      quantity <= 0
        ? current.filter((l) => l.key !== key)
        : current.map((l) =>
            l.key === key ? { ...l, quantity: clampQuantity(quantity) } : l,
          ),
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
