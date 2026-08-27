/**
 * The bowl.
 *
 * Every other illustration in this shop is a product — `components/ProductArt`
 * has seventeen of them, keyed by `ArtKey`, and nothing there is a container.
 * A scoop is not a product row and never will be (0007_lucky_scoop.sql), so it
 * has no `art` key to look up and needed its own drawing rather than borrowing
 * a macaron and hoping nobody read it as "you get macarons".
 *
 * Deliberately generic charms — a disc, a heart, a star. The pieces in any real
 * bowl are whatever the tier's pool says they are, and the pool is rendered
 * underneath as actual product cards. Drawing recognisable products here would
 * put a second, prettier, wrong answer above the real one.
 *
 * Same register as `ProductArt`: 96×96 viewBox, flat fills from the same
 * palette, one shadow, `aria-hidden` because the words carry the meaning.
 */
export function ScoopArt({
  size = 96,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <ellipse cx="48" cy="86" rx="27" ry="5" fill="#2A2520" opacity="0.09" />

      {/* Charms above the rim, mid-draw. */}
      <circle cx="30" cy="30" r="7" fill="#F5BCC4" />
      <path
        d="M62 22c2.6-2.6 6.6-.6 6.6 2.4 0 3.4-4.2 6-6.6 7.8-2.4-1.8-6.6-4.4-6.6-7.8 0-3 4-5 6.6-2.4Z"
        fill="#EFA7B0"
      />
      <path
        d="m47 16 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8Z"
        fill="#F3C89B"
      />

      {/* The bowl: rim, then the body it sits on. */}
      <ellipse cx="48" cy="48" rx="32" ry="9" fill="#E4DFD8" />
      <path d="M16 48a32 9 0 0 0 64 0v1a32 30 0 0 1-64 0Z" fill="#CFC9C2" />

      {/* Pieces still in it, half-buried in the rim. */}
      <circle cx="34" cy="47" r="6" fill="#A9BC7F" />
      <circle cx="49" cy="49" r="7" fill="#B98A5C" />
      <circle cx="63" cy="46" r="5.5" fill="#F5BCC4" />

      <circle cx="36" cy="27" r="2.4" fill="#fff" opacity="0.55" />
      <circle cx="30" cy="60" r="4" fill="#fff" opacity="0.35" />
    </svg>
  );
}

export default ScoopArt;
