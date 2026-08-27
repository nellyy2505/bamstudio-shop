import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { listScoopTiers, type ScoopTierRow } from "../data";
import { NoRows, PageHead, Panel, Stat, Unknown } from "../ui";
import { ButtonLink, Icon, Pill } from "@/components/ui";
import { money, pluralise } from "@/lib/format";
import { SCOOP_THEMES } from "@/lib/types";

export const metadata = { title: "Lucky Scoop · Studio" };

/**
 * The tiers — the thing a customer actually buys.
 *
 * WHAT THIS SCREEN IS FOR. A scoop is the one product in this shop that is sold
 * before anybody knows what is in it, so everything that makes it honest has to
 * be decided here rather than at the moment of sale: what it costs, how many
 * pieces it promises, and what may be drawn into it. Every one of those is a
 * row, never a literal in code.
 *
 * NO PAGER, for the reason the measuring screen has none: there will be a
 * handful of tiers, not a catalogue, and a pager over four rows is a pager that
 * hides one of them.
 *
 * "CAN FILL" IS A PRINT SIGNAL, NOT A GATE, and that is the one thing to keep
 * straight on this screen. It used to be both: a tier whose pool could not fill
 * a scoop off the shelf stopped being offered to customers at all. That was
 * wrong — the shop prints to order, so a short bowl is topped up before packing
 * (`lib/scoop.ts` records the correction). The number is still here because it
 * is worth acting on: a bowl down to its last scoop or two is a print job. It
 * decides nothing.
 *
 * NOTHING IS RE-DERIVED HERE. `lib/scoop.ts` owns both the fill arithmetic and
 * the question of whether a tier is on sale, and `listScoopTiers` has already
 * asked it. A second copy on a screen is how the studio and the shopfront start
 * disagreeing.
 */
export default async function ScoopsPage() {
  await requireStaff("catalogue");

  const tiers = await listScoopTiers();

  const onSale = tiers.filter((tier) => tier.availability.sellable).length;
  const unpriced = tiers.filter((tier) => tier.priceCents === null).length;
  // A bowl that cannot fill one scoop off the shelf. NOT a sales problem — the
  // tier keeps selling and she prints before packing — but it is the row to
  // look at first, so it is counted where she will see it.
  const needPrinting = tiers.filter(
    (tier) => tier.availability.sellable && tier.availability.scoopsAvailable === 0,
  ).length;

  return (
    <div>
      <PageHead
        title="Lucky Scoop"
        subtitle="A tier is what a customer buys — “Pet scoop, five pieces”. The pieces are drawn from the pool you set here."
        actions={
          <ButtonLink href="/admin/scoops/new" size="md">
            <Icon name="plus" size={18} />
            Add a tier
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="TIERS" value={String(tiers.length)} note="drafts included" />
        <Stat
          label="FOR SALE NOW"
          value={String(onSale)}
          note="switched on and priced — the shop is offering these"
        />
        <Stat
          label="NOT PRICED"
          value={String(unpriced)}
          note="a tier with no price cannot be switched on"
          tone={unpriced > 0 ? "warn" : undefined}
        />
        <Stat
          label="NEED A PRINT"
          value={String(needPrinting)}
          note="still selling — but the bowl can't fill one without printing first"
          tone={needPrinting > 0 ? "warn" : undefined}
        />
      </div>

      <Panel padded={false}>
        {tiers.length === 0 ? (
          <NoRows>
            No scoop tiers yet.{" "}
            <Link href="/admin/scoops/new" className="font-bold text-accent">
              Add the first one
            </Link>{" "}
            — it stays a draft until you have priced and weighed it.
          </NoRows>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">TIER</th>
                  <th className="px-5 py-3 text-right">PIECES</th>
                  <th className="px-5 py-3 text-right">PRICE</th>
                  <th className="px-5 py-3 text-right">POOL</th>
                  <th className="px-5 py-3">RIGHT NOW</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tiers.map((tier) => (
                  <TierRow key={tier.id} tier={tier} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="mt-4 text-[13px] text-muted">
        A tier is offered to customers whenever it is switched on and priced. “Can fill” is what the
        bowl holds right now without printing anything — a number to print against, not a reason to
        stop selling. Everything here is printed to order, a scoop included: if the bowl is short
        when you come to pack, print the rest and scoop.
      </p>
    </div>
  );
}

const THEME_LABEL = new Map(SCOOP_THEMES.map((theme) => [theme.value, theme.label]));

function TierRow({ tier }: { tier: ScoopTierRow }) {
  return (
    <tr>
      <td className="px-5 py-3.5">
        <Link
          href={`/admin/scoops/${tier.id}`}
          className="font-semibold hover:text-accent"
        >
          {tier.name}
        </Link>
        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span className="font-mono">{tier.slug}</span>
          <span>· {THEME_LABEL.get(tier.theme) ?? tier.theme}</span>
          {tier.active ? (
            <Pill tone="good">in the shop</Pill>
          ) : (
            <Pill tone="line">draft</Pill>
          )}
        </span>
      </td>

      <td className="px-5 py-3.5 text-right tabular-nums">{tier.pieceCount}</td>

      <td className="px-5 py-3.5 text-right tabular-nums">
        {/* Null is "not priced yet", which is a fact. It is never $0.00 — a zero
            here would read as a free scoop, and the column refuses to hold one. */}
        {tier.priceCents === null ? (
          <Unknown what="Not priced yet" />
        ) : (
          money(tier.priceCents)
        )}
      </td>

      <td className="px-5 py-3.5 text-right tabular-nums">
        {tier.availability.poolSize}
        <span className="block text-[12px] text-faint">
          {/* "0 of 0 measured" is a number about nothing. An empty pool says so. */}
          {tier.availability.poolSize === 0
            ? "nothing in it yet"
            : tier.costBasis.unmeasured === 0
              ? "all measured"
              : `${tier.costBasis.measured} of ${tier.availability.poolSize} measured`}
        </span>
      </td>

      <td className="px-5 py-3.5">
        {/*
          Two independent facts, and they are shown as two things because that
          is what they are. Whether the shop is offering the tier, and how much
          the bowl holds. A tier can be selling briskly with an empty bowl —
          that is not a fault, it is a print job.
        */}
        {tier.availability.sellable ? (
          tier.availability.scoopsAvailable > 0 ? (
            <span className="font-semibold text-good">
              Can fill {pluralise(tier.availability.scoopsAvailable, "scoop")}
            </span>
          ) : (
            <span className="text-[13.5px] text-warn">
              Selling — print before the next one is packed
            </span>
          )
        ) : (
          // Her words, from lib/scoop.ts, not a constraint name and not a bare
          // "unavailable". A tier that has gone quiet is exactly the thing she
          // has to be able to explain.
          <span className="text-[13.5px] text-warn">
            {tier.availability.blockers.join(" · ")}
          </span>
        )}
      </td>
    </tr>
  );
}
