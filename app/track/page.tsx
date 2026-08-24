import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Icon } from "@/components/ui";
import { TrackForm } from "./TrackForm";
import { PRINT_LEAD_TIME, SHIPPING } from "@/lib/config";
import { money } from "@/lib/format";

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
    body: `Standard post is ${money(SHIPPING.methods[0].price)} (${SHIPPING.methods[0].description}); express is ${money(SHIPPING.methods[1].price)} (${SHIPPING.methods[1].description}).`,
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

          <p className="px-1 text-[13px] text-muted">
            Lost the confirmation email? Check the spam folder first, then{" "}
            <Link
              href="/contact"
              className="font-bold text-accent underline underline-offset-2"
            >
              message us
            </Link>{" "}
            — we can look it up from our side.
          </p>
        </aside>
      </div>
    </div>
  );
}
