"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ProductArt } from "@/components/ProductArt";
import { Keycap, KeycapWord } from "@/components/builder/Keycap";
import { Button, Icon, Pill, cx } from "@/components/ui";
import { useCart } from "@/components/cart/CartProvider";
import {
  BUILDER_ATTACHMENTS,
  BUILDER_MAX_LETTERS,
  BUILDER_NO_CHARM_DISCOUNT,
  BUILDER_PRICING,
  PRINT_LEAD_TIME,
} from "@/lib/config";
import { money } from "@/lib/format";
import type { ArtKey, Collection, Product, Tint } from "@/lib/types";

const ROWS = ["ABCDEFGHI", "JKLMNOPQR", "STUVWXYZ"];

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

export function BuilderClient({
  collections,
  anchor,
  alternatives = [],
}: {
  collections: Collection[];
  anchor: Product;
  /** Every builder-mode product, so the shopper can switch what they're making. */
  alternatives?: Product[];
}) {
  const { add } = useCart();
  const router = useRouter();

  const [collectionSlug, setCollectionSlug] = useState(
    (collections.find((c) => c.is_popular) ?? collections[0]).slug,
  );
  const [letters, setLetters] = useState<string[]>([]);
  const [withCharm, setWithCharm] = useState(true);
  const [attachmentId, setAttachmentId] = useState<string>(
    BUILDER_ATTACHMENTS[0].id,
  );
  const [added, setAdded] = useState(false);

  const collection =
    collections.find((c) => c.slug === collectionSlug) ?? collections[0];

  const word = letters.join("");
  const full = letters.length >= BUILDER_MAX_LETTERS;

  const price = useMemo(() => {
    const bundle = BUILDER_PRICING[letters.length];
    if (!bundle) return 0;
    return bundle - (withCharm ? 0 : BUILDER_NO_CHARM_DISCOUNT);
  }, [letters.length, withCharm]);

  function pushLetter(letter: string) {
    if (full) return;
    setLetters((current) => [...current, letter]);
  }

  function addToBasket() {
    if (letters.length === 0) return;
    const attachment = BUILDER_ATTACHMENTS.find((a) => a.id === attachmentId)!;

    add({
      product_id: anchor.id,
      slug: anchor.slug,
      name: `${word} ${anchor.short_name.toLowerCase()}`,
      art: collection.charm_art as ArtKey,
      tint: collection.tint,
      colour: collection.name,
      attachment_id: attachment.id,
      attachment_label: attachment.label,
      unit_price: price,
      quantity: 1,
      is_personalised: true,
      custom: {
        collection_slug: collection.slug,
        collection_name: collection.name,
        letters: word,
        with_charm: withCharm,
      },
    });

    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  }

  return (
    <div className="wrap pt-10">
      {alternatives.length > 1 ? (
        <div className="mb-8 flex flex-wrap items-center gap-2.5">
          <span className="text-[13.5px] font-extrabold">Making:</span>
          {alternatives.map((option) => (
            <Link
              key={option.slug}
              href={`/builder?product=${option.slug}`}
              aria-current={option.slug === anchor.slug ? "page" : undefined}
              className={cx(
                "rounded-full px-4 py-2 text-[13.5px] font-extrabold",
                option.slug === anchor.slug
                  ? "bg-ink text-white"
                  : "border border-line2 bg-surface hover:border-ink",
              )}
            >
              {option.short_name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid items-start gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-12">
        <div className="flex flex-col gap-9">
          {/* ------------------------------------------------ 1 collection */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <Pill tone="dark">1</Pill>
              <h2 className="text-[22px]">Choose a collection</h2>
            </div>
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              {collections.map((item) => {
                const on = item.slug === collectionSlug;
                return (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setCollectionSlug(item.slug)}
                    aria-pressed={on}
                    className={cx(
                      "card flex flex-col items-center gap-2.5 p-4 text-center",
                      on ? "outline-2 -outline-offset-1 outline-ink" : "hover:border-line2",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Keycap letter="A" collection={item} size={40} />
                      <Keycap letter="B" collection={item} size={40} />
                      <span
                        className={cx(
                          "flex h-10 w-10 items-center justify-center rounded-[10px]",
                          TINT_BG[item.tint],
                        )}
                      >
                        <ProductArt art={item.charm_art as ArtKey} size={28} />
                      </span>
                    </span>
                    <span>
                      <b className="block text-[13.5px]">{item.name}</b>
                      <span className="text-[11.5px] text-muted">
                        {item.charm_name} charm
                      </span>
                    </span>
                    {on ? (
                      <Pill tone="good" className="text-[11px]">
                        <Icon name="check" size={12} />
                        Selected
                      </Pill>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          {/* --------------------------------------------------- 2 letters */}
          <section>
            <div className="mb-1.5 flex flex-wrap items-center gap-3">
              <Pill tone="dark">2</Pill>
              <h2 className="text-[22px]">Spell it out</h2>
              <span className="ml-auto text-[13px] text-muted">
                1–{BUILDER_MAX_LETTERS} letters · {letters.length} used
              </span>
            </div>
            {/* This read "Popular letters are always in stock; rare ones may
                add a day." Both halves were untrue. Nothing anywhere measures
                per-letter stock — every product row is `stock_on_hand: 0` and
                there is no letter inventory in the schema at all — and nothing
                adds a day to anything: PRINT_LEAD_TIME is one constant, no
                other surface quotes a longer window for a rare letter, and
                checkout's Stripe delivery estimate never adjusts it. The
                replacement states what the builder actually knows: these are
                printed to order, so the shop's own lead time applies whichever
                letters are chosen. */}
            <p className="mb-4 text-[13.5px] text-muted">
              Tap letters to add them. Every letter is printed for your order,
              so the print time is {PRINT_LEAD_TIME.label} whichever ones you
              choose.
            </p>

            <div className="mb-3.5 flex min-h-[56px] flex-wrap items-center gap-2 rounded-2xl bg-cream p-3">
              {letters.length === 0 ? (
                <span className="px-1 text-sm text-faint">
                  Your letters appear here…
                </span>
              ) : (
                letters.map((letter, i) => (
                  <button
                    key={`${letter}-${i}`}
                    type="button"
                    onClick={() =>
                      setLetters((current) =>
                        current.filter((_, index) => index !== i),
                      )
                    }
                    aria-label={`Remove letter ${letter}`}
                    className="relative"
                  >
                    <Keycap letter={letter} collection={collection} size={44} />
                    <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white">
                      <Icon name="x" size={10} strokeWidth={3} />
                    </span>
                  </button>
                ))
              )}
              {letters.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setLetters([])}
                  className="ml-auto text-[13px] font-bold text-muted underline underline-offset-2"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              {ROWS.map((row) => (
                <div key={row} className="flex justify-center gap-1.5 sm:gap-2">
                  {row.split("").map((letter) => {
                    const count = letters.filter((l) => l === letter).length;
                    return (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => pushLetter(letter)}
                        disabled={full}
                        aria-label={`Add letter ${letter}`}
                        className={cx(
                          "flex h-11 w-9 items-center justify-center rounded-xl border font-display text-[15px] font-semibold transition-colors sm:h-12 sm:w-[46px] sm:text-[17px]",
                          count > 0
                            ? "border-ink bg-cream"
                            : "border-line2 bg-surface hover:border-ink",
                          full && "cursor-not-allowed opacity-40",
                        )}
                      >
                        {letter}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Removed: "{SLOW_LETTERS} are printed to order (+1 day)". The
                "+1 day" was not backed by anything — see the note above the
                letter tray. It also implied the other letters are NOT printed
                to order, which is the stock claim again by implication: every
                letter on this keyboard is printed for the order. Removing that
                copy left `SLOW_LETTERS` with no reader, and it has since been
                deleted from lib/config.ts — a note where it stood records why a
                named list of "slow" letters is not worth keeping. */}

            {full ? (
              <p className="mt-3 text-center text-[13px] font-bold text-accent-dark">
                That&apos;s the {BUILDER_MAX_LETTERS}-letter maximum — remove one
                to swap it out.
              </p>
            ) : null}
          </section>

          {/* -------------------------------------------------- 3 finishing */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <Pill tone="dark">3</Pill>
              <h2 className="text-[22px]">Finish it</h2>
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={() => setWithCharm(true)}
                aria-pressed={withCharm}
                className={cx(
                  "flex items-center gap-3.5 rounded-2xl border p-4 text-left",
                  withCharm ? "border-ink" : "border-line hover:border-line2",
                )}
              >
                <span
                  className={cx(
                    "h-5 w-5 shrink-0 rounded-full",
                    withCharm ? "border-[6px] border-ink" : "border border-line2",
                  )}
                />
                <span className="flex-1">
                  <b className="text-[14.5px]">Add the matching charm</b>
                  <span className="block text-[13px] text-muted">
                    {collection.charm_name} clicker threads on the end
                  </span>
                </span>
                <b>Included</b>
              </button>

              <button
                type="button"
                onClick={() => setWithCharm(false)}
                aria-pressed={!withCharm}
                className={cx(
                  "flex items-center gap-3.5 rounded-2xl border p-4 text-left",
                  !withCharm ? "border-ink" : "border-line hover:border-line2",
                )}
              >
                <span
                  className={cx(
                    "h-5 w-5 shrink-0 rounded-full",
                    !withCharm ? "border-[6px] border-ink" : "border border-line2",
                  )}
                />
                <span className="flex-1">
                  <b className="text-[14.5px]">Letters only</b>
                  <span className="block text-[13px] text-muted">
                    Just the caps on the holder
                  </span>
                </span>
                <b>−{money(BUILDER_NO_CHARM_DISCOUNT)}</b>
              </button>

              <fieldset className="mt-2">
                <legend className="mb-2.5 text-[13.5px] font-extrabold">
                  Attach with
                </legend>
                <div className="flex flex-wrap gap-2.5">
                  {BUILDER_ATTACHMENTS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setAttachmentId(option.id)}
                      aria-pressed={attachmentId === option.id}
                      className={cx(
                        "rounded-full px-4 py-2.5 text-[13.5px] font-extrabold",
                        attachmentId === option.id
                          ? "bg-ink text-white"
                          : "border border-line2 bg-surface hover:border-ink",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------- preview */}
        <div className="card p-6 lg:sticky lg:top-28">
          <b className="text-[15px] text-muted">Your design</b>

          <div className="my-4 flex flex-col items-center gap-3 rounded-2xl bg-cream px-4 py-7">
            {letters.length === 0 ? (
              <p className="py-6 text-center text-sm text-faint">
                Pick some letters and your charm builds itself here.
              </p>
            ) : (
              <>
                <KeycapWord
                  word={word}
                  collection={collection}
                  size={letters.length > 3 ? 52 : 62}
                  withCharm={withCharm}
                />
                <span className="text-[12.5px] text-muted">
                  {collection.name} · {letters.length} letter
                  {letters.length === 1 ? "" : "s"}
                  {withCharm ? " · matching charm" : " · letters only"}
                </span>
              </>
            )}
          </div>

          <div className="mb-4 grid grid-cols-5 gap-1.5">
            {Object.entries(BUILDER_PRICING).map(([count, value]) => (
              <div
                key={count}
                className={cx(
                  "rounded-lg py-1.5 text-center text-[11.5px] font-extrabold",
                  Number(count) === letters.length
                    ? "bg-ink text-white"
                    : "bg-cream text-muted",
                )}
              >
                {count} · {money(value).replace(".00", "")}
              </div>
            ))}
          </div>

          <div className="mb-4 flex flex-col gap-2.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">
                {letters.length || "—"}-letter bundle
              </span>
              <span>
                {letters.length ? money(BUILDER_PRICING[letters.length]) : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Charm</span>
              <span>
                {withCharm ? "Included" : `−${money(BUILDER_NO_CHARM_DISCOUNT)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">
                {BUILDER_ATTACHMENTS.find((a) => a.id === attachmentId)?.label}
              </span>
              <span>Included</span>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-[17px]">
              <b>Total</b>
              <b>{letters.length ? `${money(price)} AUD` : "—"}</b>
            </div>
          </div>

          {/* Removed: an info alert reading "Your name uses a rare letter —
              add a day to the print time." Nothing adds that day. The order
              carries PRINT_LEAD_TIME like every other, the Stripe delivery
              estimate is built from the same constant, and telling a customer
              their order will be slower than it is, is as untrue as telling
              them it will be faster. `hasSlowLetter` went with it. */}

          <Button full onClick={addToBasket} disabled={letters.length === 0}>
            {added ? (
              <>
                <Icon name="check" size={18} strokeWidth={2.4} />
                Added to basket
              </>
            ) : (
              <>
                <Icon name="bag" size={18} />
                {letters.length
                  ? `Add to basket · ${money(price)}`
                  : "Pick your letters"}
              </>
            )}
          </Button>

          {added ? (
            <button
              type="button"
              onClick={() => router.push("/cart")}
              className="mt-3 w-full text-center text-[13.5px] font-extrabold text-accent underline underline-offset-2"
            >
              Go to basket →
            </button>
          ) : null}

          <p className="mt-3.5 flex items-center justify-center gap-2 text-center text-[12.5px] text-muted">
            <Icon name="box" size={15} />
            Personalised — printed in {PRINT_LEAD_TIME.label}
          </p>
        </div>
      </div>
    </div>
  );
}
