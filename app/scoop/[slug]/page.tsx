import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ScoopBuy from "@/components/scoop/ScoopBuy";
import { ScoopArt } from "@/components/scoop/ScoopArt";
import { ProductGrid } from "@/components/product/ProductCard";
import { Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
import { SHOP } from "@/lib/config";
import { money, pluralise } from "@/lib/format";
import { getScoopTierBySlug } from "@/lib/queries";
import type { ScoopTierListing } from "@/lib/queries";
import { siteUrl } from "@/lib/stripe";
import { SCOOP_THEMES } from "@/lib/types";
import { SITE_OPEN_GRAPH } from "../../seo";

export const revalidate = 300;

type Params = Promise<{ slug: string }>;

function themeLabel(theme: ScoopTierListing["theme"]): string {
  return SCOOP_THEMES.find((option) => option.value === theme)?.label ?? "Mixed";
}

/**
 * The one sentence that makes "random" a description rather than an unknown:
 * a count, and the pool it is drawn from. Used for the meta description and as
 * the page's own summary line, so the two cannot drift apart.
 */
function promiseLine(tier: ScoopTierListing): string {
  return `${pluralise(tier.piece_count, "piece")}, hand-picked from the ${pluralise(
    tier.pool.length,
    "design",
  )} below.`;
}

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const tier = await getScoopTierBySlug(slug);
  if (!tier) return { title: "Scoop not found" };

  /*
   * The description is the blurb if the owner wrote one, and otherwise the
   * count-and-pool sentence built from the row itself. Never an invented one:
   * a tier is published with a real piece count and a real pool, so this is the
   * one thing about it that is always true and always specific.
   */
  const description = tier.blurb.trim() || promiseLine(tier);
  const path = `/scoop/${tier.slug}`;

  return {
    title: tier.name,
    description: description.slice(0, 155),
    alternates: { canonical: path },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      url: path,
      title: `${tier.name} · ${SHOP.name}`,
      description: description.slice(0, 155),
    },
  };
}

export default async function ScoopTierPage({ params }: { params: Params }) {
  const { slug } = await params;
  const tier = await getScoopTierBySlug(slug);
  if (!tier) notFound();

  /*
   * THE POOL IS ONE LIST. It used to be split into "on the shelf" and "printed
   * out right now", with the second group captioned as pieces that could not be
   * drawn until they were printed again. That was never true of this shop: it
   * PRINTS TO ORDER, so a piece with none on the shelf is one she prints before
   * packing, and a scoop is no different (`lib/scoop.ts`). The split told a
   * customer a piece was off the table when it was not, and made the tier's
   * description - which is exactly this list - move around from day to day.
   */

  /*
   * Structured data only for a priced bowl, and only ever with the price the
   * page itself prints. `InStock` is the honest answer for a made-to-order
   * shop: an order placed today is filled, whether the pieces come off the
   * shelf or off the printer first. An unpriced tier emits nothing rather than
   * an offer with a price nobody can pay.
   */
  const jsonLdHtml = tier.price_cents !== null
    ? JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: tier.name,
        description: tier.blurb.trim() || promiseLine(tier),
        brand: { "@type": "Brand", name: SHOP.name },
        offers: {
          "@type": "Offer",
          priceCurrency: "AUD",
          price: ((tier.price_cents as number) / 100).toFixed(2),
          availability: "https://schema.org/InStock",
          url: `${siteUrl()}/scoop/${tier.slug}`,
        },
      }).replace(/</g, "\\u003c")
    : null;

  return (
    <div className="wrap pt-7">
      {jsonLdHtml ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
        />
      ) : null}

      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Lucky Scoop", href: "/scoop" },
          { label: tier.name },
        ]}
      />

      <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <div className="flex aspect-square items-center justify-center rounded-[26px] bg-sky">
          <ScoopArt size={260} />
        </div>

        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <Pill tone="accent">
              <Icon name="gift" size={13} />
              Lucky Scoop
            </Pill>
            <Pill tone="line">{themeLabel(tier.theme)}</Pill>
          </div>

          <h1 className="mb-2 text-[26px] leading-snug md:text-3xl">
            {tier.name}
          </h1>

          <p className="mb-4 text-[15px] text-muted">{promiseLine(tier)}</p>

          {tier.blurb ? (
            <p className="mb-4 text-[14.5px] text-muted">{tier.blurb}</p>
          ) : null}

          {/* An unpriced tier cannot be sellable, so no price line is printed
              for one - a "$0.00" here would read as a free scoop, which is the
              exact reason `price_cents` is nullable and never zero (0007). */}
          {tier.price_cents !== null ? (
            <div className="flex flex-wrap items-baseline gap-3">
              <b className="text-3xl">{money(tier.price_cents)}</b>
              <span className="text-[13px] text-muted">
                AUD{SHOP.gstRegistered ? " · GST included" : ""} ·{" "}
                {pluralise(tier.piece_count, "piece")}
              </span>
            </div>
          ) : null}

          <p className="mt-1.5 mb-5 text-[13px] font-extrabold text-muted">
            {/* Drawn by hand from the pool below. No claim either way about
                which pieces were already printed - like everything else here,
                what is short is printed before the order goes out. */}
            <Icon name="box" size={14} className="inline" /> Packed and posted
            from {SHOP.city}
          </p>

          {/* ALWAYS MOUNTED. This used to be gated on `availability.sellable`,
              which then folded in whether the pool could fill a scoop off the
              shelf, so a low bowl replaced the buy control with a "not being
              drawn" notice. The shop prints to order and a scoop is no
              exception (`lib/scoop.ts`), so there is nothing here to gate on.
              `ScoopBuy` handles the one remaining case - a tier with no price,
              which RLS never publishes anyway - on its own. */}
          <ScoopBuy tier={tier} />

          {/*
            What a customer needs to know before paying, in the order they need
            it: how many, from where, and who picks.

            Deliberately silent on whether the same piece can come out twice.
            That is an unsettled owner decision, and a sentence here in either
            direction would settle it - "no duplicates" is a promise the packing
            table would have to keep, "duplicates possible" is a warning that
            might never be true.
          */}
          <div className="card mt-5 flex flex-col gap-3 p-4 text-[13.5px]">
            <p className="flex items-start gap-2.5">
              <Icon name="check" size={18} className="mt-0.5 shrink-0" />
              <span>
                Always {pluralise(tier.piece_count, "piece")}, only from the
                list below.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="heart" size={18} className="mt-0.5 shrink-0" />
              <span>We pick your pieces by hand when we pack your order.</span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="truck" size={18} className="mt-0.5 shrink-0" />
              <span>Postage by weight, shown before you pay.</span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
              <span>
                Your Australian Consumer Law rights apply ·{" "}
                <Link
                  href="/legal/refunds"
                  className="text-accent underline underline-offset-2"
                >
                  Refund policy
                </Link>
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- the pool */}
      {/*
        THE POOL IS THE DESCRIPTION, so it is rendered as the real catalogue -
        actual product cards linking to actual product pages - and not as a
        drawn-up sample. "Five pieces from these twelve" is a promise this shop
        can keep; "a scoop" is not one at all, and goods have to match their
        description whether or not the sale is called lucky.

        Quick-add is off: these cards are here to say what could be in the bag,
        and a basket button on each one turns the description into a shopping
        aisle.
      */}
      <section className="mt-16">
        <h2 className="text-2xl md:text-[27px]">What can be in it</h2>
        <p className="mt-2 mb-6 max-w-2xl text-[14.5px] text-muted">
          The full list. Your {tier.piece_count} pieces come from these{" "}
          {pluralise(tier.pool.length, "design")} only.
        </p>

        {tier.pool.length > 0 ? (
          <ProductGrid products={tier.pool} quickAdd={false} />
        ) : null}
      </section>

      {/* ------------------------------------------------------- if it goes wrong */}
      {/*
        Silent, on purpose, on the owner's three open scoop decisions
        (0007_lucky_scoop.sql): duplicates, filming, and change of mind. The
        filming paragraph and the "we cannot swap a piece" line that were here
        are gone for that reason. What remains is the ACL position, which is
        not a decision anyone gets to make.
      */}
      <section className="mt-16">
        <div className="card bg-cream p-7 md:p-8">
          <h2 className="mb-2 text-xl">If something&rsquo;s not right</h2>
          <p className="max-w-2xl text-[14.5px] text-muted">
            If your bag is short, holds a piece not on the list, or arrives
            faulty or damaged, we&rsquo;ll put it right.
          </p>
          <ButtonLink href="/legal/refunds" variant="soft" className="mt-4">
            Refund policy
          </ButtonLink>
        </div>
      </section>

      <section className="mt-12">
        <Link
          href="/scoop"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          <Icon name="back" size={15} />
          All bowls
        </Link>
      </section>
    </div>
  );
}
