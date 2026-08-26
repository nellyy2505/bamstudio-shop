import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav, type AdminLink } from "./AdminNav";
import { can, requireStaff, ROLE_LABEL, type Capability } from "@/lib/auth/staff";
import { Pill } from "@/components/ui";

export const metadata: Metadata = {
  /*
   * `absolute`, because the root layout sets `title.template` to
   * "%s · Bam Studio" and a plain string here is a child title: Next runs it
   * through that template, so every staff page without its own title came out
   * as "Studio · Bam Studio · Bam Studio". `title.absolute` ignores a parent
   * template. It still carries no `template` of its own, so the pages that do
   * set a title ("Inventory · Studio", "Edit product · Studio") are printed as
   * written, which is what they already expect.
   */
  title: { absolute: "Studio · Bam Studio" },
  // Nothing here should ever be indexed, linked to, or previewed.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The staff area shell.
 *
 * `requireStaff()` here redirects anyone who is not staff, which covers every
 * page nested under it. It does NOT cover route handlers — a file at
 * `app/admin/**\/route.ts` is not wrapped by this layout, and neither is a
 * server action. Each of those calls `requireStaff()` itself. See the note at
 * the top of `lib/auth/staff.ts`.
 *
 * There is no special case for an unclaimed database. Not staff is not staff,
 * and everybody who is not staff gets the same answer. The note in
 * lib/auth/staff.ts explains what the special case used to leak.
 */
const ALL_LINKS: (AdminLink & { capability: Capability | null })[] = [
  { href: "/admin", label: "Overview", icon: "trend", capability: null },
  { href: "/admin/orders", label: "Orders", icon: "box", capability: "orders" },
  { href: "/admin/products", label: "Products", icon: "gift", capability: "catalogue" },
  { href: "/admin/inventory", label: "Inventory", icon: "truck", capability: "inventory" },
  { href: "/admin/reports", label: "Reports", icon: "doc", capability: "reports" },
  { href: "/admin/colours", label: "Colours", icon: "sparkle", capability: "colours" },
  { href: "/admin/settings", label: "Settings", icon: "shield", capability: "settings" },
  { href: "/admin/access", label: "Studio access", icon: "user", capability: "access" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaff();

  const links: AdminLink[] = ALL_LINKS.filter(
    (link) => link.capability === null || can(staff.role, link.capability),
  ).map(({ href, label, icon }) => ({ href, label, icon }));

  return (
    <div className="min-h-screen bg-bg">
      {/* A dark bar so nobody mistakes the staff area for the shop. */}
      <div className="bg-ink text-[#F8F5EF]">
        <div className="wrap flex items-center justify-between gap-6 py-2.5">
          <div className="flex items-center gap-3">
            <span className="font-display text-[15px] font-bold tracking-tight">
              Bam<span className="text-[#d98a63]">Studio</span>
            </span>
            <Pill tone="accent" className="!bg-accent !text-white">
              STAFF
            </Pill>
          </div>
          <div className="flex items-center gap-4 text-[13px]">
            <span className="hidden text-[#b2a89c] sm:inline">
              {staff.email} · {ROLE_LABEL[staff.role]}
            </span>
            <Link
              href="/"
              className="border-b border-[#56504a] text-[#F8F5EF] hover:border-[#F8F5EF]"
            >
              View shop
            </Link>
          </div>
        </div>
      </div>

      <div className="wrap grid items-start gap-8 pt-8 pb-16 lg:grid-cols-[244px_minmax(0,1fr)]">
        <aside className="card p-5 lg:sticky lg:top-8">
          <div className="mb-3 border-b border-line pb-3.5 pl-1 text-[11px] font-extrabold tracking-[0.1em] text-faint">
            STUDIO
          </div>
          <AdminNav links={links} />
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
