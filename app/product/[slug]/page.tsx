import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductGrid } from "@/components/product/ProductCard";
import { Breadcrumbs, Icon, Pill, SectionHead, Stars } from "@/components/ui";
import { ProductBuy } from "./ProductBuy";
import { ProductGallery } from "./ProductGallery";
import { ReviewsSection } from "./ReviewsSection";
import {
  getProductBySlug,
  getRelatedProducts,
  getReviews,
} from "@/lib/queries";
import { PRINT_LEAD_TIME, SHIPPING, SHOP, transitDays } from "@/lib/config";
import { canReachStudio } from "@/lib/contact";
import { deliveryWindow, money, pluralise } from "@/lib/format";
import { siteUrl } from "@/lib/stripe";

export const revalidate = 300;

/*
 * `canReachStudio` comes from lib/contact.ts — the same mailbox-or-social test
 * /track and the legal pages use. The on-site contact form is deliberately not
 * counted: it delivers by emailing the studio mailbox, so it needs both that
 * mailbox and the Resend secrets before it is a channel at all.
 */

type Params = Promise<{ slug: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product not found" };

  return {
    title: product.short_name,
    description: product.description.slice(0, 155),
    openGraph: {
      title: `${product.short_name} · ${SHOP.name}`,
      description: product.description.slice(0, 155),
      type: "website",
    },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const [related, reviews] = await Promise.all([
    getRelatedProducts(product, 4),
    getReviews(product.id),
  ]);

  const readyToShip = product.stock_on_hand > 0;

  // Structured data helps the listing show its price and rating in search.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.sku,
    brand: { "@type": "Brand", name: SHOP.name },
    aggregateRating:
      product.review_count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.review_count,
          }
        : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "AUD",
      price: (product.price / 100).toFixed(2),
      // Nothing is warehoused by default — anything not already printed is
      // made to order, which is PreOrder, not OutOfStock.
      availability: readyToShip
        ? "https://schema.org/InStock"
        : "https://schema.org/PreOrder",
      url: `${siteUrl()}/product/${product.slug}`,
    },
  };

  // JSON.stringify does not escape the less-than sign, so a product name
  // containing a closing script tag would break out of the tag below and
  // inject markup. The unicode escape is still valid JSON and parses back to
  // the identical string, so consumers see no difference.
  const jsonLdHtml = JSON.stringify(jsonLd).replace(/</g, "\\u003c");

  return (
    <div className="wrap pt-7">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml }}
      />

      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "Shop", href: "/shop" },
          {
            label: product.category,
            href: `/shop?category=${encodeURIComponent(product.category)}`,
          },
          { label: product.short_name },
        ]}
      />

      <div className="grid items-start gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
        <ProductGallery product={product} />

        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {product.is_bestseller ? (
              <Pill tone="accent">
                <Icon name="trend" size={13} />
                Bestseller
              </Pill>
            ) : null}
            {product.is_new ? <Pill tone="good">New this month</Pill> : null}
            {product.is_personalised ? (
              <Pill tone="accent">
                <Icon name="sparkle" size={13} />
                Made just for you
              </Pill>
            ) : null}
          </div>

          <h1 className="mb-2 text-[26px] leading-snug md:text-3xl">
            {product.name}
          </h1>

          {/* Nothing to show until a customer actually leaves a review. */}
          {product.review_count > 0 ? (
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <Stars rating={product.rating} size={16} />
              <b className="text-[14.5px]">{product.rating.toFixed(1)}</b>
              <a
                href="#reviews"
                className="text-[13.5px] text-accent underline underline-offset-2"
              >
                {pluralise(product.review_count, "review")}
              </a>
            </div>
          ) : null}

          <div className="flex flex-wrap items-baseline gap-3">
            <b className="text-3xl">
              {/* Builder charms are priced by letter count, so the headline is
                  a "from" figure — matching the grid card. */}
              {product.personalisation_mode === "builder" ? "From " : ""}
              {money(product.price)}
            </b>
            <span className="text-[13px] text-muted">
              AUD{SHOP.gstRegistered ? " · GST included" : ""}
            </span>
          </div>

          <p
            className={`mt-1.5 mb-5 text-[13px] font-extrabold ${
              readyToShip ? "text-good" : "text-muted"
            }`}
          >
            {readyToShip ? (
              <>
                <Icon name="check" size={14} className="inline" /> Only{" "}
                {product.stock_on_hand} ready to ship — then printed to order
              </>
            ) : (
              <>
                <Icon name="box" size={14} className="inline" /> Printed to order
                in {PRINT_LEAD_TIME.label}
              </>
            )}
          </p>

          <ProductBuy product={product} />

          <div className="card mt-5 flex flex-col gap-3 p-4 text-[13.5px]">
            <p className="flex items-start gap-2.5">
              <Icon name="truck" size={18} className="mt-0.5 shrink-0" />
              <span>
                <b>Estimated delivery {deliveryWindow(...transitDays("standard"))}</b> ·{" "}
                {/* Postage is priced per basket by weight, so no per-product
                    figure can be right. The free threshold is the shop's own
                    promotion and is true on every product page. */}
                Standard post by weight, free from{" "}
                {money(SHIPPING.freeThreshold)}
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="box" size={18} className="mt-0.5 shrink-0" />
              <span>
                Printed fresh for your order — dispatched in{" "}
                {PRINT_LEAD_TIME.label}
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
              <span>
                {product.is_personalised
                  ? "Personalised items can only be returned if faulty · "
                  : "30-day returns on unused items · "}
                <Link
                  href="/legal/refunds"
                  className="text-accent underline underline-offset-2"
                >
                  Refund policy
                </Link>
              </span>
            </p>
          </div>

          <div className="mt-5">
            {(product.details ?? []).map((detail, index) => (
              <details
                key={detail.title}
                open={index === 0}
                className="group border-t border-line py-4"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between text-[14.5px] font-extrabold">
                  {detail.title}
                  <Icon
                    name="plus"
                    size={16}
                    className="group-open:hidden"
                  />
                  <Icon
                    name="minus"
                    size={16}
                    className="hidden group-open:block"
                  />
                </summary>
                <p className="mt-2.5 text-sm text-muted">{detail.body}</p>
              </details>
            ))}
          </div>

          <div className="mt-5 flex items-center gap-4 rounded-2xl bg-cream p-4">
            <span className="flex h-13 w-13 items-center justify-center rounded-full bg-surface font-display text-xl font-bold">
              B
            </span>
            <div className="flex-1">
              <b className="text-[14.5px]">{SHOP.name}</b>
              {/* "Usually replies within a day" is gone: nothing measures or
                  guarantees a reply time, and /api/contact cannot even deliver
                  the enquiry unless the Resend secrets and a studio mailbox are
                  both set. Where the studio is is a fact we can stand behind, so
                  that is all the line claims now. */}
              <p className="text-[12.5px] text-muted">
                {SHOP.city}, {SHOP.country}
              </p>
            </div>
            <Link
              href="/contact"
              className="flex h-11 items-center gap-2 rounded-full border border-line2 bg-surface px-4 text-sm font-extrabold hover:border-ink"
            >
              <Icon name="msg" size={16} />
              {/* Same call as /track: with no mailbox and no social account
                  there is nothing to message, and /contact says so. */}
              {canReachStudio ? "Message" : "Contact"}
            </Link>
          </div>
        </div>
      </div>

      <ReviewsSection product={product} reviews={reviews} />

      {related.length > 0 ? (
        <section className="mt-16">
          <SectionHead
            title="You may also like"
            href="/shop"
            linkText="Shop all"
          />
          <ProductGrid products={related} />
        </section>
      ) : null}
    </div>
  );
}
