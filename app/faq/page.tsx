import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs, ButtonLink, Icon } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { PRINT_LEAD_TIME, SHIPPING, SHOP, transitLabel } from "@/lib/config";
import { money } from "@/lib/format";

export const metadata: Metadata = {
  title: "Help centre",
  description:
    "Answers on printing times, shipping, returns, materials, custom requests and market dates for Bam Studio's 3D-printed clickers and charms.",
};

const standard = SHIPPING.methods.find((m) => m.id === "standard")!;
const express = SHIPPING.methods.find((m) => m.id === "express")!;

const CATEGORIES: {
  icon: IconName;
  title: string;
  body: string;
  href: string;
  linkText: string;
}[] = [
  {
    icon: "truck",
    title: "Shipping & delivery",
    body: `Printing takes ${PRINT_LEAD_TIME.label}, then it posts. Free standard shipping from ${money(SHIPPING.freeThreshold)}.`,
    href: "#shipping",
    linkText: "Delivery times",
  },
  {
    icon: "box",
    title: "Returns & exchanges",
    body: "30 days to change your mind on stock designs. Personalised pieces are the exception.",
    href: "#returns",
    linkText: "Return rules",
  },
  {
    icon: "sparkle",
    title: "Custom & personalised",
    body: "Name charms, colour swaps and one-off design requests — what we can and cannot make.",
    href: "#custom",
    linkText: "Custom requests",
  },
];

const FAQS: { id?: string; question: string; answer: ReactNode }[] = [
  {
    id: "shipping",
    question: "How long until my order ships?",
    answer: (
      <>
        <p>
          Everything is printed to order on one printer, so allow{" "}
          <strong className="text-ink">{PRINT_LEAD_TIME.label}</strong> for
          printing, checking and packing before your parcel is dispatched. You
          will get a tracking number by email the moment it goes out.
        </p>
        <p>
          After dispatch: {standard.label.toLowerCase()} post is{" "}
          {money(standard.price)} ({transitLabel(standard.id)}) and express is{" "}
          {money(express.price)} ({transitLabel(express.id)}). Standard shipping is
          free once your order reaches{" "}
          {money(SHIPPING.freeThreshold)}. Express speeds up the post, not the
          printing — the print time still applies.
        </p>
      </>
    ),
  },
  {
    id: "returns",
    question: "Can I return something? What about name charms?",
    answer: (
      <>
        <p>
          Stock designs can come back to us within{" "}
          <strong className="text-ink">30 days</strong> of delivery, unused and
          in their original packaging, and we will refund the item price. Return
          postage is yours unless the item was faulty or not what you ordered.
        </p>
        <p>
          <strong className="text-ink">
            Personalised items — anything with a name or letters you chose — can
            only be returned if they are faulty.
          </strong>{" "}
          They are printed for you specifically and cannot be resold, so please
          check the spelling and colours before you pay. None of this limits your
          rights under the Australian Consumer Law: if something arrives faulty,
          you are covered either way. Full detail is in our{" "}
          <Link
            href="/legal/refunds"
            className="font-bold text-accent underline underline-offset-2"
          >
            refund policy
          </Link>
          .
        </p>
      </>
    ),
  },
  {
    question: "What are your pieces made of?",
    answer: (
      <p>
        PLA plastic, and only PLA. It is a hard, matte, plant-derived filament —
        it holds fine detail, takes colour well and does not smell. Clicker
        mechanisms, charms and stands are all printed from it; keyrings, cords
        and phone straps are the only metal or fabric parts. We do not print in
        resin, so nothing here is food-safe or dishwasher-safe.
      </p>
    ),
  },
  {
    question: "Can I change or cancel my order after paying?",
    answer: (
      <p>
        Usually yes, if it has not been printed.{" "}
        {SHOP.hasSupportEmail ? (
          <>
            Email us at{" "}
            <a
              href={`mailto:${SHOP.supportEmail}`}
              className="font-bold text-accent underline underline-offset-2"
            >
              {SHOP.supportEmail}
            </a>
          </>
        ) : (
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            Send us a message
          </Link>
        )}{" "}
        with your order number as soon as you can — colour swaps, address fixes
        and cancellations are all easy before a piece goes on the bed. Once
        printing has started we cannot un-print it, and personalised pieces
        usually start first.
      </p>
    ),
  },
  {
    id: "custom",
    question: "Do you take custom design requests?",
    answer: (
      <>
        <p>
          We do. Send us the idea and roughly how many you want, and we will tell
          you honestly whether it is printable, what it would cost and how long
          it would take. Simple colour swaps on an existing design are usually
          easy; a brand new shape needs modelling time and a test print or two.
        </p>
        <p>
          The one thing we will always say no to is licensed characters — no
          cartoon, film, game or brand characters, even as a &quot;close
          enough&quot; version. Every design we sell is our own, and we would
          like to keep it that way.
        </p>
      </>
    ),
  },
  {
    question: "Where can I find you in person?",
    answer: (
      <p>
        We run a stall at {SHOP.city} weekend markets, with the DIY letter-charm
        bar so you can spell a name and take it home the same day. Our next stall
        is [MARKET NAME AND DATE]. Dates move around, so the newsletter and our
        social accounts are the most reliable place to check before you travel.
      </p>
    ),
  },
  {
    question: "How do I look after a printed piece?",
    answer: (
      <>
        <p>
          Wipe it with a damp cloth and let it dry — no dishwasher, no boiling
          water, no soaking. PLA softens in real heat, so the worst place for a
          clicker or a phone stand is a car dashboard or a sunny windowsill in
          summer.
        </p>
        <p>
          Clickers are meant to be clicked and will loosen slightly with use;
          that is the mechanism wearing in, not breaking. If one ever stops
          clicking properly, tell us — we would rather fix it than have it sit in
          a drawer.
        </p>
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Help centre" }]} />

      <div className="mx-auto max-w-2xl text-center">
        <h1 className="mb-2.5 text-3xl md:text-4xl">How can we help?</h1>
        <p className="text-muted">
          Printing times, postage, returns and the questions we get asked at the
          market stall every single weekend.
        </p>

        {/* Decorative only — the real search lives in the header. */}
        <div
          aria-hidden="true"
          className="mx-auto mt-7 flex h-[52px] max-w-xl items-center gap-3 rounded-full border-2 border-line2 bg-surface px-5"
        >
          <Icon name="search" size={20} className="shrink-0 text-faint" />
          <span className="truncate text-[15px] text-faint">
            Search the help centre — coming soon
          </span>
        </div>
      </div>

      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {CATEGORIES.map((category) => (
          <article key={category.title} className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream">
              <Icon name={category.icon} size={22} />
            </span>
            <h2 className="mt-4 text-lg">{category.title}</h2>
            <p className="mt-1.5 text-[14px] text-muted">{category.body}</p>
            <Link
              href={category.href}
              className="mt-3.5 inline-flex items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
            >
              {category.linkText}
              <Icon name="arrow" size={14} />
            </Link>
          </article>
        ))}
      </div>

      <section className="mx-auto mt-14 max-w-3xl">
        <h2 className="mb-5 text-2xl md:text-[27px]">Common questions</h2>
        <div className="flex flex-col gap-3">
          {FAQS.map((faq) => (
            <details
              key={faq.question}
              id={faq.id}
              className="card group scroll-mt-24 px-5 py-4 open:bg-cream"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
                {faq.question}
                <Icon
                  name="chev"
                  size={18}
                  className="shrink-0 text-muted transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="mt-3 flex flex-col gap-3 text-[14.5px] text-muted">
                {faq.answer}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-3xl">
        <div className="card flex flex-col items-start gap-5 bg-blush p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl">Still stuck?</h2>
            <p className="mt-1.5 max-w-[46ch] text-[14.5px] text-muted">
              If your question is not here, write to us. It is one of us reading
              it, usually within a couple of days.
            </p>
          </div>
          <ButtonLink href="/contact" className="shrink-0">
            <Icon name="msg" size={18} />
            Contact us
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
