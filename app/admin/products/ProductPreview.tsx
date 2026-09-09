"use client";

import { useState } from "react";
import { cx, inputClass } from "@/components/ui";

/**
 * The real product page, in a frame, beside the fields that produce it.
 *
 * A FRAME AND NOT A MIRROR, which was a decision rather than a shortcut. A
 * mirror would be a second rendering of a product built out of the same fields,
 * and it would drift: every change to the shop's own product page would have to
 * be made twice, and the day somebody forgot, the studio would be showing a
 * confident picture of a page that no longer exists. The frame is the page. It
 * is slower to load and it cannot preview anything unsaved, and both of those
 * are honest limits rather than bugs.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: preview your edits. It shows what is saved,
 * because that is all a frame of a real URL can show, and it says so in words
 * above itself. A preview that silently showed stale content while looking live
 * would be worse than no preview at all, since the whole reason for the tab is
 * to be able to trust what you are looking at.
 */
export function ProductPreview({
  slug,
  active,
}: {
  slug: string;
  /** A hidden product has no shop page: `getProductBySlug` filters on active. */
  active: boolean;
}) {
  const [width, setWidth] = useState<"phone" | "full">("full");

  if (!active) {
    return (
      <div className="card border-line2 bg-cream p-5 text-[13.5px] text-muted">
        <b className="text-ink">This product is hidden from the shop</b>, so it
        has no page to show. The shop looks products up by slug and filters on
        active, so the address would answer &ldquo;not found&rdquo; rather than
        render. Tick <b>Listed in the online shop</b> and save to preview it.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          The real page, as a customer gets it.{" "}
          <b>It shows what is saved</b>, so save before you judge a change.
        </p>
        <div className="flex gap-1.5">
          {(["phone", "full"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWidth(option)}
              className={cx(
                `${inputClass} !h-9 !w-auto cursor-pointer px-3 font-display text-[13px] font-semibold`,
                width === option && "!border-accent !text-accent-dark",
              )}
            >
              {option === "phone" ? "Phone" : "Full width"}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mx-auto w-full overflow-hidden rounded-xl border border-line bg-white"
        style={{ maxWidth: width === "phone" ? 420 : "100%" }}
      >
        {/*
          * `key` on the width so switching actually re-lays-out the page inside
          * rather than showing a desktop layout squeezed into 420px: the shop is
          * responsive to the frame's own width, and an iframe that is merely
          * resized does re-flow, but a remount also drops any scroll position
          * from the previous width, which is the less confusing of the two.
          *
          * No sandbox attribute. It is our own page on our own origin, and
          * sandboxing it would break the very thing being previewed.
          */}
        <iframe
          key={width}
          src={`/product/${slug}`}
          title="How this product looks in the shop"
          loading="lazy"
          className="h-[720px] w-full border-0"
        />
      </div>
    </div>
  );
}
