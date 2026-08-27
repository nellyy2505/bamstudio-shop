"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Icon, cx } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import { money, pluralise } from "@/lib/format";
import { BASKET_LIMITS } from "@/lib/config";
import { scoopArt, scoopVariantLabel } from "@/lib/scoop-line";
import type { ScoopTierListing } from "@/lib/queries";

/**
 * The buy control for one Lucky Scoop tier — quantity, and add to basket.
 *
 * Modelled on `app/product/[slug]/ProductBuy.tsx`, and the differences are all
 * consequences of one fact: A SCOOP IS SOLD BEFORE ITS CONTENTS ARE DECIDED.
 *
 *  - There is no colour and no attachment to pick. What the customer chooses is
 *    the THEME, and they chose that by opening this tier's page; the draw
 *    decides only which pieces come out of it (0007_lucky_scoop.sql explains
 *    why the theme is chosen and not drawn).
 *  - Nothing here computes a price. `tier.price_cents` is the row's own figure
 *    and it is displayed, never derived — and checkout recomputes it from the
 *    same row before charging anything, so what is on this screen is a preview
 *    of a server calculation rather than an input to one.
 *  - `availability.sellable` decides whether the control works at all, and when
 *    it does not, this says so in words. A dead button that gives no reason is
 *    the failure this component was told not to have.
 *
 * The prop contract is `{ tier: ScoopTierListing }` and it is fixed: the tier
 * page imports this as a default export and passes exactly what
 * `getScoopTierBySlug` returns.
 */
export default function ScoopBuy({ tier }: { tier: ScoopTierListing }) {
  const { add } = useCart();
  const router = useRouter();
  const capNoteId = useId();

  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [basketError, setBasketError] = useState<string | null>(null);

  const { sellable, scoopsAvailable } = tier.availability;

  /*
   * The upper bound on this stepper, and why the pool is part of it.
   *
   * `BASKET_LIMITS.maxLineQuantity` is what the shop will print in one order.
   * `scoopsAvailable` is how many whole scoops this pool could fill right now —
   * distinct products with at least one on the shelf, arithmetic in
   * `lib/scoop.ts`. Offering twenty when the bowl holds three is not a basket
   * limit problem: it is promising three bags that cannot be filled, on the one
   * product in this shop that cannot be printed to order after the fact.
   *
   * It is the smaller of the two, always. When the pool is what binds, the note
   * below says so — worded as the limit it is rather than as a stock count, so
   * this does not become another uncapped "only N left" claim.
   */
  const poolLimit = Math.max(0, scoopsAvailable);
  const maxQuantity = Math.min(BASKET_LIMITS.maxLineQuantity, poolLimit);
  const poolIsTheLimit = sellable && poolLimit < BASKET_LIMITS.maxLineQuantity;
  const atMax = quantity >= maxQuantity;

  // Nullable in the column and in the type. RLS never publishes an unpriced
  // tier and `sellable` is false for one, so this is belt and braces — but a
  // price is the one field where a fallback would be a lie, so there is none:
  // an absent price renders as no price at all.
  const price = tier.price_cents;
  const { tint } = scoopArt(tier.theme);

  function addToBasket(): boolean {
    if (!sellable || price === null) return false;

    const result = add({
      scoop_tier_id: tier.id,
      // The TIER's slug. The basket links a scoop line to /scoop/<slug>, and
      // this is the only place that slug enters the basket.
      slug: tier.slug,
      name: tier.name,
      art: scoopArt(tier.theme).art,
      tint,
      unit_price: price,
      quantity,
      piece_count: tier.piece_count,
      // A scoop is not made to a customer's spec. Marking it personalised would
      // put "can only be returned if faulty" on it, which is a returns claim
      // nobody has made about a scoop, and would suppress its stock movement
      // for a reason that has nothing to do with why its stock does not move.
      is_personalised: false,
    });

    if (result === "full") {
      setBasketError(
        `Your basket already holds ${BASKET_LIMITS.maxLines} different items, which is ` +
          "the most one order can carry. Check out what you have, or remove " +
          "something to make room.",
      );
      return false;
    }

    setBasketError(
      result === "clamped"
        ? `Your basket now holds ${BASKET_LIMITS.maxLineQuantity} of these — the most ` +
            "we can send in a single order."
        : null,
    );

    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    return true;
  }

  /*
   * NOT SELLABLE, SAID PLAINLY.
   *
   * `availability.blockers` are deliberately not printed. They are written for
   * the studio — "no packed weight", "not active" — and telling a shopper that
   * a tier has no packed weight is both meaningless to them and a peek into the
   * shop's own admin. The customer gets the one thing that is true of every
   * blocker from where they are standing: it is not buyable at the moment.
   *
   * The empty-bowl case is separated because it is the one with a genuine
   * "come back" in it, and because it is the only one a customer could plausibly
   * have caused by buying the last one thirty seconds ago.
   */
  if (!sellable || price === null) {
    const bowlIsEmpty = price !== null && tier.active && poolLimit < 1;

    return (
      <div className="rounded-2xl border border-line2 bg-surface p-5">
        <b className="text-[15px]">
          {bowlIsEmpty ? "The bowl is empty just now" : "Not on sale just now"}
        </b>
        <p className="mt-1.5 text-sm text-muted">
          {bowlIsEmpty
            ? `There aren't enough pieces left to fill a scoop of ${pluralise(tier.piece_count, "piece")}. ` +
              "It comes back as soon as the bowl is topped up. Nothing is charged and nothing is held for you in the meantime — the shop does not take orders it cannot fill."
            : "This scoop isn't available to buy at the moment. Have a look at the rest of the range in the meantime."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <b className="font-display text-2xl">{money(price)}</b>
        <span className="text-[13.5px] text-muted">
          {scoopVariantLabel(tier.piece_count)}, drawn at random
        </span>
      </div>

      <p className="mt-2 text-[13px] text-muted">
        {/* The pool is what makes "random" a describable promise rather than an
            unknown, and it is why the pool is public (0007). Stated as a count
            here; the tier page shows the pieces themselves. */}
        Every piece comes out of this scoop&apos;s own pool of{" "}
        {pluralise(tier.pool.length, "piece")}. You choose the theme — the draw
        chooses the pieces, after you order.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex h-12 items-center rounded-full border border-line2 bg-surface">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            /* `aria-disabled`, not `disabled`: a disabled button leaves the tab
               order the instant it is pressed, dropping a keyboard user's focus
               to the body mid-task. Same reasoning as ProductBuy. */
            aria-disabled={quantity <= 1 || undefined}
            aria-label="Decrease quantity"
            className={cx(
              "flex h-12 w-12 items-center justify-center",
              quantity <= 1 && "opacity-40",
            )}
          >
            <Icon name="minus" size={16} />
          </button>
          <span aria-live="polite" className="w-8 text-center font-bold">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
            aria-disabled={atMax || undefined}
            aria-describedby={atMax ? capNoteId : undefined}
            aria-label="Increase quantity"
            className={cx(
              "flex h-12 w-12 items-center justify-center",
              atMax && "opacity-40",
            )}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <Button
          onClick={() => {
            addToBasket();
          }}
          className="min-w-[200px] flex-1"
        >
          {added ? (
            <>
              <Icon name="check" size={18} strokeWidth={2.4} />
              Added to basket
            </>
          ) : (
            <>
              <Icon name="bag" size={18} />
              Add to basket · {money(price * quantity)}
            </>
          )}
        </Button>
      </div>

      {/* Only rendered at whichever cap actually bound, so nothing moves until
          one is reached. The pool wording says what the limit IS rather than
          how many are on a shelf — the shop has one uncapped "only N ready to
          ship" claim already and this is not going to be the second. */}
      {atMax ? (
        <p id={capNoteId} role="status" className="mt-3 text-xs text-muted">
          {poolIsTheLimit
            ? `${pluralise(maxQuantity, "scoop")} is all this bowl can fill at the moment.`
            : `${BASKET_LIMITS.maxLineQuantity} is the most we can send of one item in a single order. ` +
              "Need more? Get in touch and we'll sort it out."}
        </p>
      ) : null}

      {basketError ? (
        <p role="alert" className="mt-3 text-xs font-semibold text-danger">
          <span className="sr-only">Error: </span>
          {basketError}
        </p>
      ) : null}

      <Button
        variant="ghost"
        full
        className="mt-3"
        onClick={() => {
          if (addToBasket()) router.push("/cart");
        }}
      >
        Buy it now
      </Button>

      <p aria-live="polite" className="sr-only">
        {added ? `${tier.name} added to your basket.` : ""}
      </p>
    </div>
  );
}
