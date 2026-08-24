import Link from "next/link";
import { SHOP } from "@/lib/config";
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

const PAYMENTS = ["VISA", "MASTERCARD", "PAYPAL", "APPLE PAY"];

export function Footer() {
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
              {PAYMENTS.map((name) => (
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
              Stay in the loop
            </h4>
            <p className="mb-3 text-[13.5px]">
              New drops and {SHOP.city} market dates, about once a month.
            </p>
            <NewsletterForm />
            <div className="mt-4 flex gap-4 text-[13px]">
              <a href={SHOP.socials.instagram} className="hover:text-white">
                Instagram
              </a>
              <a href={SHOP.socials.tiktok} className="hover:text-white">
                TikTok
              </a>
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
