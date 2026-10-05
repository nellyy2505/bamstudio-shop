import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav, type AdminGroup, type AdminLink } from "./AdminNav";
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
 * page nested under it. It does NOT cover route handlers - a file at
 * `app/admin/**\/route.ts` is not wrapped by this layout, and neither is a
 * server action. Each of those calls `requireStaff()` itself. See the note at
 * the top of `lib/auth/staff.ts`.
 *
 * There is no special case for an unclaimed database. Not staff is not staff,
 * and everybody who is not staff gets the same answer. The note in
 * lib/auth/staff.ts explains what the special case used to leak.
 */
/**
 * Every screen in the studio, grouped by what you are doing rather than listed
 * flat, and each carrying the capability that may see it.
 *
 * Grouping is presentation. `lib/auth/staff.ts` decides who may see what, on the
 * server, with the service-role key, and every page behind these links calls
 * `requireStaff()` for itself - hiding a link is tidiness, not protection.
 *
 * Note what is NOT here: /admin/products/pricing. Repricing is a screen within
 * the catalogue, reached from the Products header, and giving it a nav entry
 * would both light up two rows at once and imply it is a place rather than a
 * job.
 */
const NAV: { label: string; links: (AdminLink & { capability: Capability | null })[] }[] = [
  {
    // What is waiting for you. First because it is what you open the studio to
    // find out.
    label: "Today",
    links: [
      { href: "/admin", label: "Overview", icon: "trend", capability: null },
      { href: "/admin/orders", label: "Orders", icon: "box", capability: "orders" },
      /*
       * Filed under "reports" rather than "orders" so Packing cannot reach it.
       * The screen shows a customer's own words and the address they wrote from,
       * and the person helping post parcels has no reason to read either. The
       * full argument, including why `settings` was rejected and why a capability
       * of its own would be better than borrowing this one, is above
       * `setEnquiryHandled` in actions.ts.
       */
      { href: "/admin/enquiries", label: "Enquiries", icon: "msg", capability: "reports" },
    ],
  },
  {
    // What you sell, and what it costs.
    label: "Catalogue",
    links: [
      { href: "/admin/products", label: "Products", icon: "gift", capability: "catalogue" },
      /*
       * Its own entry rather than a page under Products, because a tier is not a
       * product: its price starts null, its stock is a property of a pool of
       * other rows, and its cost is not knowable until somebody packs one.
       * Guarded by "catalogue" for the same reason `saveScoopTier` is - a tier's
       * price, piece count and packed weight are the catalogue's kind of
       * authority.
       */
      { href: "/admin/scoops", label: "Lucky Scoop", icon: "bag", capability: "catalogue" },
      /*
       * Its own entry rather than a page under Products, for the reason Lucky
       * Scoop has one: a bakery box is not one product to edit but four things
       * that all have to line up before anything sells - a priced box, a design,
       * a colour and a pool. The screen leads with which of them are missing.
       */
      { href: "/admin/bakery", label: "Bakery box", icon: "gift", capability: "catalogue" },
      { href: "/admin/colours", label: "Colours", icon: "sparkle", capability: "colours" },
    ],
  },
  {
    // What you have on the shelf, and how it has been going.
    label: "Making",
    links: [
      { href: "/admin/inventory", label: "Inventory", icon: "truck", capability: "inventory" },
      { href: "/admin/reports", label: "Reports", icon: "doc", capability: "reports" },
    ],
  },
  {
    // The machinery. Last because it is the least often opened and the most
    // consequential when it is.
    label: "Studio",
    links: [
      { href: "/admin/settings", label: "Settings", icon: "shield", capability: "settings" },
      { href: "/admin/access", label: "Studio access", icon: "user", capability: "access" },
    ],
  },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await requireStaff();

  /*
   * Filtered per group, and a group that loses every link is not rendered at all
   * (AdminNav drops it) rather than left as a heading over nothing. Somebody
   * with only the packing role should not be shown a Catalogue section she
   * cannot open.
   */
  const groups: AdminGroup[] = NAV.map((group) => ({
    label: group.label,
    links: group.links
      .filter((link) => link.capability === null || can(staff.role, link.capability))
      .map(({ href, label, icon }): AdminLink => ({ href, label, icon })),
  }));

  return (
    <div className="min-h-screen bg-bg print:min-h-0">
      {/*
        * A dark bar so nobody mistakes the staff area for the shop.
        *
        * `no-print` on both this and the sidebar below: the packing slip and
        * the pick list are rendered inside this layout, and a printed page has
        * no navigation. It is also a solid dark block the width of the paper,
        * which is the single most expensive thing a home printer could be
        * asked to lay down. See the print block at the end of globals.css.
        */}
      <div className="no-print bg-ink text-[#F8F5EF]">
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

      {/* `print:block` because the sidebar is hidden on paper and a two-column
          grid would otherwise leave its empty track behind; `print:p-0` because
          the page box in globals.css already provides the margin. */}
      <div className="wrap grid items-start gap-8 pt-8 pb-16 lg:grid-cols-[244px_minmax(0,1fr)] print:block print:p-0">
        <aside className="no-print card p-5 lg:sticky lg:top-8">
          <div className="mb-3 border-b border-line pb-3.5 pl-1 text-[11px] font-extrabold tracking-[0.1em] text-faint">
            STUDIO
          </div>
          <AdminNav groups={groups} />
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
