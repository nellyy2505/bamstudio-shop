import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs, ButtonLink, Icon } from "@/components/ui";
import type { IconName } from "@/components/ui";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  SHOP,
  transitRangeLabel,
} from "@/lib/config";
import {
  hasSocialAccount,
  hasStudioMailbox,
  sendsOrderConfirmation,
} from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { money } from "@/lib/format";
import { getScoopTiers } from "@/lib/queries";
import { selfCanonical } from "../seo";

export const metadata: Metadata = {
  ...selfCanonical("/faq"),
  title: "Help centre",
  description:
    "Printing times, shipping, returns, materials and custom requests for Bam Studio's 3D-printed clickers and charms.",
};

const standard = SHIPPING.methods.find((m) => m.id === "standard")!;
const express = SHIPPING.methods.find((m) => m.id === "express")!;

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would have this page answering "will I get an
 * email?" wrongly in both directions. Low traffic; it can afford the render.
 */
export const dynamic = "force-dynamic";

/**
 * Whether the shop can send at all. Server component, so this reads the same
 * `RESEND_API_KEY` / `EMAIL_FROM` secrets the Stripe webhook does.
 * `hasStudioMailbox` - is `SHOP.supportEmail` a real address rather than the
 * `[HELLO@YOURDOMAIN]` placeholder - comes from lib/contact.ts.
 */
const SENDS_CONFIRMATION = sendsOrderConfirmation(isEmailConfigured());

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
    body: `Printed in ${PRINT_LEAD_TIME.label}, then posted. Standard post is half-price from ${money(SHIPPING.subsidyThreshold)} and free from ${money(SHIPPING.freeThreshold)}.`,
    href: "#shipping",
    linkText: "Delivery times",
  },
  {
    icon: "box",
    title: "Returns & exchanges",
    body: "30 days to change your mind on stock designs. Personalised pieces excluded.",
    href: "#returns",
    linkText: "Return rules",
  },
  {
    icon: "sparkle",
    title: "Custom & personalised",
    body: "Name charms, colour swaps and one-off designs.",
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
          Everything is printed to order, so allow{" "}
          <strong className="text-ink">{PRINT_LEAD_TIME.label}</strong> for
          printing and packing before dispatch. Follow it on{" "}
          <Link
            href="/track"
            className="font-bold text-accent underline underline-offset-2"
          >
            your order
          </Link>{" "}
          with your order number and email.{" "}
          {/* This used to say "the tracking number appears on your order as
              soon as it is posted", flat, with no condition on it. Not every
              parcel has one: quoteBasket() returns `tracked: false` for a Large
              Letter, and the studio's dispatch panel has an explicit "posted
              without tracking - there is no number to follow" answer that
              writes SQL NULL. /track now words that step off the order's own
              tracking_number, and this page must not promise what that page
              cannot deliver. */}
          Tracked parcels show their tracking number there once posted. Small
          orders may go as untracked letters, and the page will say so.{" "}
          {/* Gated on the secrets the webhook checks. We never email a dispatch
              or tracking notice in any configuration, so that denial is flat;
              the confirmation email is where the order number comes from when
              one is sent, which is worth saying because /track needs it. */}
          {SENDS_CONFIRMATION
            ? "We email your order confirmation and number when you pay. Dispatch and tracking updates appear on your order page, not by email."
            : "We don't email confirmations, dispatch notices or tracking numbers, so check your order page."}
        </p>
        <p>
          {/* No flat price and no tracking claim here on purpose. Postage is
              quoted per basket from Australia Post (lib/shipping/), so a fixed
              figure on this page would be wrong for most baskets, and whether a
              parcel is tracked depends on the service the quote picks - which
              this page has no basket to ask about. The free threshold below is
              the shop's own promotion and is a fact this page does know. */}
          After dispatch: {standard.label.toLowerCase()} post takes{" "}
          {transitRangeLabel(standard.id)} and express takes{" "}
          {transitRangeLabel(express.id)}. Postage is based on your basket&rsquo;s
          weight at Australia Post rates and shown before you pay.{" "}
          {standard.label} post is half-price from{" "}
          {money(SHIPPING.subsidyThreshold)} and free from{" "}
          {money(SHIPPING.freeThreshold)}. Express speeds up the post, not the
          printing, and is always charged in full.
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
          Return stock designs within{" "}
          <strong className="text-ink">30 days</strong> of delivery, unused and
          in original packaging, for a refund of the item price. Return postage
          is yours unless the item is faulty or not what you ordered.
        </p>
        <p>
          <strong className="text-ink">
            Personalised items (anything with a name or letters you chose) can
            only be returned if faulty.
          </strong>{" "}
          They&rsquo;re made just for you, so please check spelling and colours
          before you pay. This doesn&rsquo;t limit your rights under the
          Australian Consumer Law. See our{" "}
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
        PLA only: a hard, matte, plant-derived plastic that holds fine detail.
        Ball chains, clasps and the clicker inside are the only metal parts.
        Nothing here is food-safe or dishwasher-safe.
      </p>
    ),
  },
  {
    question: "Can I change or cancel my order after paying?",
    answer: (
      <p>
        Usually yes, if it has not been printed.{" "}
        {hasStudioMailbox ? (
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
          // With no studio mailbox there is no message form either, so this
          // sends them to the page that lists whatever channels do exist
          // rather than promising a message box.
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            Get in touch
          </Link>
        )}{" "}
        with your order number as soon as you can. Colour swaps, address fixes
        and cancellations are easy before printing starts. After that we
        can&rsquo;t change it, and personalised pieces usually start first.
      </p>
    ),
  },
  {
    id: "custom",
    question: "Do you take custom design requests?",
    answer: (
      <>
        <p>
          Yes. Send us your idea and how many you need, and we&rsquo;ll tell you
          if it&rsquo;s printable, the cost and the timing. Colour swaps are
          usually easy; a new shape needs modelling and a test print.
        </p>
        <p>
          We never print licensed characters (cartoon, film, game or brand),
          even as a &quot;close enough&quot; version.
        </p>
      </>
    ),
  },
  {
    question: "Where can I find you in person?",
    answer: (
      // The next stall was an unfilled [MARKET NAME AND DATE] placeholder and
      // there is no newsletter to check, so this promises neither: it says
      // only what can be honoured, and asks people to check before travelling.
      <p>
        At {SHOP.city} weekend markets, with our DIY letter-charm bar. Dates
        change, so{" "}
        {hasSocialAccount ? (
          "check our social accounts"
        ) : (
          <Link
            href="/contact"
            className="font-bold text-accent underline underline-offset-2"
          >
            ask us
          </Link>
        )}{" "}
        before you travel.
      </p>
    ),
  },
  {
    question: "How do I look after a printed piece?",
    answer: (
      <>
        <p>
          Wipe with a damp cloth. No dishwasher, boiling water or soaking. PLA
          softens in heat, so keep it off car dashboards and sunny windowsills.
        </p>
        <p>
          Clickers loosen slightly with use as they wear in. If one stops
          clicking properly, let us know.
        </p>
      </>
    ),
  },
];

/**
 * The scoop answer, and why it is conditional.
 *
 * A help centre answers questions people are actually in a position to ask.
 * Nothing is seeded, `getScoopTiers()` carries no sample tier, and this page is
 * already `force-dynamic` - so the entry is added only when a bowl exists, and
 * on a shop with no scoops the question simply is not there rather than
 * describing a product that cannot be bought.
 *
 * What it does not say is as deliberate as what it does. Nothing about whether
 * the same design can come out twice (an unsettled owner decision - a sentence
 * either way would settle it), and nothing about the filming, which is a habit
 * rather than a term of sale and has no business in an answer about what you
 * are buying.
 */
const SCOOP_FAQ: { id?: string; question: string; answer: ReactNode } = {
  id: "scoop",
  question: "What exactly do I get in a Lucky Scoop?",
  answer: (
    <>
      <p>
        A set number of pieces from a list you can see before you pay. Each
        bowl on the{" "}
        <Link
          href="/scoop"
          className="font-bold text-accent underline underline-offset-2"
        >
          Lucky Scoop page
        </Link>{" "}
        shows how many pieces you get and every piece it draws from.
      </p>
      <p>
        We pick your pieces from the bowl by hand when we pack, so we
        can&rsquo;t take requests. If a bag arrives short or with something not
        on that bowl&rsquo;s list, see the{" "}
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
};

export default async function FaqPage() {
  /*
   * One read, one decision: is there a bowl to answer questions about? The
   * `sellable` gate the home page and the sitemap use is deliberately NOT
   * applied - a published tier is something a reader can see on the shop and
   * ask about, and a help centre answers the questions people can ask, not the
   * ones they can act on.
   *
   * The old wording justified that by "published but temporarily empty", which
   * described a stock gate inside `sellable` that no longer exists. The shop
   * prints to order, a short bowl is a print job, and emptiness has not decided
   * anything about a tier since (lib/scoop.ts). The distinction the line above
   * actually rests on is narrower: a tier can be published and still unpriced.
   */
  const scoopsPublished = (await getScoopTiers()).length > 0;

  const faqs = [...FAQS];
  if (scoopsPublished) {
    // Immediately before the returns answer: "what exactly do I get" and "can I
    // send it back" are the two questions a surprise bag raises, in that order.
    // Found by id rather than index so reordering the list above cannot silently
    // drop it somewhere odd.
    const returnsAt = faqs.findIndex((faq) => faq.id === "returns");
    if (returnsAt === -1) faqs.push(SCOOP_FAQ);
    else faqs.splice(returnsAt, 0, SCOOP_FAQ);
  }

  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Help centre" }]} />

      <div className="mx-auto max-w-2xl text-center">
        <h1 className="mb-2.5 text-3xl md:text-4xl">How can we help?</h1>
        <p className="text-muted">
          Printing times, postage, returns and more.
        </p>
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
          {faqs.map((faq) => (
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
            {/* The reply promise only holds if a message can reach the studio
                mailbox at all - without one there is nobody to read it. The
                "usually within a couple of days" clock is gone: nothing here
                measures or guarantees a turnaround, /contact says so outright,
                and the same claim was removed from the product page, the
                contact form and /order/confirmed on that principle. */}
            <p className="mt-1.5 max-w-[46ch] text-[14.5px] text-muted">
              {hasStudioMailbox
                ? "Can't find your answer? Send us a note."
                : "Can't find your answer? Here's how to reach us."}
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
