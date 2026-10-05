import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Icon } from "@/components/ui";
import { TrackForm } from "./TrackForm";
import { PRINT_LEAD_TIME, transitRangeLabel } from "@/lib/config";
import { canReachStudio, sendsOrderConfirmation } from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { selfCanonical } from "../seo";

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would tell a customer chasing an order to watch
 * for a confirmation that is not coming, or not to expect one that is. Low
 * traffic; it can afford the render.
 */
export const dynamic = "force-dynamic";

/**
 * Does the shop email the order number as well as showing it? Server component,
 * so this reads the same secrets the Stripe webhook does. `canReachStudio` -
 * is there a mailbox or a social account behind "message us" - comes from
 * lib/contact.ts, shared with /contact, /about and the legal pages.
 */
const SENDS_CONFIRMATION = sendsOrderConfirmation(isEmailConfigured());

export const metadata: Metadata = {
  ...selfCanonical("/track"),
  title: "Track your order",
  description:
    "Check on your Bam Studio order with your order number and email. No account needed.",
};

const NOTES = [
  {
    icon: "box" as const,
    title: "Printing",
    body: PRINT_LEAD_TIME.label,
  },
  {
    icon: "truck" as const,
    title: "Australia Post",
    // Postage is quoted per basket from Australia Post, so no fixed price
    // belongs on this page - and tracking depends on the service the quote
    // picks, which a general explainer cannot know. Transit ranges only.
    body: `Standard ${transitRangeLabel("standard")}, express ${transitRangeLabel("express")}.`,
  },
];

export default function TrackPage() {
  return (
    <div className="wrap pt-8">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Track your order" }]}
      />

      <div className="mb-8 max-w-2xl">
        <h1 className="mb-2.5 text-3xl md:text-4xl">Track your order</h1>
        <p className="text-muted">
          Enter your order number and email to see where it&apos;s up to.
        </p>
      </div>

      <div className="max-w-3xl">
        <TrackForm />

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {NOTES.map((note) => (
            <section
              key={note.title}
              className="flex items-start gap-3 rounded-xl bg-cream px-4 py-3"
            >
              <Icon name={note.icon} size={20} className="mt-0.5 shrink-0" />
              <div>
                <h2 className="text-[14px]">{note.title}</h2>
                <p className="text-[13px] text-muted">{note.body}</p>
              </div>
            </section>
          ))}

          {/* Leads with the confirmation page, which shows the order number on
              screen in every configuration. The confirmation email carries it
              too, but only while the Resend secrets are set, and it is queued
              after the response and can fail - so it is named as a second place
              to look rather than the place, and only when one is actually
              sent. */}
          <section className="flex items-start gap-3 rounded-xl bg-cream px-4 py-3">
            <Icon name="help" size={20} className="mt-0.5 shrink-0" />
            <div>
              <h2 className="text-[14px]">Lost your order number?</h2>
              <p className="text-[13px] text-muted">
                It&apos;s on your confirmation page
                {SENDS_CONFIRMATION ? " and email" : ""}.{" "}
                <Link
                  href="/contact"
                  className="font-bold text-accent underline underline-offset-2"
                >
                  {canReachStudio ? "Contact us" : "See how to reach us"}
                </Link>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
