import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { formatDate, money, pluralise } from "@/lib/format";
import {
  Button,
  ButtonLink,
  Field,
  Icon,
  Pagination,
  inputClass,
  pageFromParam,
} from "@/components/ui";
import { CHANNEL_LABEL, NoRows, PageHead, Panel, StatusPill } from "../ui";
import { PAGE_SIZE, listOrders, type OrderFilters } from "../data";

/**
 * Every order the shop has taken, newest first.
 *
 * The filters are a plain GET form — no client JavaScript, no state to keep in
 * sync. A filtered list is therefore a real URL: it survives a refresh, it can
 * be bookmarked, and the page links below carry the same filters rather than
 * silently widening the search when someone clicks page 2.
 *
 * `pending` never appears. Those rows are checkouts that were started and never
 * paid for; `listOrders` excludes them and there is deliberately no way to ask
 * for them here.
 */

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "open", label: "Still needs work" },
  { value: "confirmed", label: "Confirmed" },
  { value: "printing", label: "Printing" },
  { value: "packed", label: "Packed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const CHANNEL_OPTIONS = [
  { value: "", label: "Any channel" },
  ...Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })),
];

/** A query value is a string, a repeated string, or absent. Take the first. */
function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function hrefWith(filters: OrderFilters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.channel) params.set("channel", filters.channel);
  if (filters.q) params.set("q", filters.q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff("orders");

  const params = await searchParams;
  const filters: OrderFilters = {
    status: one(params.status),
    channel: one(params.channel),
    q: one(params.q),
  };

  /*
   * `pageFromParam` clamps to a page count that is not known until the query
   * has run. `listOrders` performs the same clamp itself and reports the page
   * it settled on, so the parse here only has to turn nonsense into 1 — the
   * real clamp comes back as `orders.page`.
   */
  const requestedPage = pageFromParam(params.page, Number.MAX_SAFE_INTEGER);
  const orders = await listOrders(requestedPage, filters);

  const filtered = Boolean(filters.status || filters.channel || filters.q);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Orders"
        subtitle="Everything the shop has sold, wherever it was sold."
        actions={
          <ButtonLink href="/admin/orders/new" size="md">
            <Icon name="plus" size={18} />
            Record a sale
          </ButtonLink>
        }
      />

      <Panel title="Find an order">
        <form method="get" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Status" htmlFor="status">
              <select
                id="status"
                name="status"
                defaultValue={filters.status}
                className={inputClass}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Channel" htmlFor="channel">
              <select
                id="channel"
                name="channel"
                defaultValue={filters.channel}
                className={inputClass}
              >
                {CHANNEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Search"
              htmlFor="q"
              hint="An order number, or the email it was placed with."
            >
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={filters.q}
                placeholder="BAM-1042 or jo@example.com"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm">
              <Icon name="search" size={17} />
              Search
            </Button>
            {filtered ? (
              <ButtonLink href="/admin/orders" variant="soft" size="sm">
                Clear
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </Panel>

      <Panel
        title={filtered ? "Matching orders" : "All orders"}
        note={`Newest first, ${PAGE_SIZE} to a page. Unpaid checkouts are not orders and are never listed.`}
        padded={false}
      >
        {orders.rows.length === 0 ? (
          <NoRows>
            {filtered ? (
              <>
                <p>No order matches that.</p>
                <p className="mt-2">
                  Try a wider status, or{" "}
                  <Link
                    href="/admin/orders"
                    className="font-bold text-accent underline underline-offset-2"
                  >
                    clear the filters
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <p>No orders yet. That is a normal state for a shop that has just opened.</p>
                <p className="mx-auto mt-2 max-w-[46ch]">
                  A sale you made at a market, on TikTok or to someone at work can be typed in,
                  and it counts in the reports exactly like an order from the website.
                </p>
                <p className="mt-4">
                  <ButtonLink href="/admin/orders/new" variant="soft" size="sm">
                    Record a sale
                  </ButtonLink>
                </p>
              </>
            )}
          </NoRows>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">ORDER</th>
                  <th className="px-5 py-3">DATE</th>
                  <th className="px-5 py-3">CHANNEL</th>
                  <th className="px-5 py-3">ITEMS</th>
                  <th className="px-5 py-3 text-right">TOTAL</th>
                  <th className="px-5 py-3">STATUS</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.rows.map((order) => (
                  <tr key={order.id} className="align-middle">
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-[13px] font-semibold">
                        {order.orderNumber ?? "—"}
                      </span>
                      <span className="block truncate text-[12.5px] text-faint">
                        {order.email}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {formatDate(order.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {CHANNEL_LABEL[order.channel] ?? order.channel}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap tabular-nums">
                      {pluralise(order.itemCount, "line")}
                    </td>
                    <td className="px-5 py-3.5 text-right font-bold tabular-nums">
                      {money(order.total)}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusPill status={order.status} />
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <ButtonLink
                        href={`/admin/orders/${order.id}`}
                        variant="soft"
                        size="sm"
                      >
                        Open
                      </ButtonLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-line">
          <Pagination
            page={orders.page}
            pageCount={orders.pageCount}
            total={orders.total}
            noun="orders"
            hrefFor={(page) => hrefWith(filters, page)}
          />
        </div>
      </Panel>
    </div>
  );
}
