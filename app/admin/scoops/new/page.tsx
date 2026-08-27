import { requireStaff } from "@/lib/auth/staff";
import { listPoolCandidates } from "../../data";
import { PageHead } from "../../ui";
import { Breadcrumbs } from "@/components/ui";
import { ScoopTierForm } from "../ScoopTierForm";

export const metadata = { title: "New scoop tier · Studio" };

/**
 * A new tier arrives as a draft, whatever is ticked.
 *
 * `scoop_tiers.active` defaults to false in the schema for the same reason, and
 * `saveScoopTier` inserts the row inactive even when "listed in the shop" is
 * ticked — the pool does not exist yet at that instant, so the database would
 * refuse an active row. It is switched on in the same save, once the pool is in.
 */
export default async function NewScoopTierPage() {
  await requireStaff("catalogue");

  const products = await listPoolCandidates();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Studio", href: "/admin" },
          { label: "Lucky Scoop", href: "/admin/scoops" },
          { label: "New tier" },
        ]}
      />

      <PageHead
        title="New scoop tier"
        subtitle="Name it, say how many pieces it promises, and tick what may be drawn into it. Price and weight can wait — it stays a draft until they are in."
      />

      <ScoopTierForm tier={null} products={products} />
    </div>
  );
}
