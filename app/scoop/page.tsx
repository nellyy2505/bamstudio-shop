import type { Metadata } from "next";
import Link from "next/link";
import { ScoopArt } from "@/components/scoop/ScoopArt";
import { Breadcrumbs, ButtonLink, EmptyState, Icon, Pill } from "@/components/ui";
import { hasSocialAccount, socialLinks } from "@/lib/contact";
import { money, pluralise } from "@/lib/format";
import { getScoopTiers } from "@/lib/queries";
import { SCOOP_THEMES } from "@/lib/types";
import type { ScoopTierListing } from "@/lib/queries";
import { selfCanonical } from "../seo";

export const revalidate = 300;

export const metadata: Metadata = {
  ...selfCanonical("/scoop"),
  title: "The Lucky Scoop",
  /*
   * Describes the mechanic, not the merchandise. There is no seeded tier and
   * nothing is priced in code (0007_lucky_scoop.sql), so a description naming a
   * price, a piece count or a theme would be a made-up figure in a search
   * result on a shop that currently sells no scoops at all.
   */
  description:
    "A bowl of small 3D-printed pieces. You choose the bowl and how many pieces; we draw them by hand from the list shown on each bowl's page.",
};

/** `theme` is a checked enum in the database; this is the label for it. */
function themeLabel(theme: ScoopTierListing["theme"]): string {
  return SCOOP_THEMES.find((option) => option.value === theme)?.label ?? "Mixed";
}

const STEPS = [
  {
    n: "1",
    title: "Pick a bowl",
    body: "Each bowl has a theme and a piece count. Everything it can draw from is listed on its page — all of it, not a sample.",
  },
  {
    n: "2",
    title: "We draw it by hand",
    body: "One of us tips the bowl out and picks your pieces when your order comes through. No randomiser, no algorithm — a person at a table.",
  },
  {
    n: "3",
    title: "Bagged and posted",
    body: "Your pieces go out with the day's orders. Postage is worked out from the weight of your basket and shown before you pay.",
  },
];

/**
 * One bowl on the landing page.
 *
 * An unsellable tier is SHOWN AND LABELLED rather than hidden. `getScoopTiers`
 * returns published tiers whether or not the pool can currently fill them, and
 * says why: a bowl that says "empty right now" is a better page than a bowl
 * that vanishes. What it must never do is offer the purchase — a tier whose
 * pool cannot fill it is one checkout would refuse, and the alternative to
 * saying so here is taking the money and finding out later.
 */
function TierCard({ tier }: { tier: ScoopTierListing }) {
  const { availability } = tier;
  const priced = tier.price_cents !== null;

  return (
    <article className="card flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-cream">
          <ScoopArt size={44} />
        </span>
        <Pill tone={availability.sellable ? "accent" : "neutral"}>
          {themeLabel(tier.theme)}
        </Pill>
      </div>

      <div>
        <h3 className="text-xl">
          <Link href={`/scoop/${tier.slug}`} className="hover:text-accent-dark">
            {tier.name}
          </Link>
        </h3>
        <p className="mt-1 text-[13.5px] font-extrabold text-muted">
          {pluralise(tier.piece_count, "piece")} drawn from{" "}
          {pluralise(tier.pool.length, "design")}
        </p>
      </div>

      {tier.blurb ? (
        <p className="text-[14px] text-muted">{tier.blurb}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-baseline gap-2">
        {/* Never a "$0.00" fallback: an unpriced tier prints no price at all. */}
        {priced ? (
          <>
            <b className="text-2xl">{money(tier.price_cents as number)}</b>
            <span className="text-[12.5px] text-muted">AUD</span>
          </>
        ) : (
          <span className="text-[13.5px] font-extrabold text-muted">
            Not priced yet
          </span>
        )}
      </div>

      {availability.sellable ? (
        <ButtonLink href={`/scoop/${tier.slug}`} full>
          See what&apos;s in it
        </ButtonLink>
      ) : (
        <>
          <p className="text-[13px] font-extrabold text-muted">
            <Icon name="clock" size={14} className="inline" /> Not being drawn
            right now
          </p>
          <ButtonLink href={`/scoop/${tier.slug}`} variant="soft" full>
            See the pool
          </ButtonLink>
        </>
      )}
    </article>
  );
}

export default async function ScoopPage() {
  const tiers = await getScoopTiers();

  return (
    <>
      <div className="border-b border-line bg-sky">
        <div className="wrap py-12 text-center">
          <Pill tone="surface" className="text-accent-dark">
            <Icon name="gift" size={14} />
            The bowl from the market stall
          </Pill>
          <h1 className="mt-3.5 mb-2 text-[32px] md:text-[40px]">
            The Lucky Scoop
          </h1>
          <p className="mx-auto max-w-2xl text-[#4F5A63] md:text-base">
            A bowl of small printed pieces — clickers, keyrings, magnets. You
            choose the bowl and how many pieces come out of it. We choose which
            ones, by hand, when your order is packed.
          </p>
        </div>
      </div>

      <div className="wrap pt-8">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Lucky Scoop" }]}
        />
      </div>

      {tiers.length > 0 ? (
        <section className="wrap pt-4">
          <h2 className="mb-6 text-2xl md:text-[27px]">Choose your bowl</h2>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {tiers.map((tier) => (
              <TierCard key={tier.id} tier={tier} />
            ))}
          </div>
        </section>
      ) : (
        /*
         * The real state of this feature today, and the page has to survive it.
         *
         * `getScoopTiers()` returns [] both when Supabase is unconfigured and
         * when nothing has been published, and it deliberately carries no
         * sample tier — a fallback bowl would need an invented price. So there
         * is nothing to advertise, and this says so instead of rendering an
         * empty grid under a "Choose your bowl" heading. The how-it-works and
         * the promise below still render: the page explains a real thing that
         * is not on sale yet, which is a page, not a 404.
         */
        <section className="wrap pt-4">
          <EmptyState
            icon={<ScoopArt size={110} />}
            title="The scoops aren’t open yet"
            body="There is no bowl to buy today. A bowl only goes up once it has a price, a piece count and a full list of the pieces it draws from — so there is nothing here until all three are true."
          >
            <ButtonLink href="/shop">Shop everything</ButtonLink>
            <ButtonLink href="/builder" variant="ghost">
              <Icon name="sparkle" size={18} />
              Design your own
            </ButtonLink>
          </EmptyState>
        </section>
      )}

      <section className="wrap pt-16">
        <h2 className="mb-6 text-2xl md:text-[27px]">How a scoop works</h2>
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map((step) => (
            <div key={step.n} className="card p-6">
              <span className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-cream font-display font-bold">
                {step.n}
              </span>
              <b className="text-[15px]">{step.title}</b>
              <p className="mt-1.5 text-[13.5px] text-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/*
        The reason the pool is on every bowl's page.

        Goods have to match their description. "Five pieces drawn from these
        twelve" is a description this shop can keep; "a scoop" is not one at
        all. So the list is the product copy, not decoration, and this panel
        says out loud which part is fixed and which part is left open.

        Note what is NOT claimed anywhere on this page: whether the same piece
        can come out twice. That is an unsettled decision, and a shopfront
        sentence either way would settle it on the owner's behalf.
      */}
      <section className="wrap pt-16">
        <div className="card grid gap-8 bg-cream p-8 md:grid-cols-2 md:p-10">
          <div>
            <h2 className="mb-3 text-xl">What a bowl tells you</h2>
            <ul className="flex flex-col gap-2.5 text-[14.5px] text-muted">
              <li className="flex items-start gap-2.5">
                <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
                <span>
                  <b className="text-ink">How many pieces you get.</b> That
                  number is the bowl — it is not a range and it does not vary.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
                <span>
                  <b className="text-ink">Every piece it can draw.</b> The full
                  pool is listed on the bowl&rsquo;s page as ordinary products
                  you can click into. Nothing outside that list goes in the bag.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
                <span>
                  <b className="text-ink">Who picks.</b> We do, by hand. You
                  cannot choose your pieces and we cannot take requests for
                  particular ones — that is what makes it a scoop.
                </span>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-xl">What it leaves open</h2>
            <p className="text-[14.5px] text-muted">
              Which of those pieces end up in your bag. That is the only part
              nobody knows in advance, and it is the whole idea of a bowl.
            </p>
            <p className="mt-3 text-[14.5px] text-muted">
              {/*
                The filming is a THING SHE DOES, worded as one. "We film every
                order" on a shopfront is a term of sale: a week she cannot film
                becomes a failure to deliver as described, over a video nobody
                was charged for. So this promises no video, no platform and no
                timing — and the social links are only named when an account
                actually exists (lib/contact.ts).
              */}
              Most scoops get filmed while they are drawn and packed
              {hasSocialAccount ? (
                <>
                  , and that is what ends up on{" "}
                  {socialLinks.map((link, index) => (
                    <span key={link.label}>
                      {index > 0 ? " and " : ""}
                      <a
                        href={link.href}
                        className="font-bold text-accent underline underline-offset-2"
                      >
                        {link.label}
                      </a>
                    </span>
                  ))}
                </>
              ) : null}
              . It is something we do because it is the best part of the day,
              not part of what you are buying — we cannot promise your scoop
              will be filmed or that a video of it will be shared.
            </p>
            <p className="mt-3 text-[13px] text-muted">
              A scoop is a real sale of real goods, so your{" "}
              <Link
                href="/legal/refunds"
                className="font-bold text-accent underline underline-offset-2"
              >
                Australian Consumer Law rights
              </Link>{" "}
              apply to it exactly as they do to anything else here.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
