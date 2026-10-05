import type { Metadata } from "next";
import { Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import { canReachStudio, hasSocialAccount } from "@/lib/contact";
import type { ArtKey, Tint } from "@/lib/types";
import { selfCanonical } from "../seo";

export const metadata: Metadata = {
  ...selfCanonical("/about"),
  title: "Our story",
  description:
    "Bam Studio is a small family studio making 3D-printed clickers and charms, printed to order in Wollongong.",
};

/*
 * `canReachStudio` and `hasSocialAccount` come from lib/contact.ts - the same
 * mailbox-or-social test /track, /contact and the legal pages use. The on-site
 * contact form is deliberately not counted: it delivers by emailing the studio
 * mailbox, so it is not a channel on its own.
 *
 * Nothing on this page claims the shop sends email, so no capability is read
 * here.
 */

/** One photo per story card, in card order. */
const CARD_PHOTOS = [
  "/products/love-cactus-planters/1-sm.jpg",
  "/products/home/letters-tray-sm.jpg",
  "/products/moon-book-box/2-sm.jpg",
];

const CARDS: {
  icon: IconName;
  title: string;
  body: string;
  art: ArtKey;
  tint: Tint;
}[] = [
  {
    icon: "heart",
    title: "Designed as a family",
    body: "One of us runs the printer and market stall in Wollongong. Two sisters in Vietnam draw the designs. A piece is only printed once all three of us love it.",
    art: "macaron",
    tint: "blush",
  },
  {
    icon: "box",
    title: "Printed to order",
    body: `Your pieces are printed after you order, so allow ${PRINT_LEAD_TIME.label} before dispatch. Each one is checked and packed by hand.`,
    art: "matcha",
    tint: "sage",
  },
  {
    icon: "sparkle",
    title: "Small on purpose",
    body: "We read our own messages and try new ideas often. We like it that way.",
    art: "cactus",
    tint: "butter",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="border-b border-line bg-sage">
        <div className="wrap py-14 lg:py-16">
          <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Our story" }]} />
          <Pill tone="surface" className="text-accent-dark">
            Our story
          </Pill>
          <h1 className="mt-4 mb-4 max-w-[15ch] text-[36px] leading-[1.08] font-bold sm:text-[44px] lg:text-[50px]">
            Three of us, one printer, a lot of clicking.
          </h1>
          <p className="max-w-[520px] text-[17px] text-[#5C564C]">
            {SHOP.name} is a small family studio making fidget clickers, charms
            and desk pieces in {SHOP.city}.
          </p>
        </div>
      </section>

      <section className="wrap pt-14">
        <div className="grid gap-5 md:grid-cols-3">
          {CARDS.map((card, i) => (
            <article key={card.title} className="card flex flex-col overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
              <img
                src={CARD_PHOTOS[i % CARD_PHOTOS.length]}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="px-6 pb-6">
              <h2 className="mt-5 flex items-center gap-2 text-xl">
                <Icon name={card.icon} size={18} className="text-accent" />
                {card.title}
              </h2>
              <p className="mt-2.5 text-[14.5px] text-muted">{card.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
          <img
            src="/products/home/flatlay-sm.jpg"
            alt="A desk covered in our keychains: name charms, a macaron, a heart waffle and a cake box"
            loading="lazy"
            className="aspect-[4/3] w-full rounded-[26px] object-cover"
          />

          <div>
            <h2 className="mb-4 text-[28px] leading-tight lg:text-[32px]">
              It started with saved videos
            </h2>
            <div className="flex flex-col gap-4 text-[15.5px] text-muted">
              <p>
                We spent hours saving videos of tiny printed things. Our first
                range was our favourites, redrawn in our own style.
              </p>
              <p>
                Every plant sits in the same little pot, so they line up on a
                shelf like a set.
              </p>
              <p>
                Every design is our own. We never print licensed characters, not
                even for custom orders.
              </p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <Pill tone="line">PLA plastic only</Pill>
              <Pill tone="line">Original designs</Pill>
              <Pill tone="line">Printed in {SHOP.city}</Pill>
            </div>
          </div>
        </div>
      </section>

      <section className="wrap pt-16">
        <div className="grid items-center gap-8 rounded-[26px] bg-ink px-8 py-12 text-[#F6F2EA] lg:grid-cols-[1.2fr_1fr] lg:px-14">
          <div>
            <Pill className="bg-[#3B3630] text-[#F3C89B]">
              Weekend markets in {SHOP.city}
            </Pill>
            <h2 className="mt-4 mb-3 text-[28px] leading-tight text-[#F6F2EA] lg:text-[34px]">
              Come and click one before you buy it
            </h2>
            {/* "Next stall" was an unfilled [MARKET NAME AND DATE] placeholder.
                Naming a market we have not booked is worse than naming none, so
                this says only what holds - the same wording /faq and /contact
                settled on. Holding a piece aside needs somewhere to ask, so
                that half is gated the way /track gates "message us". */}
            <p className="mb-7 max-w-[460px] text-[#BDB6AA]">
              Spell a name at our DIY letter-charm bar and take it home the same
              day. Dates change, so check before you visit
              {hasSocialAccount ? " (our socials have the latest)" : ""}.
              {canReachStudio
                ? " Message us to hold something aside or ask about a custom design."
                : ""}
            </p>
            <div className="flex flex-wrap gap-3.5">
              <ButtonLink
                href="/contact"
                className="bg-[#F6F2EA] text-ink hover:bg-white"
              >
                <Icon name="msg" size={18} />
                {/* Same call as /track: with no mailbox and no social account
                    there is nothing to get in touch through, and the contact
                    page says so - the button must not promise more than it. */}
                {canReachStudio ? "Get in touch" : "How to reach us"}
              </ButtonLink>
              <ButtonLink
                href="/shop"
                className="bg-[#3B3630] text-[#F6F2EA] hover:bg-[#4A443C]"
              >
                Browse the range
              </ButtonLink>
            </div>
          </div>

          <div className="flex justify-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img src="/products/custom-name-charm/3-sm.jpg" alt="" loading="lazy" className="h-32 w-32 rounded-3xl object-cover" />
            {/* eslint-disable-next-line @next/next/no-img-element -- static site photo */}
            <img src="/products/matcha-set/2-sm.jpg" alt="" loading="lazy" className="mt-8 h-32 w-32 rounded-3xl object-cover" />
          </div>
        </div>
      </section>
    </>
  );
}
