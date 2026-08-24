"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon, cx, inputClass } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import { money } from "@/lib/format";
import {
  PERSONALISATION_TEXT_MAX,
  PERSONALISATION_TEXT_PATTERN,
} from "@/lib/config";
import type { Product } from "@/lib/types";

/** Colour + attachment pickers, quantity and the two buy buttons. */
export function ProductBuy({ product }: { product: Product }) {
  const { add } = useCart();
  const router = useRouter();

  const colours = product.colours ?? [];
  const attachments = product.attachments ?? [];

  const [colour, setColour] = useState(colours[0]?.name ?? null);
  const [attachmentId, setAttachmentId] = useState(attachments[0]?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const [personalText, setPersonalText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);

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

    add({
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
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="flex h-12 w-12 items-center justify-center disabled:opacity-40"
          >
            <Icon name="minus" size={16} />
          </button>
          <span aria-live="polite" className="w-8 text-center font-bold">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(20, q + 1))}
            aria-label="Increase quantity"
            className="flex h-12 w-12 items-center justify-center"
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
