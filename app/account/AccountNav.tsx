"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cx, type IconName } from "@/components/ui";

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/account/orders", label: "Orders", icon: "box" },
  { href: "/account/favourites", label: "Favourites", icon: "heart" },
  { href: "/account/addresses", label: "Addresses", icon: "pin" },
  { href: "/account/settings", label: "Settings", icon: "user" },
];

/**
 * @param isStaff decided on the server by the layout above. This component
 *   cannot ask: the `staff` table is invisible to the key that reaches the
 *   browser, by design. Hiding the link is presentation — /admin does its own
 *   checking.
 */
export function AccountNav({ isStaff = false }: { isStaff?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
      {isStaff ? (
        <>
          <Link
            href="/admin"
            className="mb-1 flex items-center gap-2.5 rounded-xl bg-ink px-3.5 py-2.5 text-[14.5px] font-bold text-[#F8F5EF] transition-colors hover:bg-[#3B3630]"
          >
            <Icon name="shield" size={17} />
            Open the studio
          </Link>
          <hr className="mb-1 border-line" />
        </>
      ) : null}
      {LINKS.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14.5px] font-bold transition-colors",
              active ? "bg-cream text-ink" : "text-muted hover:text-ink",
            )}
          >
            <Icon name={link.icon} size={17} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
