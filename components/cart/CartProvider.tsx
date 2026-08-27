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

/* ------------------------------------------------------------ line shapes */

/**
 * A basket now holds two kinds of line, and this is where the difference is
 * declared once so that no consumer has to guess.
 *
 * THE PROBLEM. A Lucky Scoop is sold before its contents are decided, so it has
 * no product row: no `product_id`, no colour, no attachment, no per-product
 * price. `order_items` enforces that as a CHECK — `scoop_tier_id` and
 * `product_id` are mutually exclusive (0007_lucky_scoop.sql) — and the reason
 * is not tidiness. A product id on a scoop line is what would take a charm off
 * the shelf for a scoop nobody has drawn yet.
 *
 * THE SHAPE, AND WHY THIS ONE. A UNION, not one widened type with an optional
 * `scoop_tier_id` hanging off it. A widened type would still carry
 * `product_id: string`, so a scoop line would have to put *something* there —
 * and every "something" available is either a real id the checkout would price
 * and decrement, or an empty string that reads as a product to every
 * `if (line.product_id)` in the codebase. Making the two mutually exclusive in
 * the type puts the schema's CHECK constraint in front of the compiler instead:
 * `app/cart/CartView.tsx` cannot post a basket to checkout without deciding,
 * per line, which of the two bodies it is building, because TypeScript refuses
 * to read `product_id` off a `BasketLine` until it has been narrowed.
 *
 * `isScoopLine` is that narrowing, and it is the only way to ask.
 */

/**
 * An ordinary product line — exactly `CartLine` as `lib/types.ts` describes it.
 * The `never` is what makes the union discriminable from both sides.
 */
export type ProductBasketLine = CartLine & { scoop_tier_id?: never };

/**
 * A Lucky Scoop line: a tier and a quantity, and deliberately nothing that
 * looks like a product.
 *
 * `slug` is the TIER's slug (`/scoop/<slug>`), not a product's — the cart links
 * a scoop line to its tier page, so the two live in the same field and the row
 * component branches on the kind rather than on the presence of a field.
 *
 * `piece_count` is copied into the basket rather than looked up when the basket
 * is rendered, for the reason `unit_price` is: it is what this customer was
 * promised, and the studio may edit the tier while the basket sits in a browser
 * for a fortnight. Checkout re-reads BOTH from the tier row before charging
 * anything, so a stale copy can only ever be wrong on a page, never on a bill.
 */
export type ScoopBasketLine = Omit<
  CartLine,
  | "product_id"
  | "colour"
  | "attachment_id"
  | "attachment_label"
  | "custom"
  | "personalisation_text"
> & {
  product_id?: never;
  /** `scoop_tiers.id`. Present on a scoop line and on nothing else. */
  scoop_tier_id: string;
  /** How many pieces the tier promised when it went in the basket. */
  piece_count: number;
};

export type BasketLine = ProductBasketLine | ScoopBasketLine;

/*
 * A line as a caller supplies it: everything but the key, which `add` derives.
 *
 * Spelled out one member at a time rather than as `Omit<BasketLine, "key">`,
 * because `Omit` over a union collapses it to the keys the members SHARE —
 * which here throws away `product_id`, `scoop_tier_id`, `colour`, `custom` and
 * everything else that tells the two apart. The result is a type nothing can be
 * assigned to and nothing can be read off. Keeping the union at the top level
 * keeps both shapes whole, so `add()` still checks a product line against the
 * product shape and a scoop line against the scoop one.
 */
export type NewProductBasketLine = Omit<ProductBasketLine, "key"> & {
  key?: string;
};
export type NewScoopBasketLine = Omit<ScoopBasketLine, "key"> & {
  key?: string;
};
export type NewBasketLine = NewProductBasketLine | NewScoopBasketLine;

/**
 * The one way to ask which kind of line this is.
 *
 * Both directions are exported. `!isScoopLine(line)` does not narrow inside a
 * `.filter()` callback — TypeScript only propagates a guard when the predicate
 * IS the guard — so a caller splitting a basket in two would be left with
 * `BasketLine[]` on the product side and would reach for a cast. Two guards,
 * no casts.
 */
export function isScoopLine(line: BasketLine): line is ScoopBasketLine {
  return typeof line.scoop_tier_id === "string" && line.scoop_tier_id !== "";
}

export function isProductLine(line: BasketLine): line is ProductBasketLine {
  return !isScoopLine(line);
}

/**
 * The same question about a line that does not have its key yet. One extra
 * function rather than one generic one: a type predicate that has to be read
 * twice to work out what it narrows is worse than two that say so plainly.
 */
function isNewScoopLine(line: NewBasketLine): line is NewScoopBasketLine {
  return typeof line.scoop_tier_id === "string" && line.scoop_tier_id !== "";
}

/** The fields both kinds must carry to be worth keeping, checked once. */
function hasCommonFields(line: Partial<CartLine>): boolean {
  return (
    typeof line.key === "string" &&
    typeof line.unit_price === "number" &&
    Number.isFinite(line.unit_price) &&
    typeof line.quantity === "number" &&
    line.quantity > 0
  );
}

/**
 * Is this stored value a basket line we can still use?
 *
 * A BASKET SAVED BEFORE SCOOPS EXISTED MUST STILL LOAD, and that is why this
 * reads the way it does. Every stored line predating this change is a product
 * line carrying `product_id` and no `scoop_tier_id`, so it takes the first
 * branch unchanged; nothing new is required of it, and the storage key is
 * deliberately still `bamstudio.cart.v1`. Bumping the key would have been the
 * easy way to avoid thinking about this, and it would have silently emptied the
 * basket of every shopper mid-purchase at the moment of deploy.
 *
 * The scoop branch is the mirror: a tier id and a piece count, and no
 * `product_id`. A stored line carrying BOTH is not a line either half of this
 * shop can price — the database would refuse it — so it is dropped rather than
 * repaired into one or the other, which would be a guess at what somebody meant.
 */
function isBasketLine(value: unknown): value is BasketLine {
  if (!value || typeof value !== "object") return false;
  // Read as an untyped record, deliberately. This is JSON out of the browser's
  // own storage and it may be anything at all — including a line carrying both
  // `product_id` and `scoop_tier_id`, which is a shape NEITHER member of the
  // union describes and which the whole point of this function is to reject.
  // Casting to the union first would have TypeScript collapse the two `never`
  // discriminants and hide exactly the case being tested for.
  const line = value as Record<string, unknown>;
  if (!hasCommonFields(line as Partial<CartLine>)) return false;

  const hasProduct =
    typeof line.product_id === "string" && line.product_id !== "";
  const hasTier =
    typeof line.scoop_tier_id === "string" && line.scoop_tier_id !== "";

  // Mutually exclusive, exactly as order_items_scoop_or_product_check is.
  if (hasProduct === hasTier) return false;

  if (hasTier) {
    return (
      typeof line.piece_count === "number" &&
      Number.isFinite(line.piece_count) &&
      line.piece_count > 0
    );
  }
  return true;
}

const EMPTY: BasketLine[] = [];
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
const cartStore = createLocalStore<BasketLine[]>(STORAGE_KEY, EMPTY, (value) =>
  Array.isArray(value)
    ? value
        .filter(isBasketLine)
        .slice(0, BASKET_LIMITS.maxLines)
        .map((line) =>
          line.quantity === clampQuantity(line.quantity)
            ? line
            : { ...line, quantity: clampQuantity(line.quantity) },
        )
    : EMPTY,
);

type CartContextValue = {
  lines: BasketLine[];
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
  add: (line: NewBasketLine) => AddToCartResult;
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
function lineKey(line: NewBasketLine): string {
  // A scoop has no colour, no finding and no personalisation — two scoops of
  // the same tier ARE the same thing to buy, however differently they turn out,
  // because what was bought is the tier. They merge into one line of quantity 2,
  // which is also what `scoop_packs.pack_index` expects: two draws, two videos,
  // two bags, one line.
  //
  // Prefixed so a tier id can never collide with a product id in this
  // namespace: they come from different tables and nothing makes a uuid from
  // one distinguishable from a uuid from the other. The product branch below is
  // deliberately UNCHANGED — a basket sitting in a browser holds keys built by
  // the old expression, and re-spelling them would stop a re-added product from
  // merging with the line already there and quietly duplicate it.
  if (isNewScoopLine(line)) return `scoop|${line.scoop_tier_id}`;

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
    (incoming: NewBasketLine): AddToCartResult => {
      const key = incoming.key ?? lineKey(incoming);
      const line = { ...incoming, key } as BasketLine;
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
