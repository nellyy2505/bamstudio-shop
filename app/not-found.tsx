import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Icon } from "@/components/ui";

export const metadata: Metadata = {
  title: "Page not found",
  description:
    "We couldn't find that page. Head back to the shop for clickers, charms and desk pieces.",
};

export default function NotFound() {
  return (
    <div className="wrap flex flex-col items-center py-20 text-center">
      <div className="flex items-center justify-center gap-4 sm:gap-7">
        {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
        <img src="/products/macaron/2-sm.jpg" alt="" className="h-24 w-24 rotate-[-8deg] rounded-3xl object-cover sm:h-28 sm:w-28" />
        <p className="font-display text-[76px] leading-none font-bold text-ink sm:text-[104px]">
          404
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
        <img src="/products/heart-waffle/1-sm.jpg" alt="" className="h-24 w-24 rotate-[8deg] rounded-3xl object-cover sm:h-28 sm:w-28" />
      </div>

      <h1 className="mt-9 text-3xl md:text-4xl">
        This page wandered off the shelf
      </h1>
      <p className="mt-3 max-w-[46ch] text-muted">
        The link may be broken or the product retired. The good stuff is one
        click away.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3.5">
        <ButtonLink href="/shop" size="lg">
          Shop everything
        </ButtonLink>
        <ButtonLink href="/shop?sort=popular" variant="ghost" size="lg">
          <Icon name="trend" size={18} />
          Shop bestsellers
        </ButtonLink>
      </div>

      <p className="mt-7 text-[13px] text-muted">
        Looking for a parcel?{" "}
        <Link
          href="/track"
          className="font-bold text-accent underline underline-offset-2"
        >
          Track your order
        </Link>{" "}
        or{" "}
        <Link
          href="/contact"
          className="font-bold text-accent underline underline-offset-2"
        >
          ask us
        </Link>
        .
      </p>
    </div>
  );
}
