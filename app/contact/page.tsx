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
    "Questions about an order, a return, a custom design or a market stall? Here is how to reach Bam Studio.",
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
 * capability the server no longer has — the form is the thing most likely to
 * carry a faulty-goods claim. Low traffic; it can afford the render.
 */
export const dynamic = "force-dynamic";

/**
 * /api/contact writes the enquiry to `public.contact_enquiries` and then emails
 * the studio mailbox about it (0006_enquiries.sql). The row means a message now
 * outlives a mail provider that is unconfigured or down — but nothing on this
 * site reads that table, so the email is still the only way anyone finds out an
 * enquiry arrived. Without sending capability *and* a mailbox, a submitted
 * message is stored and seen by nobody. Offering the box anyway is how a
 * faulty-goods claim gets silently swallowed, so where this is false the page
 * shows the channels that do work instead.
 *
 * This is a server component, so the capability is `isEmailConfigured()` — the
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
          Email is the way to reach us. Send your question to{" "}
          <a
            href={`mailto:${SHOP.supportEmail}`}
            className="font-bold text-accent underline underline-offset-2"
          >
            {SHOP.supportEmail}
          </a>{" "}
          and add your order number if you have one. One of us reads every
          message personally.
        </p>
      </div>
    );
  }

  if (hasSocialAccount) {
    return (
      <div className="card p-7 sm:p-9">
        <h2 className="text-2xl">Find us on social</h2>
        <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
          Our DMs are the way to reach us at the moment. Send the order number
          if it is about a parcel and we will pick it up there.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-7 sm:p-9">
      <h2 className="text-2xl">Reaching us</h2>
      <p className="mt-2 max-w-[52ch] text-[15px] text-muted">
        The studio inbox is not set up yet, so there is no way to send us a
        message from here. If you are chasing a parcel,{" "}
        <Link
          href="/track"
          className="font-bold text-accent underline underline-offset-2"
        >
          tracking
        </Link>{" "}
        will tell you where it is with your order number and email.
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
          There is no support team here — it is the three of us.
          {canReachStudio
            ? " Reach us any of the ways below and you get an actual answer from someone who printed the thing."
            : " We have not published a way to reach us yet, so here is what you can do in the meantime."}
        </p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {canReceiveMessages ? <ContactForm /> : <ReachUsCard />}

        <aside className="flex flex-col gap-4">
          {/* No mailbox configured means no email channel to advertise — an
              "Email" card with nowhere to write to is the false promise. */}
          {hasStudioMailbox ? (
            <section className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream">
                <Icon name="mail" size={22} />
              </span>
              <h2 className="mt-4 text-lg">Email</h2>
              <p className="mt-1.5 text-[14px] text-muted">
                {canReceiveMessages ? "Prefer your own inbox? Write to " : "Write to "}
                <a
                  href={`mailto:${SHOP.supportEmail}`}
                  className="font-bold text-accent underline underline-offset-2"
                >
                  {SHOP.supportEmail}
                </a>
                . Include your order number if you have one.
              </p>
              {/* Was "Replies weekdays. Market weekends run a day or two
                  behind." — a turnaround promise with nothing behind it. This
                  sets the same expectation without committing to a clock. */}
              <p className="mt-2 text-[12.5px] text-faint">
                We answer these ourselves, between print runs and market
                weekends.
              </p>
            </section>
          ) : null}

          {/* A link labelled "Instagram" that goes somewhere else is its own
              small false promise, so an unset handle renders no link — the
              same choice the footer makes. With neither handle set there is no
              social presence to describe, so the card goes entirely. */}
          {hasSocialAccount ? (
            <section className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blush">
                <Icon name="camera" size={22} />
              </span>
              <h2 className="mt-4 text-lg">Social</h2>
              <p className="mt-1.5 text-[14px] text-muted">
                New designs, print fails and restock news go up first on social.
                We read our DMs too — they just take us a bit longer.
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
              We run a stall at {SHOP.city} weekend markets with the DIY
              letter-charm bar, so you can spell a name and walk away with it.
            </p>
            {/* The next stall was an unfilled [MARKET NAME AND DATE]
                placeholder. Naming a market we have not booked would be worse
                than naming none, so this says only what holds. */}
            <p className="mt-2 text-[14px] text-muted">
              Dates move around week to week — we are not at the same market
              every weekend, so it is worth checking before you make the trip.
            </p>
            <p className="mt-2 text-[12.5px] text-faint">
              We are online-only otherwise — there is no shopfront to visit.
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
              Party favours, a name run for a classroom, or a stockist order —
              {canReachStudio
                ? " tell us the quantity and the date you need it by."
                : " these are all things we do."}{" "}
              One printer means lead times grow with the order, so earlier is
              better.
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
            </Link>{" "}
            first{canReachStudio ? " — it is often faster than waiting for us." : "."}
          </p>
        </aside>
      </div>
    </div>
  );
}
