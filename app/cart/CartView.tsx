"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
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
import { useCart } from "@/components/cart/CartProvider";
import { PRINT_LEAD_TIME, SHIPPING, shippingCost } from "@/lib/config";
import { gstComponent, money, pluralise } from "@/lib/format";
import type { CartLine, Product, Tint } from "@/lib/types";

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

function LineRow({ line }: { line: CartLine }) {
  const { setQuantity, remove } = useCart();

  const variant = [
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
        href={`/product/${line.slug}`}
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
            <Link href={`/product/${line.slug}`} className="font-bold hover:text-accent-dark">
              {line.name}
            </Link>
            {variant ? (
              <p className="mt-0.5 text-[13px] text-muted">{variant}</p>
            ) : null}
            {line.is_personalised ? (
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
              aria-label={`Decrease quantity of ${line.name}`}
              className="flex h-11 w-11 items-center justify-center"
            >
              <Icon name="minus" size={15} />
            </button>
            <span className="w-8 text-center text-[15px] font-bold">
              {line.quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity(line.key, line.quantity + 1)}
              aria-label={`Increase quantity of ${line.name}`}
              className="flex h-11 w-11 items-center justify-center"
            >
              <Icon name="plus" size={15} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => remove(line.key)}
            className="flex items-center gap-1.5 text-[13px] text-muted hover:text-danger"
          >
            <Icon name="trash" size={15} />
            Remove
            <span className="sr-only"> {line.name}</span>
          </button>
        </div>
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

  const shipping = shippingCost(subtotal, method);
  const total = subtotal + shipping;
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
          lines: lines.map((line) => ({
            product_id: line.product_id,
            slug: line.slug,
            colour: line.colour,
            attachment_id: line.attachment_id,
            quantity: line.quantity,
            custom: line.custom,
          })),
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

          <div className="mt-4 mb-1">
            <div className="mb-2 flex justify-between text-[12.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                <Icon name="truck" size={14} />
                {freeShippingRemaining === 0
                  ? "Free shipping unlocked"
                  : "Free shipping at $49"}
              </span>
              <b className={freeShippingRemaining === 0 ? "text-good" : "text-muted"}>
                {freeShippingRemaining === 0
                  ? "$0.00 to go"
                  : `${money(freeShippingRemaining)} to go`}
              </b>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-line">
              <div
                className="h-2 rounded-full bg-good transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="mb-2.5 text-[13.5px] font-extrabold">
              Delivery
            </legend>
            <div className="flex flex-col gap-2.5">
              {SHIPPING.methods.map((option) => {
                const cost = shippingCost(subtotal, option.id);
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
                        {option.description}
                      </span>
                    </span>
                    <b className={cx("text-sm", cost === 0 && "text-good")}>
                      {cost === 0 ? "FREE" : money(cost)}
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
              <span className={shipping === 0 ? "font-extrabold text-good" : ""}>
                {shipping === 0 ? "FREE" : money(shipping)}
              </span>
            </div>
            <div className="flex justify-between text-[12.5px] text-faint">
              <span>Includes GST</span>
              <span>{money(gstComponent(total))}</span>
            </div>
            <div className="flex justify-between border-t border-line pt-3.5 text-lg">
              <b>Total</b>
              <b>{money(total)} AUD</b>
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
            {["VISA", "MC", "PAYPAL", "APPLE PAY"].map((name) => (
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
