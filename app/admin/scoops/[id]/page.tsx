import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { getScoopTier, listPoolCandidates } from "../../data";
import { PageHead, Stat } from "../../ui";
import { Breadcrumbs, ButtonLink, Pill } from "@/components/ui";
import { pluralise } from "@/lib/format";
import { ScoopTierForm } from "../ScoopTierForm";

export const metadata = { title: "Edit scoop tier · Studio" };

export default async function EditScoopTierPage({
  params,
}: {
  // Next.js 16: params is a Promise and has to be awaited.
  params: Promise<{ id: string }>;
}) {
  await requireStaff("catalogue");

  const { id } = await params;
  const [tier, products] = await Promise.all([getScoopTier(id), listPoolCandidates()]);

  if (!tier) notFound();

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Studio", href: "/admin" },
          { label: "Lucky Scoop", href: "/admin/scoops" },
          { label: tier.name },
        ]}
      />

      <PageHead
        title={tier.name}
        subtitle={
          <>
            <span className="font-mono">{tier.slug}</span> ·{" "}
            {pluralise(tier.pieceCount, "piece")} ·{" "}
            {tier.active ? "listed in the shop" : "a draft, not listed"}
          </>
        }
        actions={
          tier.active && tier.priceCents !== null ? (
            <ButtonLink href={`/scoop/${tier.slug}`} variant="soft" size="sm">
              View in the shop
            </ButtonLink>
          ) : (
            // No link to a page the shopfront will not serve: RLS refuses an
            // inactive or unpriced tier to the browser key, so the link would
            // be a 404 with her name on it.
            <Pill tone="line">Not on the shop yet</Pill>
          )
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="CAN FILL"
          value={String(tier.availability.scoopsAvailable)}
          note="whole scoops from what is on the shelf right now"
          tone={tier.availability.scoopsAvailable === 0 ? "warn" : undefined}
        />
        <Stat
          label="DRAWABLE"
          value={`${tier.availability.drawable} of ${tier.availability.poolSize}`}
          note="pool products that are switched on and have at least one on the shelf"
        />
        <Stat
          label="MEASURED"
          value={`${tier.costBasis.measured} of ${tier.availability.poolSize}`}
          note="pieces with a real cost — a suggested price needs all of them"
          tone={tier.costBasis.unmeasured > 0 ? "warn" : undefined}
        />
      </div>

      <ScoopTierForm tier={tier} products={products} />
    </div>
  );
}
