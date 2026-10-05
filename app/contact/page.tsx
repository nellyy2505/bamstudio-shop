import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Icon, Pill } from "@/components/ui";
import { ContactForm } from "./ContactForm";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import {
  canReachStudio,
  formsReachStudio,
  hasSocialAccount,
  hasStudioMailbox,
} from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { selfCanonical } from "../seo";

export const metadata: Metadata = {
  ...selfCanonical("/contact"),
  title: "Contact us",
  // Static metadata cannot branch on the config flags below, so it says what
  // holds however the shop is configured rather than promising an answer.
  description:
    "Get in touch with Bam Studio about an order, a return, a custom design or a market date.",
};

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would offer or withhold the contact form on a
 * capability the server no longer has - the form is the thing most likely to
 * carry a faulty-goods claim. Low traffic; it can afford the render.
 */
export const dynamic = "force-dynamic";

/**
 * /api/contact writes the enquiry to `public.contact_enquiries` and then emails
 * the studio mailbox about it (0006_enquiries.sql). The row means a message now
 * outlives a mail provider that is unconfigured or down - but nothing on this
 * site reads that table, so the email is still the only way anyone finds out an
 * enquiry arrived. Without sending capability *and* a mailbox, a submitted
 * message is stored and seen by nobody. Offering the box anyway is how a
 * faulty-goods claim gets silently swallowed, so where this is false the page
 * shows the channels that do work instead.
 *
 * This is a server component, so the capability is `isEmailConfigured()` - the
 * same secrets /api/contact checks per request. It used to be a public build
 * flag, which could be true with the secrets absent: the form was rendered, the
 * route answered `delivered:false`, and five other pages promised the box
 * reached a real inbox.
 */
const canReceiveMessages = formsReachStudio(isEmailConfigured());

/** Shown in the form's place when a submitted message could not reach anyone. */
function ReachUsCard() {
  if (hasStudioMailbox) {
    return (
      <div className="card p-7 sm:p-9">
        <h2 className="text-2xl">Write to us</h2>
        <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
          Email us at{" "}
          <a
            href={`mailto:${SHOP.supportEmail}`}
            className="font-bold text-accent underline underline-offset-2"
          >
            {SHOP.supportEmail}
          </a>{" "}
          with your order number if you have one. We read every message
          ourselves.
        </p>
      </div>
    );
  }

  if (hasSocialAccount) {
    return (
      <div className="card p-7 sm:p-9">
        <h2 className="text-2xl">Find us on social</h2>
        <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
          Send us a DM, with your order number if it&apos;s about a parcel.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-7 sm:p-9">
      <h2 className="text-2xl">Reaching us</h2>
      <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
        Chasing a parcel?{" "}
        <Link
          href="/track"
          className="font-bold text-accent underline underline-offset-2"
        >
          Track your order
        </Link>{" "}
        with your order number and email.
      </p>
    </div>
  );
}

export default function ContactPage() {
  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />

      <div className="mb-9 max-w-2xl">
        <h1 className="mb-2.5 text-3xl md:text-4xl">Talk to us</h1>
        {/* This header sits above a branch that may say plainly there is no way
            to send us a message, so a promise of an answer here has to hang off
            the same test that branch does. The old "answered within one to two
            business days" is gone rather than gated: nothing in this codebase
            measures or guarantees a turnaround, and a page that cannot promise
            a channel certainly cannot promise a clock. */}
        <p className="text-muted">
          {canReachStudio
            ? "Questions about an order, a custom idea or a market date? Send us a note. We read every message ourselves."
            : "Questions about an order or a market date? Start here."}
        </p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {canReceiveMessages ? <ContactForm /> : <ReachUsCard />}

        <aside className="flex flex-col gap-4">
          {/* No mailbox configured means no email channel to advertise - an
              "Email" card with nowhere to write to is the false promise. */}
          {hasStudioMailbox ? (
            <section className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream">
                <Icon name="mail" size={22} />
              </span>
              <h2 className="mt-4 text-lg">Email</h2>
              <p className="mt-1.5 text-[14px] text-muted">
                {canReceiveMessages ? "Prefer email? Write to " : "Write to "}
                <a
                  href={`mailto:${SHOP.supportEmail}`}
                  className="font-bold text-accent underline underline-offset-2"
                >
                  {SHOP.supportEmail}
                </a>
                . Include your order number if you have one.
              </p>
            </section>
          ) : null}

          {/* A link labelled "Instagram" that goes somewhere else is its own
              small false promise, so an unset handle renders no link - the
              same choice the footer makes. With neither handle set there is no
              social presence to describe, so the card goes entirely. */}
          {hasSocialAccount ? (
            <section className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blush">
                <Icon name="camera" size={22} />
              </span>
              <h2 className="mt-4 text-lg">Social</h2>
              <p className="mt-1.5 text-[14px] text-muted">
                New designs and restocks go up here first. DMs welcome.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                {SHOP.socials.instagram ? (
                  <a
                    href={SHOP.socials.instagram}
                    className="text-accent underline underline-offset-2 hover:text-accent-dark"
                  >
                    Instagram
                  </a>
                ) : null}
                {SHOP.socials.tiktok ? (
                  <a
                    href={SHOP.socials.tiktok}
                    className="text-accent underline underline-offset-2 hover:text-accent-dark"
                  >
                    TikTok
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sage">
              <Icon name="pin" size={22} />
            </span>
            <h2 className="mt-4 text-lg">In person</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              {/* No market is named: none is booked, so this says only what
                  holds. */}
              Find our DIY letter-charm bar at {SHOP.city} weekend markets.
              Dates change, so check before you visit.
            </p>
          </section>

          <section className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-butter">
              <Icon name="sparkle" size={22} />
            </span>
            <h2 className="mt-4 text-lg">Custom &amp; wholesale</h2>
            {/* "Tell us the quantity" is an instruction the reader cannot
                follow when no channel exists, so only the part about how the
                printing works is left standing in that case. */}
            <p className="mt-1.5 text-[14px] text-muted">
              Party favours, classroom name sets or stockist orders
              {canReachStudio
                ? ": tell us how many and when you need them."
                : " are all welcome."}{" "}
              Bigger orders take longer, so ask early.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill tone="line">No licensed characters</Pill>
              <Pill tone="line">Prints in {PRINT_LEAD_TIME.label}</Pill>
            </div>
          </section>

          <p className="px-1 text-[13px] text-muted">
            Chasing a parcel?{" "}
            <Link
              href="/track"
              className="font-bold text-accent underline underline-offset-2"
            >
              Track your order
            </Link>{" "}
            or read the{" "}
            <Link
              href="/faq"
              className="font-bold text-accent underline underline-offset-2"
            >
              help centre
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
