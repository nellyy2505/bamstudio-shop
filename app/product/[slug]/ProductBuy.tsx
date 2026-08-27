"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button, Icon, cx, inputClass } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import { money } from "@/lib/format";
import {
  BASKET_LIMITS,
  PERSONALISATION_TEXT_MAX,
  PERSONALISATION_TEXT_PATTERN,
} from "@/lib/config";
import type { Product } from "@/lib/types";

/** Colour + attachment pickers, quantity and the two buy buttons. */
export function ProductBuy({ product }: { product: Product }) {
  const { add } = useCart();
  const router = useRouter();
  const capNoteId = useId();

  const colours = product.colours ?? [];
  const attachments = product.attachments ?? [];

  const [colour, setColour] = useState(colours[0]?.name ?? null);
  const [attachmentId, setAttachmentId] = useState(attachments[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [personalText, setPersonalText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  /** Why the basket would not take this — never colour or silence alone. */
  const [basketError, setBasketError] = useState<string | null>(null);

  const atMax = quantity >= BASKET_LIMITS.maxLineQuantity;

  const needsText = product.personalisation_mode === "text";
  const label = product.personalisation_label ?? "Text to print";

  const attachment = attachments.find((a) => a.id === attachmentId) ?? null;
  const unitPrice = product.price + (attachment?.price_delta ?? 0);

  // Builder charms are configured letter by letter, priced by length, so the
  // buy box hands off rather than guessing. Text personalisation stays here.
  if (product.personalisation_mode === "builder") {
    return (
      <div className="rounded-2xl bg-lilac p-5">
        <b className="text-[15px]">This one is made to your spec</b>
        <p className="mt-1.5 mb-4 text-sm text-muted">
          Pick the letters, colourway and cord in the builder — flat price by
          name length, from {money(product.price)}.
        </p>
        <Link
          href={`/builder?product=${product.slug}`}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 font-display font-semibold text-white hover:bg-accent-dark"
        >
          <Icon name="sparkle" size={18} />
          Design yours
        </Link>
      </div>
    );
  }

  function addToCart(): boolean {
    if (needsText) {
      const trimmed = personalText.trim();
      if (!trimmed) {
        setTextError(`Add the ${label.toLowerCase()} you'd like printed.`);
        return false;
      }
      if (!PERSONALISATION_TEXT_PATTERN.test(trimmed)) {
        setTextError("Letters, numbers, spaces and - ' & . / only.");
        return false;
      }
    }
    setTextError(null);

    const result = add({
      product_id: product.id,
      slug: product.slug,
      name: product.short_name,
      art: product.art,
      tint: product.tint,
      colour,
      attachment_id: attachment?.id ?? null,
      attachment_label: attachment?.label ?? null,
      unit_price: unitPrice,
      quantity,
      is_personalised: needsText,
      personalisation_text: needsText ? personalText.trim() : null,
    });

    /*
     * The basket enforces the same caps checkout does, so `add` can take less
     * than it was asked for — or nothing at all. Reporting that is the whole
     * point: before this, a basket built past either cap reached checkout and
     * came back as a blanket "Invalid basket." with no way to tell which line
     * was the problem, and the cart's postage quote silently fell back to
     * "Calculated at checkout" with no total and no reason given.
     */
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
        ? `Your basket now holds ${BASKET_LIMITS.maxLineQuantity} of this — the most we ` +
            "can print of one item in a single order."
        : null,
    );

    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
    return true;
  }

  return (
    <div>
      {colours.length > 0 ? (
        <fieldset className="mb-5">
          <legend className="mb-2.5 text-[13.5px] font-extrabold">
            Colour:{" "}
            <span className="font-semibold text-muted">{colour ?? "Any"}</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {colours.map((option) => (
              <button
                key={option.name}
                type="button"
                onClick={() => setColour(option.name)}
                aria-pressed={colour === option.name}
                aria-label={option.name}
                title={option.name}
                className={cx(
                  "h-9 w-9 rounded-full",
                  colour === option.name
                    ? "outline-2 outline-offset-[3px] outline-ink"
                    : "border border-line2",
                )}
                style={{ background: option.hex }}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {attachments.length > 0 ? (
        <fieldset className="mb-5">
          <legend className="mb-2.5 text-[13.5px] font-extrabold">
            Attachment
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {attachments.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setAttachmentId(option.id)}
                aria-pressed={attachmentId === option.id}
                className={cx(
                  "rounded-full px-4 py-3 text-[13.5px] font-extrabold",
                  attachmentId === option.id
                    ? "bg-ink text-white"
                    : "border border-line2 bg-surface hover:border-ink",
                )}
              >
                {option.label}
                {option.price_delta !== 0
                  ? ` ${option.price_delta > 0 ? "+" : "−"}${money(Math.abs(option.price_delta))}`
                  : ""}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {needsText ? (
        <div className="mb-5">
          <label
            htmlFor="personalisation"
            className="mb-1.5 block text-[13.5px] font-extrabold"
          >
            {label}
          </label>
          <input
            id="personalisation"
            type="text"
            required
            maxLength={PERSONALISATION_TEXT_MAX}
            value={personalText}
            onChange={(event) => {
              setPersonalText(event.target.value);
              if (textError) setTextError(null);
            }}
            aria-invalid={textError ? true : undefined}
            aria-describedby="personalisation-hint"
            placeholder={`e.g. ${label === "Pet's name" ? "Mochi" : "14.03.24"}`}
            className={inputClass}
          />
          <p
            id="personalisation-hint"
            className={cx(
              "mt-1.5 text-xs",
              textError ? "font-semibold text-danger" : "text-muted",
            )}
          >
            {textError ??
              `Up to ${PERSONALISATION_TEXT_MAX} characters, printed exactly as you type it. Personalised items can only be returned if faulty.`}
          </p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex h-12 items-center rounded-full border border-line2 bg-surface">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            /* `aria-disabled`, not `disabled`, for the same reason as the +
               button below: pressing it at 2 takes the quantity to 1, and a
               `disabled` button leaves the tab order in that instant, dropping
               the keyboard user's focus to the body mid-task. */
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
            /* No-op at the cap rather than `disabled`: a disabled button leaves
               the tab order the instant it is pressed, so a keyboard user loses
               focus to the body and never hears why nothing happened. */
            onClick={() =>
              setQuantity((q) => Math.min(BASKET_LIMITS.maxLineQuantity, q + 1))
            }
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
            addToCart();
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
              Add to basket · {money(unitPrice * quantity)}
            </>
          )}
        </Button>
      </div>

      {/* Only rendered at the cap, so nothing moves until it is reached. */}
      {atMax ? (
        <p id={capNoteId} role="status" className="mt-3 text-xs text-muted">
          {BASKET_LIMITS.maxLineQuantity} is the most we can print of one item in a
          single order. Need more? Get in touch and we&apos;ll sort it out.
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
          if (addToCart()) router.push("/cart");
        }}
      >
        Buy it now
      </Button>

      <p aria-live="polite" className="sr-only">
        {added ? `${product.short_name} added to your basket.` : ""}
      </p>
    </div>
  );
}
