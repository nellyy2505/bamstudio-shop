import type { Metadata } from "next";
import { ProductArt } from "@/components/ProductArt";
import { Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
import type { IconName } from "@/components/ui";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import { canReachStudio, hasSocialAccount } from "@/lib/contact";
import type { ArtKey, Tint } from "@/lib/types";

export const metadata: Metadata = {
  title: "Our story",
  description:
    "Bam Studio is three family members and one 3D printer — designed together, printed to order in Sydney, kept deliberately small.",
};

/*
 * `canReachStudio` and `hasSocialAccount` come from lib/contact.ts — the same
 * mailbox-or-social test /track, /contact and the legal pages use. The on-site
 * contact form is deliberately not counted: it delivers by emailing the studio
 * mailbox, so it is not a channel on its own.
 *
 * Nothing on this page claims the shop sends email, so no capability is read
 * here.
 */

/** Tailwind scans source statically, so tint classes must appear literally. */
const TINT_BG: Record<Tint, string> = {
  blush: "bg-blush",
  butter: "bg-butter",
  sage: "bg-sage",
  sky: "bg-sky",
  lilac: "bg-lilac",
  cream: "bg-cream",
};

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
    body: "There are three of us. One is here in Sydney running the printer and the market stall; two sisters in Vietnam draw and model the designs. A shape only gets printed once all three of us like it, which is slower than it sounds and much more fun.",
    art: "macaron",
    tint: "blush",
  },
  {
    icon: "box",
    title: "Printed to order",
    body: `One FlashForge printer, PLA plastic, no warehouse. Your pieces go on the print bed after you order them — that is why we ask for ${PRINT_LEAD_TIME.label} before anything is dispatched. Every one comes off the bed, gets its edges checked and is packed by hand.`,
    art: "matcha",
    tint: "sage",
  },
  {
    icon: "sparkle",
    title: "Small on purpose",
    body: "Small means we answer our own messages, retire a design when we have grown tired of it, and print something strange just to see whether anyone else likes it too. It also means we cannot make thousands of anything, and we are happy with that.",
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
            {SHOP.name} is a very small studio making fidget clickers, charms and
            desk pieces in {SHOP.city}. No factory, no licensing deals, no
            minimum order of five hundred — just three people who could not stop
            printing little things.
          </p>
        </div>
      </section>

      <section className="wrap pt-14">
        <div className="grid gap-5 md:grid-cols-3">
          {CARDS.map((card) => (
            <article key={card.title} className="card flex flex-col p-6">
              <span
                className={`flex h-20 w-20 items-center justify-center rounded-2xl ${TINT_BG[card.tint]}`}
              >
                <ProductArt art={card.art} size={54} />
              </span>
              <h2 className="mt-5 flex items-center gap-2 text-xl">
                <Icon name={card.icon} size={18} className="text-accent" />
                {card.title}
              </h2>
              <p className="mt-2.5 text-[14.5px] text-muted">{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="wrap pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 rounded-[26px] border-2 border-dashed border-line2 bg-cream p-8 text-center">
            <Icon name="camera" size={34} className="text-faint" />
            {/* Was a bracketed [PHOTO: ...] placeholder rendered to customers.
                The frame stays — there is no studio photo yet and inventing one
                is not an option — but it now reads as a plain note rather than
                unfilled copy someone forgot to replace. */}
            <p className="max-w-[34ch] text-[13.5px] font-extrabold text-muted">
              A photo of the printer mid-run goes here, with a bed of finished
              pieces waiting to be trimmed.
            </p>
            <p className="text-xs text-faint">
              We have not photographed the studio yet.
            </p>
          </div>

          <div>
            <h2 className="mb-4 text-[28px] leading-tight lg:text-[32px]">
              It started as a folder of saved videos
            </h2>
            <div className="flex flex-col gap-4 text-[15.5px] text-muted">
              <p>
                Before there was a shop there was a saved-video collection: hours
                of tiny printed things, quietly hoarded and re-watched. The first
                real range was just that collection made physical — the pieces we
                had saved most often, redrawn in our own way so we could actually
                print and sell them.
              </p>
              <p>
                Somewhere in there a house style appeared without us deciding on
                one. Every plant design sits in the same pot silhouette, so a
                tulip, a cactus and whatever we print next all line up on a shelf
                like a set rather than a pile. Once we noticed we were doing it,
                we kept doing it on purpose.
              </p>
              <p>
                Every design is drawn by us. We do not print licensed characters
                — not as a smaller version, not as a &quot;inspired by&quot;, not
                for a custom request. It is the one rule we have never bent, and
                it is why the range looks the way it does.
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
                this says only what holds — the same wording /faq and /contact
                settled on. Holding a piece aside needs somewhere to ask, so
                that half is gated the way /track gates "message us". */}
            <p className="mb-7 max-w-[460px] text-[#BDB6AA]">
              We take the stall to {SHOP.city} weekend markets, with the DIY
              letter-charm bar set up so you can spell a name on the spot and
              take it home the same afternoon. Dates move around and we do not
              have the next one confirmed here yet, so it is worth checking
              before you make the trip
              {hasSocialAccount ? " — our social accounts have the latest" : ""}.
              {canReachStudio
                ? " Message us if you want us to hold something aside, or if you are after a custom design."
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
                    page says so — the button must not promise more than it. */}
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
            <span className="flex h-28 w-28 items-center justify-center rounded-3xl bg-blush">
              <ProductArt art="letters" size={80} />
            </span>
            <span className="mt-8 flex h-28 w-28 items-center justify-center rounded-3xl bg-butter">
              <ProductArt art="tulip" size={80} />
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
