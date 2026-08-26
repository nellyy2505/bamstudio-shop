"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cx, type IconName } from "@/components/ui";

/**
 * The staff-area sidebar.
 *
 * A client component only because it needs `usePathname()` to mark the current
 * page. It takes the list of links it may show as a prop — it never works out
 * permissions itself. `lib/auth/staff.ts` decides that on the server with the
 * service-role key, and this file could not check even if it wanted to: the
 * `staff` table is unreadable with the key that reaches the browser.
 *
 * Hiding a link is presentation, not protection. Every page behind these links
 * calls `requireStaff()` for itself.
 */
export type AdminLink = { href: string; label: string; icon: IconName };

export function AdminNav({ links }: { links: AdminLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1.5" aria-label="Studio">
      {links.map((link) => {
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px]",
              active
                ? "bg-accent-soft font-extrabold text-accent-dark"
                : "text-muted hover:bg-cream hover:text-ink",
            )}
          >
            <Icon name={link.icon} size={19} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
