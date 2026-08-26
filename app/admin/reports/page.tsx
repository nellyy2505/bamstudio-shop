import { requireStaff } from "@/lib/auth/staff";
import { money, pluralise } from "@/lib/format";
import { Alert, ButtonLink, EmptyState, Icon } from "@/components/ui";
import { CHANNEL_LABEL, PageHead, Panel, Stat } from "../ui";
import { getReports } from "../data";

/**
 * The numbers, over real rows only.
 *
 * A shop that has taken no orders gets a sentence saying so and nothing else —
 * no zero tiles, no empty axis, no sample month. A placeholder is not a neutral
 * thing to leave lying around: it is a false statement that somebody eventually
 * makes a decision on, and it is harder to clear out later than it is to never
 * draw.
 *
 * There are no charts here yet, on purpose. Two months of data drawn as a line
 * says less than two months of data written as a table, and it says it less
 * honestly — the eye reads a trend into a slope that is one order wide.
 */
export default async function ReportsPage() {
  await requireStaff("reports");

  const reports = await getReports();

  if (reports.empty) {
    return (
      <div className="flex flex-col gap-7">
        <PageHead title="Reports" />
        <Panel padded={false}>
          <EmptyState
            icon={<Icon name="trend" size={34} />}
            title="Nothing to report yet"
            body="The shop has not taken an order, so there is no revenue, no profit and no month to compare against."
          >
            <ButtonLink href="/admin/orders/new" variant="soft" size="sm">
              Record a sale
            </ButtonLink>
          </EmptyState>
          <p className="mx-auto max-w-[52ch] px-5 pb-12 text-center text-[13.5px] text-muted">
            This page fills itself in the moment the shop takes one — from the website, or from
            a sale at a market typed in by hand. Until then there is deliberately nothing here
            to read, because a page of zeroes reads like a shop that is failing rather than a
            shop that has not opened.
          </p>
        </Panel>
      </div>
    );
  }

  // Aliased so the null check narrows the value used below — profit is cents as
  // a float, and it is rounded once, here at the display boundary.
  const profit = reports.profit;
  const showProfit = profit !== null;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Reports"
        subtitle="Every paid order, counted once. Cancelled orders and unpaid checkouts are left out."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="ORDERS"
          value={String(reports.orderCount)}
          note="paid, not cancelled"
        />
        <Stat
          label="PIECES SOLD"
          value={String(reports.unitCount)}
          note="across every channel"
        />
        <Stat label="REVENUE" value={money(reports.revenue)} note="what customers paid" />
        {showProfit ? (
          <Stat
            label="PROFIT"
            value={money(Math.round(profit))}
            note="after the card fee and what the pieces cost to make"
          />
        ) : (
          <Stat
            label="PROFIT"
            value="—"
            tone="warn"
            note="not one sold line carries a recorded cost, so this cannot be worked out"
          />
        )}
      </div>

      {!showProfit ? (
        <Alert tone="error">
          Profit is blank because no line on any order has a making cost recorded against it.
          That happens when a product has never been given a print time or a filament recipe —
          give it both on its product page and every sale from then on will carry its cost.
          Revenue minus a card fee is not a profit, so it is not shown as one.
        </Alert>
      ) : reports.linesWithoutCost > 0 ? (
        <Alert>
          {pluralise(reports.linesWithoutCost, "sold line")} carry no making cost, so the
          profit above understates what was spent. Measure those products and the figure
          tightens; sales already recorded keep the cost they were stamped with.
        </Alert>
      ) : null}

      <Panel
        title="By month"
        note="Oldest first. A month with no orders is simply absent — it is not drawn as a zero."
        padded={false}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                <th className="px-5 py-3">MONTH</th>
                <th className="px-5 py-3 text-right">ORDERS</th>
                <th className="px-5 py-3 text-right">REVENUE</th>
                {showProfit ? <th className="px-5 py-3 text-right">PROFIT</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reports.byMonth.map((point) => (
                <tr key={point.label}>
                  <td className="px-5 py-3.5 whitespace-nowrap font-semibold">{point.label}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{point.orders}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{money(point.revenue)}</td>
                  {showProfit ? (
                    <td className="px-5 py-3.5 text-right tabular-nums">
                      {money(Math.round(point.profit))}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3.5 text-[13px] text-faint">
          Charts arrive once there are a few months to put on one — until then a table says
          more.
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="By channel"
          note="Where the money came from."
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">CHANNEL</th>
                  <th className="px-5 py-3 text-right">ORDERS</th>
                  <th className="px-5 py-3 text-right">REVENUE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.byChannel.map((row) => (
                  <tr key={row.channel}>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {CHANNEL_LABEL[row.channel] ?? row.channel}
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{row.orders}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{money(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Best sellers"
          note="By pieces sold, top ten."
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">PRODUCT</th>
                  <th className="px-5 py-3 text-right">PIECES</th>
                  <th className="px-5 py-3 text-right">REVENUE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.topProducts.map((row) => (
                  <tr key={row.name}>
                    <td className="px-5 py-3.5">{row.name}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{row.units}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums">{money(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
