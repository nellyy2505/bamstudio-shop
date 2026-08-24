import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs, Icon, Pill } from "@/components/ui";
import { ContactForm } from "./ContactForm";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Questions about an order, a return, a custom design or a market stall? Message Bam Studio — one of the three of us will answer.",
};

export default function ContactPage() {
  return (
    <div className="wrap pt-8">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Contact" }]} />

      <div className="mb-9 max-w-2xl">
        <h1 className="mb-2.5 text-3xl md:text-4xl">Talk to us</h1>
        <p className="text-muted">
          There is no support team here — it is the three of us, so you will get
          an actual answer from someone who printed the thing. Most messages are
          answered within one to two business days.
        </p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <ContactForm />

        <aside className="flex flex-col gap-4">
          <section className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream">
              <Icon name="mail" size={22} />
            </span>
            <h2 className="mt-4 text-lg">Email</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              Prefer your own inbox? Write to{" "}
              <a
                href={`mailto:${SHOP.supportEmail}`}
                className="font-bold text-accent underline underline-offset-2"
              >
                {SHOP.supportEmail}
              </a>
              . Include your order number if you have one.
            </p>
            <p className="mt-2 text-[12.5px] text-faint">
              Replies weekdays. Market weekends run a day or two behind.
            </p>
          </section>

          <section className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blush">
              <Icon name="camera" size={22} />
            </span>
            <h2 className="mt-4 text-lg">Social</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              New designs, print fails and restock news go up first on social.
              DMs get answered, just more slowly than email.
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
              <a
                href={SHOP.socials.instagram ?? "/contact"}
                className="text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                Instagram
              </a>
              <a
                href={SHOP.socials.tiktok ?? "/contact"}
                className="text-accent underline underline-offset-2 hover:text-accent-dark"
              >
                TikTok
              </a>
            </div>
          </section>

          <section className="card p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sage">
              <Icon name="pin" size={22} />
            </span>
            <h2 className="mt-4 text-lg">In person</h2>
            <p className="mt-1.5 text-[14px] text-muted">
              We run a stall at {SHOP.city} weekend markets with the DIY
              letter-charm bar, so you can spell a name and walk away with it.
            </p>
            <p className="mt-2 text-[14px] font-extrabold">
              Next stall: [MARKET NAME AND DATE]
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
            <p className="mt-1.5 text-[14px] text-muted">
              Party favours, a name run for a classroom, or a stockist order —
              tell us the quantity and the date you need it by. One printer means
              lead times grow with the order, so earlier is better.
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
            first — it is often faster than waiting for us.
          </p>
        </aside>
      </div>
    </div>
  );
}
