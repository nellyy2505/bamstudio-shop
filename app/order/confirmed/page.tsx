import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/ProductArt";
import { ButtonLink, Icon, Pill } from "@/components/ui";
import { ClearCartOnMount } from "./ClearCartOnMount";
import { getStripe } from "@/lib/stripe";
import { isDatabaseConfigured } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import { money } from "@/lib/format";
import type { ArtKey, Tint } from "@/lib/types";

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: { index: false },
};

type SearchParams = Promise<{ session_id?: string | string[] }>;

const STEPS = ["Confirmed", "Printing", "Packed", "Shipped"];

type LineSummary = {
  name?: string;
  art?: string;
  tint?: string;
  variant?: string;
  unit_price?: number;
  quantity?: number;
};

export default async function OrderConfirmedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const sessionId = Array.isArray(params.session_id)
    ? params.session_id[0]
    : params.session_id;

  let email: string | null = null;
  let total: number | null = null;
  let items: LineSummary[] = [];
  let firstName = "";
  let shippingLine: string | null = null;

  // Read the session straight from Stripe so the page is correct even if the
  // webhook has not landed yet.
  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);
      email = session.customer_details?.email ?? null;
      total = session.amount_total ?? null;
      firstName = (session.collected_information?.shipping_details?.name ?? "")
        .split(" ")[0]
        .trim();

      const address = session.collected_information?.shipping_details?.address;
      if (address) {
        shippingLine = [
          address.line1,
          address.line2,
          address.city,
          address.state,
          address.postal_code,
        ]
          .filter(Boolean)
          .join(", ");
      }

      // Line items live in our own database, staged when the session was
      // created — Stripe's metadata is too small to carry a basket.
      if (isDatabaseConfigured()) {
        const supabase = await createClient();
        const { data: order } = await supabase
          .from("orders")
          .select("id, order_items(product_name, variant_label, art, tint, unit_price, quantity)")
          .eq("stripe_session_id", sessionId)
          .maybeSingle();

        const rows = (order as { order_items?: LineSummary[] } | null)
          ?.order_items;
        if (Array.isArray(rows)) {
          items = rows.map((row) => ({
            name: (row as unknown as { product_name?: string }).product_name,
            variant: (row as unknown as { variant_label?: string }).variant_label,
            art: row.art,
            tint: row.tint,
            unit_price: row.unit_price,
            quantity: row.quantity,
          }));
        }
      }

      // Fall back to Stripe's own line items when there is no order row yet.
      if (items.length === 0) {
        const lineItems = await getStripe().checkout.sessions.listLineItems(
          sessionId,
          { limit: 100 },
        );
        items = lineItems.data.map((item) => ({
          name: item.description ?? "Item",
          unit_price: item.price?.unit_amount ?? 0,
          quantity: item.quantity ?? 1,
        }));
      }
    } catch (error) {
      console.error("Could not read checkout session:", error);
    }
  }

  return (
    <div className="wrap max-w-3xl pt-12">
      <ClearCartOnMount />

      <div className="mb-8 flex flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-good-soft text-good">
          <Icon name="check" size={36} strokeWidth={2.4} />
        </span>
        <h1 className="mt-5 mb-2 text-3xl md:text-[34px]">
          {firstName ? `Thanks ${firstName} — ` : "Thanks — "}order confirmed!
        </h1>
        <p className="text-muted">
          {email ? (
            <>
              A receipt is on its way to <b className="text-ink">{email}</b>
            </>
          ) : (
            "A receipt is on its way to your inbox."
          )}
        </p>
      </div>

      <div className="card mb-6 p-7">
        <div className="mb-7 flex justify-between">
          {STEPS.map((step, i) => (
            <div
              key={step}
              className="relative flex flex-1 flex-col items-center gap-2.5"
            >
              {i < STEPS.length - 1 ? (
                <span className="absolute top-4 left-[calc(50%+22px)] right-[calc(-50%+22px)] h-0.5 bg-line" />
              ) : null}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-extrabold ${
                  i === 0
                    ? "bg-good text-white"
                    : "border border-line2 bg-surface text-faint"
                }`}
              >
                {i === 0 ? <Icon name="check" size={15} strokeWidth={2.6} /> : i + 1}
              </span>
              <span
                className={`text-[12.5px] font-extrabold ${i === 0 ? "text-ink" : "text-faint"}`}
              >
                {step}
              </span>
            </div>
          ))}
        </div>

        <p className="flex items-start gap-2.5 rounded-xl bg-cream px-4 py-3.5 text-[13.5px] text-muted">
          <Icon name="box" size={18} className="mt-px shrink-0" />
          <span>
            Your pieces are <b className="text-ink">printed to order</b> —
            printing usually takes {PRINT_LEAD_TIME.label}, then tracking lands
            in your inbox the moment it ships.
          </span>
        </p>
      </div>

      {items.length > 0 ? (
        <div className="card mb-6 p-6">
          <b className="text-[15px]">Your order</b>
          <div className="mt-2">
            {items.map((item, i) => (
              <div
                key={`${item.name}-${i}`}
                className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
              >
                <ProductImage
                  art={(item.art as ArtKey) ?? "macaron"}
                  tint={(item.tint as Tint) ?? "cream"}
                  alt=""
                  size={48}
                  rounded="rounded-lg"
                />
                <div className="min-w-0 flex-1 text-[13.5px]">
                  <b>{item.name}</b>
                  {item.variant ? (
                    <p className="text-[12.5px] text-muted">{item.variant}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-[13.5px]">
                  {item.quantity && item.quantity > 1 ? `${item.quantity} × ` : ""}
                  {money(item.unit_price ?? 0)}
                </span>
              </div>
            ))}
          </div>
          {total !== null ? (
            <div className="flex justify-between pt-4 text-[15px]">
              <b>Total paid</b>
              <b>{money(total)} AUD</b>
            </div>
          ) : null}
        </div>
      ) : null}

      {shippingLine ? (
        <div className="card mb-7 flex items-start gap-3 p-5 text-[13.5px]">
          <Icon name="pin" size={17} className="mt-0.5 shrink-0" />
          <div>
            <b>Delivering to</b>
            <p className="mt-1 text-muted">{shippingLine}</p>
          </div>
        </div>
      ) : null}

      <div className="card mb-7 flex flex-col items-center gap-4 bg-lilac p-6 text-center sm:flex-row sm:text-left">
        <div className="flex-1">
          <b className="text-[15px]">Create an account in one click</b>
          <p className="mt-1 text-[13px] text-muted">
            Track this order, save your details and reorder favourites.
          </p>
        </div>
        <ButtonLink href="/signup" variant="dark" size="sm">
          Create account
        </ButtonLink>
      </div>

      <div className="flex flex-wrap justify-center gap-3.5">
        <ButtonLink href="/shop">Continue shopping</ButtonLink>
        <ButtonLink href="/track" variant="ghost">
          Track this order
        </ButtonLink>
      </div>

      <p className="mt-5 text-center text-[13px] text-muted">
        Questions?{" "}
        <Link href="/contact" className="text-accent underline underline-offset-2">
          Contact {SHOP.name}
        </Link>{" "}
        — we usually reply within a day.
      </p>

      {!sessionId ? (
        <p className="mt-6 text-center text-[13px] text-faint">
          <Pill tone="neutral">No checkout session found</Pill>
        </p>
      ) : null}
    </div>
  );
}
