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
  // Neutral on purpose: this page also renders the processing and never-paid
  // states, and the browser tab should not announce a confirmation for those.
  title: "Your order",
  robots: { index: false },
  // The URL carries a Stripe session id that reads back the customer's
  // address, so it must not leak to any third party in a Referer header.
  referrer: "no-referrer",
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

  /**
   * Stripe hands the browser this session id BEFORE payment, and redirects
   * here for delayed payment methods while the money is still in flight. So
   * the page must never take reaching it as proof of payment — it reads the
   * session's real state and says only what is true.
   *
   *  paid       — money taken, order confirmed.
   *  processing — checkout completed on a delayed method; not yet paid.
   *  unpaid     — never completed. Their basket must survive.
   */
  let paymentState: "paid" | "processing" | "unpaid" | "unknown" = "unknown";

  // Read the session straight from Stripe so the page is correct even if the
  // webhook has not landed yet.
  if (sessionId) {
    try {
      const session = await getStripe().checkout.sessions.retrieve(sessionId);

      paymentState =
        session.payment_status === "paid"
          ? "paid"
          : session.status === "complete"
            ? "processing"
            : "unpaid";

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

  // Nothing was paid: keep the basket intact and send them back to it.
  if (paymentState === "unpaid" || paymentState === "unknown") {
    return <NotPaid hasSession={Boolean(sessionId)} />;
  }

  const paid = paymentState === "paid";

  return (
    <div className="wrap max-w-3xl pt-12">
      {/* Clearing is safe here: checkout completed, so the basket is spent. */}
      <ClearCartOnMount />

      <div className="mb-8 flex flex-col items-center text-center">
        <span
          className={`flex h-20 w-20 items-center justify-center rounded-full ${
            paid ? "bg-good-soft text-good" : "bg-cream text-muted"
          }`}
        >
          <Icon name={paid ? "check" : "clock"} size={36} strokeWidth={2.4} />
        </span>
        <h1 className="mt-5 mb-2 text-3xl md:text-[34px]">
          {paid
            ? `${firstName ? `Thanks ${firstName} — ` : "Thanks — "}order confirmed!`
            : `${firstName ? `Thanks ${firstName} — ` : "Thanks — "}payment is processing`}
        </h1>
        <p className="text-muted">
          {paid ? (
            email ? (
              <>
                A receipt is on its way to <b className="text-ink">{email}</b>
              </>
            ) : (
              "A receipt is on its way to your inbox."
            )
          ) : (
            <>
              Your payment method settles over a day or two. We&apos;ll email
              {email ? <b className="text-ink"> {email}</b> : " you"} the moment
              it clears, and printing starts then.
            </>
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
                  i === 0 && paid
                    ? "bg-good text-white"
                    : "border border-line2 bg-surface text-faint"
                }`}
              >
                {i === 0 && paid ? (
                  <Icon name="check" size={15} strokeWidth={2.6} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-[12.5px] font-extrabold ${i === 0 && paid ? "text-ink" : "text-faint"}`}
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
            {paid ? " printing" : " once payment clears, printing"} takes{" "}
            {PRINT_LEAD_TIME.label}, then tracking lands in your inbox the
            moment it ships.
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
              <b>{paid ? "Total paid" : "Total due"}</b>
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

/**
 * Reached by opening the success URL without completing payment — the session
 * id is handed to the browser before Stripe collects any money. Nothing is
 * claimed, and crucially <ClearCartOnMount /> is NOT rendered, so the basket
 * is still there when they go back.
 */
function NotPaid({ hasSession }: { hasSession: boolean }) {
  return (
    <div className="wrap max-w-2xl pt-14 pb-8">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-cream text-muted">
          <Icon name="bag" size={36} strokeWidth={1.8} />
        </span>
        <h1 className="mt-5 mb-2 text-3xl">
          {hasSession ? "This order wasn't completed" : "No order to show"}
        </h1>
        <p className="max-w-md text-muted">
          {hasSession
            ? "No payment was taken, so there's nothing to confirm yet. Your basket is exactly as you left it."
            : "We couldn't find a checkout to confirm. If you've just paid, check your email for the receipt."}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3.5">
          <ButtonLink href="/cart">Back to your basket</ButtonLink>
          <ButtonLink href="/shop" variant="ghost">
            Keep shopping
          </ButtonLink>
        </div>
        <p className="mt-6 text-[13px] text-muted">
          Charged but seeing this?{" "}
          <Link
            href="/contact"
            className="text-accent underline underline-offset-2"
          >
            Tell us
          </Link>{" "}
          and we&apos;ll sort it out.
        </p>
      </div>
    </div>
  );
}
