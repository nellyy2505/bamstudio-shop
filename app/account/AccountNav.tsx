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

export function AccountNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Account" className="flex flex-col gap-1">
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
