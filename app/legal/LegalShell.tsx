import type { ReactNode } from "react";
import Link from "next/link";
import { Alert, Breadcrumbs } from "@/components/ui";

/** Every policy here is an unreviewed draft, so the notice is not optional. */
export function LegalShell({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="wrap pt-8 pb-4">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: title }]}
      />

      <article className="mx-auto max-w-3xl">
        <h1 className="mb-2.5 text-3xl md:text-4xl">{title}</h1>
        <p className="mb-5 text-muted">{intro}</p>

        <Alert tone="info">
          This is a starting draft, not legal advice. Have it reviewed by an
          Australian legal adviser and replace every bracketed placeholder before
          the shop goes live.
        </Alert>

        <p className="mt-4 text-[13px] font-extrabold text-faint">
          Last updated: {updated}
        </p>

        <div className="mt-8 flex flex-col gap-4 text-[15px] leading-relaxed text-muted [&_h2]:mt-7 [&_h2]:text-[19px] [&_h2]:text-ink [&_li]:mt-1.5 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>

        <div className="mt-10 flex flex-wrap gap-4 border-t border-line pt-5 text-[13.5px]">
          <Link
            href="/legal/privacy"
            className="font-bold text-accent underline underline-offset-2"
          >
            Privacy policy
          </Link>
          <Link
            href="/legal/terms"
            className="font-bold text-accent underline underline-offset-2"
          >
            Terms of service
          </Link>
          <Link
            href="/legal/refunds"
            className="font-bold text-accent underline underline-offset-2"
          >
            Refund policy
          </Link>
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            Contact us
          </Link>
        </div>
      </article>
    </div>
  );
}
