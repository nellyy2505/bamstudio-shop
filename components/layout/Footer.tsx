import Link from "next/link";
import { PAYMENT_BADGES, SHOP } from "@/lib/config";
import { formsReachStudio, hasSocialAccount } from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { NewsletterForm } from "./NewsletterForm";

const COLUMNS = [
  {
    heading: "Shop",
    links: [
      { href: "/shop", label: "All products" },
      { href: "/shop?category=Clicker+keychain", label: "Clicker keychains" },
      { href: "/builder", label: "Design Your Own" },
      { href: "/collections", label: "Collections" },
      { href: "/shop?max=1500", label: "Gifts under $15" },
    ],
  },
  {
    heading: "Help",
    links: [
      { href: "/track", label: "Track your order" },
      { href: "/faq#shipping", label: "Shipping & delivery" },
      { href: "/faq#returns", label: "Returns & exchanges" },
      { href: "/faq", label: "FAQ" },
      { href: "/contact", label: "Contact us" },
    ],
  },
];

export function Footer() {
  /**
   * The sign-up box is offered only where the request can actually reach a
   * person: /api/newsletter forwards it as an email to the studio mailbox, so
   * without sending capability *and* a mailbox there is nobody at the other
   * end and nothing stores the address either. Collecting addresses that reach
   * no one is the false promise, not the wording on the button.
   *
   * This footer is a server component, so the capability is `isEmailConfigured()`
   * — the same secrets the route checks per request. It used to be a public
   * build flag, which could be false while the secrets were set, hiding a
   * sign-up box that would have worked.
   */
  const canForwardSignups = formsReachStudio(isEmailConfigured());

  return (
    <footer className="mt-20 bg-[#2B2724] text-[#BDB6AA]">
      <div className="wrap pt-14 pb-7">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1.4fr]">
          <div>
            <p className="mb-3 font-display text-[27px] font-bold text-[#F6F2EA]">
              Bam<span className="text-accent">Studio</span>
            </p>
            <p className="mb-4 max-w-[250px] text-[13.5px]">
              Cute, clicky, 3D-printed keepsakes — designed by our family,
              printed to order in {SHOP.city}.
            </p>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_BADGES.map((name) => (
                <span
                  key={name}
                  className="rounded-md border border-[#46403A] px-2 py-1 text-[10px] font-extrabold text-[#D8D2C6]"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h4 className="mb-3.5 font-display text-sm text-[#F6F2EA]">
                {column.heading}
              </h4>
              <div className="flex flex-col gap-2.5 text-[13.5px]">
                {column.links.map((link) => (
                  <Link key={link.href} href={link.href} className="hover:text-white">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}

          <div>
            <h4 className="mb-3.5 font-display text-sm text-[#F6F2EA]">
              {canForwardSignups ? "Hear about new drops" : "New drops"}
            </h4>
            {/* No list exists yet, so no frequency and no "you're subscribed"
                is promised anywhere — this asks the studio to note you down. */}
            {canForwardSignups ? (
              <>
                <p className="mb-3 text-[13.5px]">
                  There is no mailing list yet. Leave your address and we will
                  pass it to the studio to keep for when there is one.
                </p>
                <NewsletterForm />
              </>
            ) : (
              <p className="mb-3 text-[13.5px]">
                {hasSocialAccount
                  ? "New designs go up on our socials first."
                  : "New designs go up in the shop as they come off the printer."}
              </p>
            )}
            {/* Both URLs are env-configured and null until they're set, so a
                missing one is simply not linked rather than rendered dead. */}
            <div className="mt-4 flex gap-4 text-[13px]">
              {SHOP.socials.instagram ? (
                <a href={SHOP.socials.instagram} className="hover:text-white">
                  Instagram
                </a>
              ) : null}
              {SHOP.socials.tiktok ? (
                <a href={SHOP.socials.tiktok} className="hover:text-white">
                  TikTok
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-11 flex flex-col gap-3 border-t border-[#423C34] pt-5 text-[12.5px] text-[#948D80] sm:flex-row sm:justify-between">
          <span>
            © {new Date().getFullYear()} {SHOP.name} · {SHOP.city},{" "}
            {SHOP.country}
            {SHOP.abn ? ` · ABN ${SHOP.abn}` : ""}
          </span>
          <span className="flex gap-4">
            <Link href="/legal/privacy" className="hover:text-white">
              Privacy policy
            </Link>
            <Link href="/legal/terms" className="hover:text-white">
              Terms of service
            </Link>
            <Link href="/legal/refunds" className="hover:text-white">
              Refund policy
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
