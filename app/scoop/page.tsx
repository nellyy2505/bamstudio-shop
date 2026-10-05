import type { Metadata } from "next";
import Link from "next/link";
import { ScoopArt } from "@/components/scoop/ScoopArt";
import { Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
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
    "A bowl of small 3D-printed surprises. You choose the bowl; we hand-pick your pieces from the list on its page.",
};

/** `theme` is a checked enum in the database; this is the label for it. */
function themeLabel(theme: ScoopTierListing["theme"]): string {
  return SCOOP_THEMES.find((option) => option.value === theme)?.label ?? "Mixed";
}

const STEPS = [
  {
    n: "1",
    title: "Choose a bowl",
    body: "Pick a theme and a piece count. Every piece the bowl can hold is listed on its page.",
  },
  {
    n: "2",
    title: "We pick by hand",
    body: "When your order comes in, we hand-pick your pieces from that list.",
  },
  {
    n: "3",
    title: "Packed and posted",
    body: "Postage is worked out by weight and shown before you pay.",
  },
];

/**
 * One bowl on the landing page.
 *
 * EVERY PUBLISHED TIER IS OFFERED. This card used to check
 * `availability.sellable` - which then included whether the pool could fill a
 * scoop off the shelf - and downgrade a low bowl to "not being drawn right
 * now". That is gone. The shop prints to order: a bowl that is short when she
 * comes to pack is topped up first, so a shelf count is no reason to stop
 * offering a tier (`lib/scoop.ts`). RLS has already refused a draft or unpriced
 * tier, so everything reaching this card is for sale.
 */
function TierCard({ tier }: { tier: ScoopTierListing }) {
  const priced = tier.price_cents !== null;

  return (
    <article className="card flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-cream">
          <ScoopArt size={44} />
        </span>
        <Pill tone="accent">{themeLabel(tier.theme)}</Pill>
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

      <ButtonLink href={`/scoop/${tier.slug}`} full>
        See what&apos;s in it
      </ButtonLink>
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
            Small printed surprises, hand-picked from the bowl you choose.
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
         * sample tier - a fallback bowl would need an invented price. So there
         * is nothing to advertise, and this says so instead of rendering an
         * empty grid under a "Choose your bowl" heading. The how-it-works and
         * the promise below still render: the page explains a real thing that
         * is not on sale yet, which is a page, not a 404.
         */
        <section className="wrap flex flex-col items-center pt-8 text-center">
          <ScoopArt size={88} />
          <p className="mt-5 text-lg font-bold">No bowls are open right now.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3.5">
            <ButtonLink href="/shop">Shop all</ButtonLink>
            <ButtonLink href="/builder" variant="ghost">
              <Icon name="sparkle" size={18} />
              Design your own
            </ButtonLink>
          </div>
        </section>
      )}

      <section className="wrap pt-16">
        <h2 className="mb-6 text-2xl md:text-[27px]">How it works</h2>
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
        The reason the pool is on every bowl's page: goods have to match their
        description, and "five pieces drawn from these twelve" is one this shop
        can keep. Deliberately NOT said here, because each is the owner's
        unsettled decision (0007_lucky_scoop.sql): whether a piece can come out
        twice, whether scoops are filmed, and whether a change of mind on a
        scoop is accepted. Silence favours the customer.
      */}
      <section className="wrap pt-12">
        <div className="card bg-cream p-7 md:p-8">
          <h2 className="mb-3 text-xl">Good to know</h2>
          <ul className="flex flex-col gap-2.5 text-[14.5px] text-muted">
            <li className="flex items-start gap-2.5">
              <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
              <span>The piece count is fixed. You always get that many.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
              <span>Only pieces from the bowl&rsquo;s list go in your bag.</span>
            </li>
            <li className="flex items-start gap-2.5">
              <Icon name="check" size={17} className="mt-0.5 shrink-0 text-good" />
              <span>We choose the pieces, so we can&rsquo;t take requests.</span>
            </li>
          </ul>
          <p className="mt-4 text-[13px] text-muted">
            Your{" "}
            <Link
              href="/legal/refunds"
              className="font-bold text-accent underline underline-offset-2"
            >
              Australian Consumer Law rights
            </Link>{" "}
            apply to every scoop.
          </p>
        </div>
      </section>
    </>
  );
}
