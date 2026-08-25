import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Icon } from "@/components/ui";
import { TrackForm } from "./TrackForm";
import { PRINT_LEAD_TIME, SHIPPING, transitLabel } from "@/lib/config";
import { canReachStudio, sendsOrderConfirmation } from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { money } from "@/lib/format";

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
 * so this reads the same secrets the Stripe webhook does. `canReachStudio` —
 * is there a mailbox or a social account behind "message us" — comes from
 * lib/contact.ts, shared with /contact, /about and the legal pages.
 */
const SENDS_CONFIRMATION = sendsOrderConfirmation(isEmailConfigured());

export const metadata: Metadata = {
  title: "Track your order",
  description:
    "Check where your Bam Studio order is — confirmed, printing, packed or shipped — with your order number and email. No account needed.",
};

const NOTES = [
  {
    icon: "box" as const,
    title: "Printing comes first",
    body: `Nothing is posted until it is printed, and printing takes ${PRINT_LEAD_TIME.label}. An order sitting on "Printing" for a couple of days is behaving normally.`,
  },
  {
    icon: "truck" as const,
    title: "Then the post",
    body: `Standard post is ${money(SHIPPING.methods[0].price)} (${transitLabel("standard")}); express is ${money(SHIPPING.methods[1].price)} (${transitLabel("express")}).`,
  },
  {
    icon: "lock" as const,
    title: "Guest friendly",
    body: "We match the order number against the email you ordered with, so nobody can look up a parcel that is not theirs.",
  },
];

export default function TrackPage() {
  return (
    <div className="wrap pt-8">
      <Breadcrumbs
        items={[{ label: "Home", href: "/" }, { label: "Track your order" }]}
      />

      <div className="mb-9 max-w-2xl">
        <h1 className="mb-2.5 text-3xl md:text-4xl">Where is my order?</h1>
        <p className="text-muted">
          Every order goes through the same four stages — confirmed, printing,
          packed, shipped. Put in your order number and email to see which one
          yours is on.
        </p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <TrackForm />

        <aside className="flex flex-col gap-4">
          {NOTES.map((note) => (
            <section key={note.title} className="card p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream">
                <Icon name={note.icon} size={22} />
              </span>
              <h2 className="mt-4 text-lg">{note.title}</h2>
              <p className="mt-1.5 text-[14px] text-muted">{note.body}</p>
            </section>
          ))}

          {/* Leads with the confirmation page, which shows the order number on
              screen in every configuration. The confirmation email carries it
              too, but only while the Resend secrets are set, and it is queued
              after the response and can fail — so it is named as a second place
              to look rather than the place, and only when one is actually
              sent. */}
          <p className="px-1 text-[13px] text-muted">
            Do not have your order number? It is shown on the confirmation page
            straight after you pay
            {SENDS_CONFIRMATION
              ? ", and on the confirmation email if one reached you"
              : ""}
            . If you have lost it,{" "}
            <Link
              href="/contact"
              className="font-bold text-accent underline underline-offset-2"
            >
              {canReachStudio ? "message us" : "see how to reach us"}
            </Link>
            {canReachStudio ? " — we can look it up from our side." : "."}
          </p>
        </aside>
      </div>
    </div>
  );
}
