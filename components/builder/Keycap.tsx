import { ProductArt } from "@/components/ProductArt";
import type { ArtKey, Collection, Tint } from "@/lib/types";

const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

/** A single printed letter cap in a collection's colourway. */
export function Keycap({
  letter,
  collection,
  size = 56,
}: {
  letter: string;
  collection: Pick<Collection, "cap_colour" | "letter_colour">;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center font-display font-bold"
      style={{
        width: size,
        height: size,
        background: collection.cap_colour,
        color: collection.letter_colour,
        borderRadius: Math.round(size * 0.22),
        fontSize: Math.round(size * 0.43),
        boxShadow: `inset 0 -${Math.round(size * 0.09)}px 0 rgba(0,0,0,0.13), 0 2px 6px rgba(34,31,26,0.10)`,
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

/** The assembled charm: caps on a holder cord, with an optional charm. */
export function KeycapWord({
  word,
  collection,
  size = 62,
  withCharm = true,
  showCord = true,
}: {
  word: string;
  collection: Collection;
  size?: number;
  withCharm?: boolean;
  showCord?: boolean;
}) {
  const letters = word.split("");

  return (
    <div className="flex flex-col items-center gap-3">
      {showCord ? (
        <span
          className="h-2.5 w-full max-w-[280px] rounded-full"
          style={{ background: collection.holder_colour }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`flex flex-wrap items-center justify-center gap-2 ${showCord ? "-mt-7" : ""}`}
      >
        {letters.map((letter, i) => (
          <Keycap
            key={`${letter}-${i}`}
            letter={letter}
            collection={collection}
            size={size}
          />
        ))}
        {withCharm ? (
          <span
            className={`flex shrink-0 items-center justify-center ${TINT_BG[collection.tint]}`}
            style={{
              width: size,
              height: size,
              borderRadius: Math.round(size * 0.24),
            }}
            aria-hidden="true"
          >
            <ProductArt art={collection.charm_art as ArtKey} size={Math.round(size * 0.7)} />
          </span>
        ) : null}
      </div>
      <span className="sr-only">
        {word || "No letters chosen"} in the {collection.name} colourway
        {withCharm ? ` with a ${collection.charm_name} charm` : ""}
      </span>
    </div>
  );
}
