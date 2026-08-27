"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ProductArt } from "@/components/ProductArt";
import { ProductGrid } from "@/components/product/ProductCard";
import {
  Alert,
  Button,
  ButtonLink,
  Icon,
  Pill,
  SectionHead,
  cx,
} from "@/components/ui";
import {
  isProductLine,
  isScoopLine,
  useCart,
  type BasketLine,
} from "@/components/cart/CartProvider";
import {
  BASKET_LIMITS,
  isFreeShipping,
  PAYMENT_BADGES,
  PRINT_LEAD_TIME,
  SHIPPING,
  SHOP,
  transitLabel,
  transitRangeLabel,
} from "@/lib/config";
import type { QuotableLine } from "@/lib/shipping/lines";
import { scoopVariantLabel } from "@/lib/scoop-line";
import { gstComponent, money, pluralise } from "@/lib/format";
import type { Product, Tint } from "@/lib/types";

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

/** One method's postage, as `POST /api/shipping/quote` returns it. */
type MethodQuote = {
  amountCents: number;
  tracked: boolean;
  weightGrams: number;
  estimated: boolean;
};

/**
 * Postage, or a placeholder — never a guess.
 *
 * `null` means the quote has not arrived, and it must render as words rather
 * than as a number. Falling back to 0, or to a flat rate, would put a figure in
 * front of a customer that checkout will not charge; showing that the amount is
 * still being worked out is honest and self-correcting.
 */
function postageText(cents: number | null): string {
  return cents === null ? "Calculated at checkout" : money(cents);
}

function LineRow({ line }: { line: BasketLine }) {
  const { setQuantity, remove } = useCart();
  // Client component, so a hook id is safe and is stable across renders. A
  // line's `key` is built from colour and free-text personalisation and is not
  // usable as a DOM id.
  const capNoteId = useId();

  const atMax = line.quantity >= BASKET_LIMITS.maxLineQuantity;

  const scoop = isScoopLine(line);
  // A scoop's slug is its tier's, and tiers live under /scoop, not /product.
  // Both are the row's own `slug`; only the prefix differs.
  const href = scoop ? `/scoop/${line.slug}` : `/product/${line.slug}`;

  // What the customer bought, in one line under the name. For a scoop that is
  // the promise and nothing else — "5 pieces" — because at this moment nobody,
  // the studio included, knows what will be in it.
  const variant = scoop
    ? scoopVariantLabel(line.piece_count)
    : [
        line.colour,
        line.attachment_label,
        line.custom
          ? `${line.custom.collection_name} · ${line.custom.letters}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <div className="flex gap-4 border-b border-line py-5 sm:gap-5">
      <Link
        href={href}
        className={cx(
          "flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl sm:h-24 sm:w-24",
          TINT_BG[line.tint],
        )}
      >
        <ProductArt art={line.art} size={64} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-4">
          <div className="min-w-0">
            <Link href={href} className="font-bold hover:text-accent-dark">
              {line.name}
            </Link>
            {variant ? (
              <p className="mt-0.5 text-[13px] text-muted">{variant}</p>
            ) : null}
            {/* Said in the basket rather than only on the tier page, because
                this is the last screen before payment and "you do not choose
                what is in it" is a term of the sale. No claim about a video:
                whether every scoop is filmed is the owner's decision and is not
                settled (0007_lucky_scoop.sql), and a promise made here would be
                one the studio had never agreed to. */}
            {scoop ? (
              <p className="mt-1 text-xs text-faint">
                Drawn by hand after you order — the pieces are a surprise
              </p>
            ) : null}
            {!scoop && line.is_personalised ? (
              <p className="mt-1 text-xs text-faint">
                Personalised — can only be returned if faulty
              </p>
            ) : null}
          </div>
          <b className="shrink-0">{money(line.unit_price * line.quantity)}</b>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex h-11 items-center rounded-full border border-line2 bg-surface">
            <button
              type="button"
              onClick={() => setQuantity(line.key, line.quantity - 1)}
              /* At one, this button empties the line rather than decreasing it.
                 Saying "decrease" there describes something the click does not
                 do, and removal is not an action to take by surprise. */
              aria-label={
                line.quantity <= 1
                  ? `Remove ${line.name} from your basket`
                  : `Decrease quantity of ${line.name}`
              }
              className="flex h-11 w-11 items-center justify-center"
            >
              <Icon name="minus" size={15} />
            </button>
            <span
              aria-live="polite"
              className="w-8 text-center text-[15px] font-bold"
            >
              {line.quantity}
            </span>
            <button
              type="button"
              /* No-op at the cap rather than `disabled`. A disabled button
                 drops out of the tab order the moment it is pressed, so the
                 keyboard user who reached the limit loses focus to the body
                 and never hears why nothing happened. `aria-disabled` keeps it
                 focusable and points at the note that says what the limit is. */
              onClick={() => {
                if (!atMax) setQuantity(line.key, line.quantity + 1);
              }}
              aria-disabled={atMax || undefined}
              aria-describedby={atMax ? capNoteId : undefined}
              aria-label={`Increase quantity of ${line.name}`}
              className={cx(
                "flex h-11 w-11 items-center justify-center",
                atMax && "opacity-40",
              )}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => remove(line.key)}
            /* min-h-11 gives this a 44px tap target on a phone without moving
               anything: the row is already 44px tall because of the stepper. */
            className="flex min-h-11 items-center gap-1.5 text-[13px] text-muted hover:text-danger"
          >
            <Icon name="trash" size={15} />
            Remove
            <span className="sr-only"> {line.name}</span>
          </button>
        </div>

        {/* Only rendered at the cap, so nothing moves until it is reached.
            `role="status"` announces it on arrival; `aria-describedby` above
            reads it again to anyone who tabs back onto the + button. */}
        {atMax ? (
          <p id={capNoteId} role="status" className="mt-2 text-xs text-muted">
            {BASKET_LIMITS.maxLineQuantity} is the most we can print of one item in a
            single order. Need more? Get in touch and we&apos;ll sort it out.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CartView({ suggestions }: { suggestions: Product[] }) {
  const { lines, ready, count, subtotal, freeShippingRemaining } = useCart();
  const params = useSearchParams();
  const cancelled = params.get("cancelled") === "1";

  const [method, setMethod] = useState<"standard" | "express">("standard");
  const [giftNote, setGiftNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The last quote received, tagged with the basket it was for.
   *
   * Held together rather than as a bare quote plus a "stale" flag so that
   * "which basket is this price for" is one value and cannot get out of step.
   * `quotes` below is derived from it: a quote whose signature no longer
   * matches the basket is simply not a quote for this basket, so the summary
   * falls back to "calculated at checkout" without anything having to
   * remember to clear it.
   */
  const [quoted, setQuoted] = useState<{
    signature: string;
    quotes: Record<string, MethodQuote> | null;
  } | null>(null);

  /*
   * Postage is quoted by the server from the server's own product rows. The
   * browser sends slugs and quantities and nothing else — it never sends a
   * weight, and the price it gets back is for display only: checkout re-quotes
   * through the same `quoteBasket()` on the same rows, so this is a preview of
   * that calculation rather than an input to it. A basket that could name its
   * own weight could name its own postage.
   *
   * Serialised rather than passed as an array so the effect re-runs on a
   * genuine basket change and not on every render's new array identity.
   */
  /*
   * A scoop has no product row and therefore no weight of its own; the TIER
   * carries a worst-case packed weight, which is a different table and a
   * different lookup on the server. So the two kinds of line are sent to the
   * quote route in two arrays rather than one — the server can then load each
   * from the table it actually lives in, and neither kind can be silently
   * resolved against the wrong one. (`scoop_tiers.slug` and `products.slug` are
   * separate unique indexes; nothing stops the same string existing in both.)
   */
  const basketSignature = JSON.stringify({
    lines: lines.filter(isProductLine).map((line) => ({
      slug: line.slug,
      quantity: line.quantity,
      attachment_id: line.attachment_id ?? null,
      custom: line.custom
        ? { letters: line.custom.letters, with_charm: line.custom.with_charm }
        : null,
    })),
    scoop_lines: lines
      .filter(isScoopLine)
      .map((line) => ({ slug: line.slug, quantity: line.quantity })),
  });

  useEffect(() => {
    const payload = JSON.parse(basketSignature) as {
      lines: QuotableLine[];
      scoop_lines: { slug: string; quantity: number }[];
    };
    if (payload.lines.length + payload.scoop_lines.length === 0) return;

    let stale = false;

    (async () => {
      try {
        const res = await fetch("/api/shipping/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        // A basket edited twice in quick succession must not let the older
        // response land last and price the newer basket.
        if (stale) return;
        setQuoted({
          signature: basketSignature,
          quotes: res.ok && data?.quotes ? data.quotes : null,
        });
      } catch {
        // The route cannot really fail — quoteBasket() does not throw and falls
        // back to a table that needs no network — so this is a dead browser
        // connection. Recording null keeps the words instead of a wrong price.
        if (!stale) setQuoted({ signature: basketSignature, quotes: null });
      }
    })();

    return () => {
      stale = true;
    };
  }, [basketSignature]);

  // Derived, not stored: a quote for a basket the customer has since changed is
  // not a quote for this basket.
  const quotes =
    quoted?.signature === basketSignature ? quoted.quotes : null;
  const selectedQuote = quotes?.[method] ?? null;
  /**
   * §0.10: the free rate applies to standard post only — express is billed at
   * every subtotal — yet the basket once said "Free shipping unlocked" off the
   * subtotal alone while charging express. A price claim must never be derived
   * from the subtotal on its own, so ask isFreeShipping() which method actually
   * goes free rather than naming one here, and qualify the message with the
   * method the customer has selected.
   */
  const selectedIsFree = isFreeShipping(subtotal, method);
  /** null = not quoted yet. Never 0, which would read to a customer as free. */
  const shipping: number | null = selectedIsFree
    ? 0
    : (selectedQuote?.amountCents ?? null);
  const total: number | null = shipping === null ? null : subtotal + shipping;

  const freeRateMethod = SHIPPING.methods.find((option) =>
    isFreeShipping(SHIPPING.freeThreshold, option.id),
  );
  const freeRateLabel = freeRateMethod?.label.toLowerCase() ?? "";
  const freeRateReached =
    freeRateMethod !== undefined && isFreeShipping(subtotal, freeRateMethod.id);
  const selectedMethodLabel =
    SHIPPING.methods.find((option) => option.id === method)?.label ??
    "your delivery";
  const progress = Math.min(
    100,
    Math.round((subtotal / SHIPPING.freeThreshold) * 100),
  );

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: lines.filter(isProductLine).map((line) => ({
            product_id: line.product_id,
            slug: line.slug,
            colour: line.colour,
            attachment_id: line.attachment_id,
            quantity: line.quantity,
            custom: line.custom,
            personalisation_text: line.personalisation_text ?? undefined,
          })),
          /*
           * Scoops go in their own array for the same reason they do in the
           * quote above: a tier is a different table, and a line that says only
           * "slug" cannot be resolved against the right one without being told
           * which kind it is. The slug and the quantity are ALL that is sent —
           * no price, no piece count, no weight. Checkout recomputes every one
           * of those from the tier row, exactly as it recomputes a product's
           * price, and refuses the tier outright if the owner has since
           * switched it off or unpriced it — which is the whole of what
           * `availability.sellable` asks (lib/scoop.ts). What the browser is
           * holding is a fortnight-old copy of a shop-editable row; it is a
           * display value, never an input to a bill.
           *
           * "Not sellable right now" was the old phrasing and invited the
           * reading it once had: `sellable` used to fall false when the pool
           * could not fill a scoop off the shelf. It does not, and a basket is
           * never refused over a shelf count — the shop prints to order, so a
           * short bowl is topped up before packing.
           */
          scoop_lines: lines
            .filter(isScoopLine)
            .map((line) => ({ slug: line.slug, quantity: line.quantity })),
          shipping_method: method,
          gift_note: giftNote || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not start checkout. Please try again.");
        setBusy(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not reach the payment provider. Please try again.");
      setBusy(false);
    }
  }

  // Avoid a flash of "empty basket" before localStorage is read.
  if (!ready) {
    return (
      <div className="wrap py-20 text-center text-muted">Loading your basket…</div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="wrap pt-10">
        {cancelled ? (
          <div className="mx-auto mb-8 max-w-xl">
            <Alert tone="info">
              Checkout was cancelled — nothing has been charged.
            </Alert>
          </div>
        ) : null}
        <div className="flex flex-col items-center py-14 text-center">
          <span className="flex h-32 w-32 items-center justify-center rounded-[32px] bg-butter">
            <Icon name="bag" size={52} strokeWidth={1.4} />
          </span>
          <h1 className="mt-7 text-3xl">Your basket is empty</h1>
          <p className="mt-2.5 max-w-md text-muted">
            Nothing to click yet. Bestsellers are a good place to start — or
            design a name charm from scratch.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <ButtonLink href="/shop">Shop bestsellers</ButtonLink>
            <ButtonLink href="/builder" variant="ghost">
              <Icon name="sparkle" size={17} />
              Design your own
            </ButtonLink>
          </div>
        </div>

        {suggestions.length > 0 ? (
          <section className="pt-10">
            <SectionHead title="Popular right now" />
            <ProductGrid products={suggestions} />
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wrap pt-10">
      <h1 className="mb-7 text-3xl md:text-4xl">
        Your basket{" "}
        <span className="font-normal text-faint">({pluralise(count, "item")})</span>
      </h1>

      {cancelled ? (
        <div className="mb-6">
          <Alert tone="info">
            Checkout was cancelled — your basket is exactly as you left it and
            nothing has been charged.
          </Alert>
        </div>
      ) : null}

      <div className="grid items-start gap-10 lg:grid-cols-[1.6fr_1fr] lg:gap-12">
        <div>
          <div className="border-t border-line">
            {lines.map((line) => (
              <LineRow key={line.key} line={line} />
            ))}
          </div>

          <div className="mt-6 max-w-lg">
            <label htmlFor="gift-note" className="text-[13.5px] font-extrabold">
              Gift note or order request{" "}
              <span className="font-semibold text-faint">(optional, free)</span>
            </label>
            <textarea
              id="gift-note"
              rows={3}
              maxLength={500}
              value={giftNote}
              onChange={(event) => setGiftNote(event.target.value)}
              placeholder="“Happy birthday Mia!” — we'll handwrite it on the card…"
              className="mt-1.5 w-full rounded-xl border border-line2 bg-surface p-3.5 text-[15px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
          </div>

          {suggestions.length > 0 ? (
            <section className="mt-12">
              <SectionHead title="Before you go" />
              <ProductGrid products={suggestions} />
            </section>
          ) : null}
        </div>

        <div className="card p-6 lg:sticky lg:top-28">
          <b className="font-display text-[17px]">Order summary</b>

          {freeRateMethod ? (
            <div className="mt-4 mb-1">
              <div className="mb-2 flex justify-between gap-3 text-[12.5px]">
                <span className="flex items-start gap-1.5 text-muted">
                  <Icon name="truck" size={14} className="mt-0.5 shrink-0" />
                  <span>
                    {!freeRateReached
                      ? `Free ${freeRateLabel} shipping at ${money(SHIPPING.freeThreshold)}`
                      : selectedIsFree
                        ? `Free ${freeRateLabel} shipping unlocked`
                        : `Free ${freeRateLabel} shipping unlocked — ${selectedMethodLabel} is still charged`}
                  </span>
                </span>
                <b
                  className={cx(
                    "shrink-0",
                    selectedIsFree ? "text-good" : "text-muted",
                  )}
                >
                  {freeRateReached
                    ? selectedIsFree
                      ? "FREE"
                      : postageText(shipping)
                    : `${money(freeShippingRemaining)} to go`}
                </b>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-line">
                <div
                  className={cx(
                    "h-2 rounded-full transition-[width]",
                    // Green only when the selected method really is free — a
                    // full green bar beside an Express charge reads as "free".
                    selectedIsFree ? "bg-good" : "bg-accent",
                  )}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : null}

          <fieldset className="mt-5">
            <legend className="mb-2.5 text-[13.5px] font-extrabold">
              Delivery
            </legend>
            <div className="flex flex-col gap-2.5">
              {SHIPPING.methods.map((option) => {
                const optionQuote = quotes?.[option.id] ?? null;
                const optionFree = isFreeShipping(subtotal, option.id);
                const cost: number | null = optionFree
                  ? 0
                  : (optionQuote?.amountCents ?? null);
                const on = method === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMethod(option.id as "standard" | "express")}
                    aria-pressed={on}
                    className={cx(
                      "flex items-center gap-3 rounded-xl border p-3.5 text-left",
                      on ? "border-ink" : "border-line hover:border-line2",
                    )}
                  >
                    <span
                      className={cx(
                        "h-5 w-5 shrink-0 rounded-full",
                        on ? "border-[6px] border-ink" : "border border-line2",
                      )}
                    />
                    <span className="flex-1">
                      <b className="text-[14px]">{option.label}</b>
                      <span className="block text-xs text-muted">
                        {/* Tracking is read off the quote, never asserted. A
                            Large Letter is untracked and uninsured, and
                            `letter_eligible` is a checkbox on a product row —
                            so the only honest source for this word is the
                            service the quote actually picked. Until it lands,
                            the range is stated without a tracking claim. */}
                        {optionQuote
                          ? transitLabel(option.id, optionQuote.tracked)
                          : transitRangeLabel(option.id)}
                        {optionQuote?.estimated ? " · estimated" : ""}
                      </span>
                    </span>
                    <b
                      className={cx(
                        "text-sm",
                        cost === 0 && "text-good",
                        cost === null && "text-[11px] font-normal text-faint",
                      )}
                    >
                      {cost === 0 ? "FREE" : postageText(cost)}
                    </b>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="my-5 flex flex-col gap-3 text-[14.5px]">
            <div className="flex justify-between">
              <span className="text-muted">Subtotal</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Delivery</span>
              <span
                className={cx(
                  shipping === 0 && "font-extrabold text-good",
                  shipping === null && "text-[12.5px] text-faint",
                )}
              >
                {shipping === 0 ? "FREE" : postageText(shipping)}
              </span>
            </div>
            {SHOP.gstRegistered && total !== null ? (
              <div className="flex justify-between text-[12.5px] text-faint">
                <span>Includes GST</span>
                <span>{money(gstComponent(total))}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-line pt-3.5 text-lg">
              <b>Total</b>
              {/* Postage not yet quoted: show what is known and say the rest is
                  still coming, rather than a total that omits postage. */}
              <b>
                {total === null
                  ? `${money(subtotal)} + postage`
                  : `${money(total)} AUD`}
              </b>
            </div>
          </div>

          {error ? (
            <div className="mb-4">
              <Alert tone="error">{error}</Alert>
            </div>
          ) : null}

          <Button full size="lg" onClick={checkout} disabled={busy}>
            <Icon name="lock" size={17} />
            {busy ? "Taking you to checkout…" : "Checkout securely"}
          </Button>

          <div className="mt-3.5 flex flex-wrap justify-center gap-2">
            {PAYMENT_BADGES.map((name) => (
              <span
                key={name}
                className="rounded border border-line2 px-1.5 py-1 text-[9.5px] font-extrabold text-muted"
              >
                {name}
              </span>
            ))}
          </div>
          <p className="mt-3 flex items-center justify-center gap-2 text-center text-[12.5px] text-muted">
            <Icon name="shield" size={15} />
            Card details go straight to Stripe — we never see them
          </p>
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-muted">
            <Icon name="box" size={15} className="mt-px shrink-0" />
            Printing takes {PRINT_LEAD_TIME.label} before dispatch
          </p>
          {lines.some((l) => l.is_personalised) ? (
            <div className="mt-3">
              <Pill tone="accent">Contains personalised items</Pill>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
