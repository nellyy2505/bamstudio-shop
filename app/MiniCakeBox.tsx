"use client";

import Link from "next/link";
import { useState } from "react";
import { cx } from "@/components/ui";

/**
 * A taste of the cake box builder on the home page: tap pastries to fill the
 * spots, then carry the picks to /bakery, where the real builder takes over.
 *
 * Nothing is added to the basket from here. The picks travel as ?fill=..., the
 * bakery page drops anything it does not offer, and checkout prices the box
 * from the database as always. The price shown is the one the server read.
 */
export type MiniFilling = { slug: string; name: string; src: string };

export function MiniCakeBox({
  fillings,
  capacity,
  price,
}: {
  fillings: MiniFilling[];
  capacity: number;
  /** Already formatted by the server, or null when the box has no price yet. */
  price: string | null;
}) {
  const [picks, setPicks] = useState<string[]>(() => fillings.slice(0, 2).map((f) => f.slug));
  const bySlug = new Map(fillings.map((f) => [f.slug, f]));
  const left = capacity - picks.length;
  const full = left <= 0;

  return (
    <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.1fr]">
      <div>
        <p className="mb-2 text-[13px] font-extrabold tracking-[0.12em] text-accent uppercase">
          Design your own
        </p>
        <h2 className="mb-3.5 text-[34px] leading-[1.02] md:text-[44px]">
          Fill a cake box,
          <br />
          your way.
        </h2>
        <p className="mb-6 max-w-[420px] text-[17px] text-[#5C4E45]">
          Tap {capacity} pastries to try it. Doubles welcome. One price whatever goes in.
        </p>
        <div className="mb-6 flex gap-3" aria-label="Your box">
          {Array.from({ length: capacity }, (_, i) => {
            const pick = picks[i] ? bySlug.get(picks[i]) : undefined;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setPicks((cur) => cur.filter((_, j) => j !== i))}
                disabled={!pick}
                aria-label={pick ? `Take out ${pick.name}` : "Empty spot"}
                className={cx(
                  "flex h-[76px] w-[76px] items-center justify-center rounded-[20px] border-2 border-dashed md:h-[84px] md:w-[84px]",
                  pick ? "border-white bg-white" : "border-[#D9A595] bg-white/50",
                )}
              >
                {pick ? (
                  // eslint-disable-next-line @next/next/no-img-element -- static site artwork
                  <img key={`${pick.slug}-${i}`} src={pick.src} alt="" className="bam-pop h-[80%] w-[80%] object-contain" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href={`/bakery?fill=${picks.join(",")}#build`}
            className={cx(
              "inline-flex h-14 items-center rounded-full px-7 text-[16px] font-extrabold text-white",
              full ? "bg-accent hover:bg-accent-dark" : "bg-[#C99B88] hover:bg-accent",
            )}
          >
            {full ? "Finish this box" : `Pick ${left} more`}
          </Link>
          {price ? <span className="font-display text-[30px] font-semibold">{price}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2.5 md:gap-3">
        {fillings.map((f) => (
          <button
            key={f.slug}
            type="button"
            disabled={full}
            onClick={() => setPicks((cur) => (cur.length < capacity ? [...cur, f.slug] : cur))}
            className={cx(
              "flex flex-col items-center gap-1.5 rounded-[20px] bg-white px-1.5 pt-3 pb-2.5 transition duration-200",
              full ? "opacity-55" : "hover:-translate-y-0.5 hover:shadow-[0_10px_22px_rgba(43,39,36,0.14)]",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- static site artwork */}
            <img src={f.src} alt="" loading="lazy" className="h-14 w-14 object-contain md:h-[72px] md:w-[72px]" />
            <span className="text-center text-[11.5px] leading-tight font-extrabold">{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
