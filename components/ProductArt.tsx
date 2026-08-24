import type { ArtKey, Tint } from "@/lib/types";

/**
 * Illustrated stand-ins for product photography, ported from the approved
 * design canvas. Swap `ProductImage` for real photos when they exist —
 * everything else keys off the same `art`/`tint` pair.
 */

const SHADOW = (
  <ellipse cx="48" cy="86" rx="27" ry="5" fill="#2A2520" opacity="0.09" />
);

const gloss = (x: number, y: number, r = 5) => (
  <circle cx={x} cy={y} r={r} fill="#fff" opacity="0.55" />
);

const ART: Record<ArtKey, React.ReactNode> = {
  macaron: (
    <>
      {SHADOW}
      <path d="M20 38a28 10 0 0 1 56 0v4a28 10 0 0 1-56 0Z" fill="#EFA7B0" />
      <ellipse cx="48" cy="38" rx="28" ry="12" fill="#F5BCC4" />
      <path d="M22 52h52c1 3-2 6-6 6H28c-4 0-7-3-6-6Z" fill="#FFF6EC" />
      <path d="M20 62a28 10 0 0 1 56 0v2a28 11 0 0 1-56 0Z" fill="#EFA7B0" />
      <ellipse cx="48" cy="60" rx="28" ry="10" fill="#F5BCC4" />
      {gloss(34, 33, 6)}
    </>
  ),
  matcha: (
    <>
      {SHADOW}
      <path d="M24 46h40v14a20 14 0 0 1-40 0Z" fill="#CFC9C2" />
      <path
        d="M64 50h8a7 7 0 0 1 0 14h-8"
        fill="none"
        stroke="#CFC9C2"
        strokeWidth="6"
      />
      <ellipse cx="44" cy="46" rx="20" ry="8" fill="#A9BC7F" />
      <path d="M44 41c-3 2-3 6 0 8 3-2 3-6 0-8Z" fill="#FFF6EC" />
      <rect x="66" y="14" width="7" height="18" rx="3.5" fill="#CBA97E" />
      <path d="M62 32h15l3 14c-6 4-15 4-21 0Z" fill="#D9BC93" />
      <path
        d="M66 36v8M70 36v9M74 36v8"
        stroke="#B99768"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {gloss(34, 43, 4)}
    </>
  ),
  coffee: (
    <>
      {SHADOW}
      <path d="M30 30h36l-4 52H34Z" fill="#FFF9F0" />
      <path d="M31 42h34l-2 22H33Z" fill="#B98A5C" />
      <rect x="26" y="20" width="44" height="12" rx="5" fill="#3B342E" />
      <rect x="40" y="12" width="16" height="8" rx="3" fill="#3B342E" />
      {gloss(40, 50, 4)}
    </>
  ),
  cinnamon: (
    <>
      {SHADOW}
      <circle cx="48" cy="52" r="28" fill="#D9A566" />
      <path
        d="M48 52c0-9 9-13 16-8M48 52c0 9-9 13-16 8M48 52c9 0 13-9 8-16M48 52c-9 0-13 9-8 16"
        fill="none"
        stroke="#B97F3F"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M28 40c6-4 12 3 20 0s12-5 20 0"
        fill="none"
        stroke="#FFF6EC"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {gloss(36, 36, 4)}
    </>
  ),
  sushi: (
    <>
      {SHADOW}
      <circle cx="48" cy="52" r="28" fill="#3E4A44" />
      <circle cx="48" cy="52" r="21" fill="#FFF9F0" />
      <circle cx="48" cy="52" r="10" fill="#F0885F" />
      <path
        d="M43 49c2-3 8-3 10 0"
        stroke="#D96B41"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
      {gloss(38, 40, 4)}
    </>
  ),
  icecream: (
    <>
      {SHADOW}
      <path d="M34 44 48 84l14-40Z" fill="#DFAE72" />
      <path
        d="M38 50h20M36 58h16m4 0h2M40 66h12"
        stroke="#C08F52"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="48" cy="32" r="18" fill="#F5BCC4" />
      <path
        d="M32 36c4 6 8-2 12 3s8-1 12 3 8 0 8-3"
        fill="none"
        stroke="#F5BCC4"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {gloss(40, 26, 5)}
    </>
  ),
  smore: (
    <>
      {SHADOW}
      <rect x="20" y="24" width="56" height="14" rx="5" fill="#DFAE72" />
      <circle cx="32" cy="31" r="1.4" fill="#B98A52" />
      <circle cx="48" cy="31" r="1.4" fill="#B98A52" />
      <circle cx="64" cy="31" r="1.4" fill="#B98A52" />
      <path d="M22 40h52c2 4-1 9-5 9H27c-4 0-7-5-5-9Z" fill="#FFF6EC" />
      <rect x="24" y="50" width="48" height="8" rx="3" fill="#6B4A32" />
      <rect x="20" y="60" width="56" height="14" rx="5" fill="#DFAE72" />
      {gloss(32, 44, 3)}
    </>
  ),
  butter: (
    <>
      {SHADOW}
      <ellipse cx="48" cy="66" rx="30" ry="10" fill="#F0E8D8" />
      <path d="M28 42h34v18l6 6H34l-6-6Z" fill="#F2D98B" />
      <path d="M28 42h34l6 6H34Z" fill="#F8E6A8" />
      <path d="M62 42v18l6 6V48Z" fill="#E5C671" />
      {gloss(38, 50, 3.5)}
    </>
  ),
  tulip: (
    <>
      {SHADOW}
      <path d="M32 58h32l-4 24H36Z" fill="#C97B54" />
      <path d="M32 58h32l-1 5H33Z" fill="#B8663F" />
      <path d="M48 40v18" stroke="#6D9557" strokeWidth="4" strokeLinecap="round" />
      <path d="M48 52c-8-2-12-8-12-14 5 0 10 3 12 8Z" fill="#83AA68" />
      <path
        d="M34 18c0 12 5 20 14 20s14-8 14-20c-5 2-8 2-14-4-6 6-9 6-14 4Z"
        fill="#E88AA0"
      />
      {gloss(41, 24, 3.5)}
    </>
  ),
  cactus: (
    <>
      {SHADOW}
      <path d="M32 58h32l-4 24H36Z" fill="#C97B54" />
      <path d="M32 58h32l-1 5H33Z" fill="#B8663F" />
      <circle cx="48" cy="40" r="17" fill="#7EA465" />
      <path
        d="M48 26v28M36 34l24 12M60 34 36 46"
        stroke="#5F844A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="48" cy="24" r="4" fill="#E88AA0" />
      {gloss(41, 34, 3)}
    </>
  ),
  letters: (
    <>
      {SHADOW}
      <rect
        x="14"
        y="34"
        width="30"
        height="30"
        rx="8"
        fill="#F2D98B"
        transform="rotate(-6 29 49)"
      />
      <text
        x="28"
        y="58"
        fontFamily="Poppins, sans-serif"
        fontSize="19"
        fontWeight="700"
        fill="#6B4A32"
        transform="rotate(-6 29 49)"
      >
        M
      </text>
      <rect x="38" y="28" width="30" height="30" rx="8" fill="#F5BCC4" />
      <text
        x="46"
        y="50"
        fontFamily="Poppins, sans-serif"
        fontSize="19"
        fontWeight="700"
        fill="#fff"
      >
        I
      </text>
      <rect
        x="54"
        y="40"
        width="30"
        height="30"
        rx="8"
        fill="#A9BC7F"
        transform="rotate(7 69 55)"
      />
      <text
        x="62"
        y="63"
        fontFamily="Poppins, sans-serif"
        fontSize="19"
        fontWeight="700"
        fill="#fff"
        transform="rotate(7 69 55)"
      >
        A
      </text>
    </>
  ),
  corgi: (
    <>
      {SHADOW}
      <ellipse cx="48" cy="52" rx="26" ry="22" fill="#EBA95E" />
      <path d="M48 34c-10 0-16 8-16 18h32c0-10-6-18-16-18Z" fill="#EBA95E" />
      <path
        d="M48 74c-9 0-16-6-16-16 0-4 3-8 7-8 4 5 14 5 18 0 4 0 7 4 7 8 0 10-7 16-16 16Z"
        fill="#FFF6EC"
      />
      <circle cx="48" cy="46" r="5" fill="#F8E0C8" />
      <ellipse cx="38" cy="76" rx="6" ry="4" fill="#EBA95E" />
      <ellipse cx="58" cy="76" rx="6" ry="4" fill="#EBA95E" />
      {gloss(36, 42, 3.5)}
    </>
  ),
  tennis: (
    <>
      {SHADOW}
      <circle cx="48" cy="50" r="26" fill="#D7E06A" />
      <path
        d="M28 36c10 6 10 22 0 28M68 36c-10 6-10 22 0 28"
        fill="none"
        stroke="#FFF9F0"
        strokeWidth="4.5"
      />
      {gloss(38, 40, 5)}
    </>
  ),
  stand: (
    <>
      {SHADOW}
      <path d="M22 74h52l-6-12H28Z" fill="#9DB6C8" />
      <rect
        x="34"
        y="18"
        width="28"
        height="46"
        rx="6"
        fill="#C9D8E2"
        transform="rotate(-8 48 41)"
      />
      <rect
        x="38"
        y="23"
        width="20"
        height="34"
        rx="3"
        fill="#FFF9F0"
        transform="rotate(-8 48 41)"
      />
      {gloss(40, 30, 3.5)}
    </>
  ),
  pancake: (
    <>
      {SHADOW}
      <ellipse cx="48" cy="66" rx="30" ry="9" fill="#F0E8D8" />
      <ellipse cx="48" cy="60" rx="26" ry="9" fill="#DFA967" />
      <ellipse cx="48" cy="52" rx="26" ry="9" fill="#E8B876" />
      <ellipse cx="48" cy="44" rx="26" ry="9" fill="#DFA967" />
      <path
        d="M26 42c6 7 12-3 22 2s16 1 22-2c0 5-4 9-8 10H34c-4-1-8-5-8-10Z"
        fill="#B4713A"
      />
      <rect x="41" y="28" width="14" height="10" rx="2.5" fill="#F8E6A8" />
      {gloss(35, 50, 3)}
    </>
  ),
  croissant: (
    <>
      {SHADOW}
      <path
        d="M18 58c2-16 12-26 30-26s28 10 30 26c-4 5-9 7-14 6-1-12-7-19-16-19s-15 7-16 19c-5 1-10-1-14-6Z"
        fill="#E0A15C"
      />
      <path
        d="M32 62c1-13 7-21 16-21s15 8 16 21c-3 3-7 4-10 3-1-9-3-13-6-13s-5 4-6 13c-3 1-7 0-10-3Z"
        fill="#EBB273"
      />
      {gloss(35, 42, 3.5)}
    </>
  ),
  bao: (
    <>
      {SHADOW}
      <path
        d="M22 62a26 22 0 0 1 52 0c0 6-4 10-9 10H31c-5 0-9-4-9-10Z"
        fill="#FFF4E6"
      />
      <path
        d="M42 40c1-4 3-6 6-6s5 2 6 6M38 44c0-3 2-5 4-5M58 44c0-3-2-5-4-5"
        stroke="#EBD3B4"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="40" cy="56" r="2" fill="#5B4636" />
      <circle cx="56" cy="56" r="2" fill="#5B4636" />
      <path
        d="M45 61c2 2 4 2 6 0"
        stroke="#5B4636"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="34" cy="60" r="3.5" fill="#F5BCC4" opacity="0.7" />
      <circle cx="62" cy="60" r="3.5" fill="#F5BCC4" opacity="0.7" />
    </>
  ),
};

const TINT_CLASS: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

export function ProductArt({
  art,
  size = 96,
  className,
}: {
  art: ArtKey;
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
      {ART[art] ?? ART.macaron}
    </svg>
  );
}

/**
 * A product image: tinted panel with the illustration centred.
 * `fill` makes it absolute-fill its (relatively positioned) parent.
 */
export function ProductImage({
  art,
  tint,
  alt,
  size = 96,
  rounded = "rounded-2xl",
  className = "",
  fill = false,
}: {
  art: ArtKey;
  tint: Tint;
  alt: string;
  size?: number;
  rounded?: string;
  className?: string;
  fill?: boolean;
}) {
  const box = fill
    ? `absolute inset-0 flex items-center justify-center ${TINT_CLASS[tint]} ${rounded} ${className}`
    : `flex shrink-0 items-center justify-center ${TINT_CLASS[tint]} ${rounded} ${className}`;

  return (
    <div
      className={box}
      style={fill ? undefined : { width: size, height: size }}
      role="img"
      aria-label={alt}
    >
      <ProductArt art={art} size={fill ? size : Math.round(size * 0.72)} />
    </div>
  );
}
