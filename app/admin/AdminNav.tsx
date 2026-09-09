"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, cx, type IconName } from "@/components/ui";

/**
 * The staff-area sidebar.
 *
 * A client component only because it needs `usePathname()` to mark the current
 * page. It takes the list of links it may show as a prop - it never works out
 * permissions itself. `lib/auth/staff.ts` decides that on the server with the
 * service-role key, and this file could not check even if it wanted to: the
 * `staff` table is unreadable with the key that reaches the browser.
 *
 * Hiding a link is presentation, not protection. Every page behind these links
 * calls `requireStaff()` for itself.
 */
export type AdminLink = { href: string; label: string; icon: IconName };

/** A heading and the links under it. A group with no visible links is dropped. */
export type AdminGroup = { label: string; links: AdminLink[] };

/**
 * Ten links in one flat column, in no particular order, was hard to scan and
 * left nowhere obvious to put anything new. Four groups by what you are doing:
 * Today is what is waiting, Catalogue is what you sell, Making is what you have
 * and what it did, Studio is the machinery.
 *
 * The groups are presentation only. Which links exist is decided on the server
 * by capability, and a group whose links were all filtered out never renders a
 * heading - a person with the packing role should not be told there is a
 * Catalogue section she cannot open.
 */
export function AdminNav({ groups }: { groups: AdminGroup[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5" aria-label="Studio">
      {groups
        .filter((group) => group.links.length > 0)
        .map((group) => (
          <div key={group.label} className="flex flex-col gap-1.5">
            <div className="pl-3 text-[10.5px] font-extrabold tracking-[0.1em] text-faint">
              {group.label.toUpperCase()}
            </div>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(pathname, link.href) ? "page" : undefined}
                className={cx(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px]",
                  isActive(pathname, link.href)
                    ? "bg-accent-soft font-extrabold text-accent-dark"
                    : "text-muted hover:bg-cream hover:text-ink",
                )}
              >
                <Icon name={link.icon} size={19} />
                {link.label}
              </Link>
            ))}
          </div>
        ))}
    </nav>
  );
}

/**
 * Whether a link is the page you are on.
 *
 * `/admin` is exact, or it would light up on every screen in the studio. The
 * rest match by prefix, so a product's own page and the repricing screen both
 * keep Products highlighted - which is the intent: repricing is a screen within
 * the catalogue, reached from the Products header, not an eleventh place to go.
 *
 * The `/` is appended before the prefix test rather than left off, so that
 * `/admin/orders` cannot also claim a future `/admin/orders-archive`. Two nav
 * entries where one href is a prefix of the other would light up together, and
 * nothing in the groups below is arranged that way; if one is ever added, this
 * needs to become a longest-match rather than gaining a special case.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
