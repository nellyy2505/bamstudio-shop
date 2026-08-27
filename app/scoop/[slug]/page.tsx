import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ScoopBuy from "@/components/scoop/ScoopBuy";
import { ScoopArt } from "@/components/scoop/ScoopArt";
import { ProductGrid } from "@/components/product/ProductCard";
import { Alert, Breadcrumbs, ButtonLink, Icon, Pill } from "@/components/ui";
import { SHOP } from "@/lib/config";
import { hasSocialAccount, socialLinks } from "@/lib/contact";
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
  return `${pluralise(tier.piece_count, "piece")} drawn by hand from the ${pluralise(
    tier.pool.length,
    "design",
  )} listed on this page.`;
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

  const { availability } = tier;
  const sellable = availability.sellable;

  /*
   * The pool, split by what is actually on the shelf.
   *
   * A scoop is drawn from pieces that already exist — that is the one place the
   * shop's overselling rule does not apply (lib/scoop.ts) — so listing a
   * printed-out piece alongside the drawable ones would describe a bag it
   * cannot currently produce. Both groups are still shown: the pool is the
   * description of the product, and quietly dropping a row from it on a day it
   * is out of stock would make the description move around.
   */
  const onShelf = tier.pool.filter((product) => product.stock_on_hand > 0);
  const printedOut = tier.pool.filter((product) => product.stock_on_hand <= 0);

  /*
   * Structured data only for a bowl that can actually be bought, and only ever
   * with the price the page itself prints. `sellable` is false unless the tier
   * is priced, so `price_cents` is non-null in this branch; `InStock` is exactly
   * what `availability.scoopsAvailable >= 1` means — the pool can fill at least
   * one scoop right now, from pieces already printed. An unsellable tier emits
   * nothing rather than an `OutOfStock` offer with a price nobody can pay.
   */
  const jsonLdHtml = sellable
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
              for one — a "$0.00" here would read as a free scoop, which is the
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
            {/* Drawn from stock, not printed to order — so this page says
                nothing about print lead time, which does not apply to it, and
                nothing about a dispatch date, which nothing here measures. */}
            <Icon name="box" size={14} className="inline" /> Drawn from pieces
            that are already printed and on the shelf
          </p>

          {sellable ? (
            /* The buy control is another agent's (`components/scoop/ScoopBuy`)
               and takes the whole listing, availability included. It is only
               mounted for a tier that can actually be filled: offering a
               purchase that checkout would refuse is the failure this page
               exists to avoid. */
            <ScoopBuy tier={tier} />
          ) : (
            <Alert tone="info">
              {availability.drawable < tier.piece_count ? (
                <>
                  This bowl is not being drawn at the moment: it draws{" "}
                  {pluralise(tier.piece_count, "piece")}, and only{" "}
                  {availability.drawable} of the{" "}
                  {pluralise(tier.pool.length, "design")} below{" "}
                  {availability.drawable === 1 ? "is" : "are"} on the shelf
                  today. Everything it draws from is still listed, and you can
                  buy any of it on its own.
                </>
              ) : (
                <>
                  This bowl is not on sale at the moment. Everything it draws
                  from is still listed below, and you can buy any of it on its
                  own.
                </>
              )}
            </Alert>
          )}

          {/*
            What a customer needs to know before paying, in the order they need
            it: how many, from where, and who picks.

            Deliberately silent on whether the same piece can come out twice.
            That is an unsettled owner decision, and a sentence here in either
            direction would settle it — "no duplicates" is a promise the packing
            table would have to keep, "duplicates possible" is a warning that
            might never be true.
          */}
          <div className="card mt-5 flex flex-col gap-3 p-4 text-[13.5px]">
            <p className="flex items-start gap-2.5">
              <Icon name="box" size={18} className="mt-0.5 shrink-0" />
              <span>
                <b>{pluralise(tier.piece_count, "piece")} in the bag.</b> That
                number is the bowl — it does not vary with what we have in.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="check" size={18} className="mt-0.5 shrink-0" />
              <span>
                <b>
                  Every piece comes from the{" "}
                  {pluralise(tier.pool.length, "design")} below.
                </b>{" "}
                Nothing outside that list goes in.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="heart" size={18} className="mt-0.5 shrink-0" />
              <span>
                <b>We pick them, not you.</b> One of us draws your pieces out of
                the bowl by hand when your order is packed. There is no
                randomiser and nothing to choose at checkout.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="truck" size={18} className="mt-0.5 shrink-0" />
              <span>
                Postage is worked out from the weight of your basket at
                Australia Post&rsquo;s rates and shown in full before you pay.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
              <span>
                A scoop is not a personalised item —{" "}
                <Link
                  href="/legal/refunds"
                  className="text-accent underline underline-offset-2"
                >
                  refund policy
                </Link>
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- the pool */}
      {/*
        THE POOL IS THE DESCRIPTION, so it is rendered as the real catalogue —
        actual product cards linking to actual product pages — and not as a
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
          This is the whole pool — all{" "}
          {pluralise(tier.pool.length, "design")}, not a selection of them. Your{" "}
          {tier.piece_count} pieces come out of this list and nowhere else.{" "}
          {printedOut.length > 0 ? (
            <>
              Right now {availability.drawable} of them{" "}
              {availability.drawable === 1 ? "is" : "are"} on the shelf, and a
              scoop is only ever drawn from what is actually there.
            </>
          ) : (
            <>All of them are on the shelf today.</>
          )}
        </p>

        {onShelf.length > 0 ? (
          <ProductGrid products={onShelf} quickAdd={false} />
        ) : (
          <p className="text-[14.5px] text-muted">
            Nothing from this bowl is on the shelf at the moment.
          </p>
        )}

        {printedOut.length > 0 ? (
          <div className="mt-10">
            <h3 className="text-lg">In the pool, printed out right now</h3>
            <p className="mt-1.5 mb-5 max-w-2xl text-[13.5px] text-muted">
              Still part of this bowl, but there are none on the shelf, so they
              cannot be drawn into a scoop until they are printed again. You can
              still order them on their own — those are printed to order.
            </p>
            <ProductGrid products={printedOut} quickAdd={false} />
          </div>
        ) : null}
      </section>

      {/* ------------------------------------------------------- how it goes */}
      <section className="mt-16">
        <div className="card grid gap-8 bg-cream p-8 md:grid-cols-2 md:p-10">
          <div>
            <h2 className="mb-3 text-xl">How your scoop is chosen</h2>
            <p className="text-[14.5px] text-muted">
              By hand, at the packing table, from the bowl above. We do not run
              a randomiser and you do not get a picker at checkout — a person
              takes {tier.piece_count} out and bags them.
            </p>
            <p className="mt-3 text-[14.5px] text-muted">
              {/*
                Filming is worded as a habit, not a term of sale. "We film every
                order" printed beside a price becomes part of what was bought,
                and a week she cannot film becomes a failure to deliver as
                described — over a video nobody was charged for. So: no promise
                of a video, no platform, no timing, and the accounts are only
                named where one exists (lib/contact.ts).
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
              . It is something we do, not part of what you are buying — we
              cannot promise your scoop will be filmed or that a video of it
              will be shared.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-xl">If it is not right</h2>
            <p className="text-[14.5px] text-muted">
              A scoop is a normal sale of normal goods. If a bag turns up short,
              with something that was not in the pool above, or with a piece
              that is faulty or damaged, that is not what was described and we
              put it right.
            </p>
            <p className="mt-3 text-[14.5px] text-muted">
              What we cannot do is swap a piece you did not want for one you
              did. Which pieces come out is the part a scoop leaves open, and it
              is the only part.
            </p>
            <ButtonLink href="/legal/refunds" variant="soft" className="mt-4">
              Refund policy
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="mt-12">
        <Link
          href="/scoop"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
        >
          <Icon name="back" size={15} />
          All the bowls
        </Link>
      </section>
    </div>
  );
}
