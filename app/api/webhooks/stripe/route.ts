import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
/** The raw body must reach Stripe's signature check untouched. */
export const dynamic = "force-dynamic";

type SummaryItem = {
  product_id?: string;
  name?: string;
  art?: string;
  tint?: string;
  variant?: string;
  unit_price?: number;
  quantity?: number;
  personalisation?: unknown;
};

function parseItems(raw: string | undefined): SummaryItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SummaryItem[]) : [];
  } catch {
    return [];
  }
}

async function recordOrder(session: Stripe.Checkout.Session) {
  const supabase = createAdminClient();

  // Idempotency: Stripe retries, and we must not double-write an order.
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("stripe_session_id", session.id)
    .maybeSingle();
  if (existing) return;

  const metadata = session.metadata ?? {};
  const items = parseItems(metadata.items);
  const details = session.collected_information?.shipping_details ?? null;
  const address = details?.address;
  const fullName = details?.name ?? "";
  const [firstName, ...restName] = fullName.split(" ");

  const subtotal = Number(metadata.subtotal ?? 0);
  const shipping = Number(metadata.shipping ?? 0);

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: metadata.user_id || null,
      email:
        session.customer_details?.email ?? session.customer_email ?? "unknown",
      status: "confirmed",
      subtotal: subtotal || (session.amount_subtotal ?? 0),
      shipping,
      total: session.amount_total ?? subtotal + shipping,
      shipping_method: metadata.shipping_method || "standard",
      gift_note: metadata.gift_note || null,
      shipping_address: {
        first_name: firstName ?? "",
        last_name: restName.join(" "),
        line1: address?.line1 ?? "",
        line2: address?.line2 ?? null,
        suburb: address?.city ?? "",
        state: address?.state ?? "",
        postcode: address?.postal_code ?? "",
        phone: session.customer_details?.phone ?? null,
      },
      stripe_session_id: session.id,
      stripe_payment_intent:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null),
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("Failed to record order:", error?.message);
    throw new Error("order insert failed");
  }

  if (items.length > 0) {
    const { error: itemsError } = await supabase.from("order_items").insert(
      items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id ?? null,
        product_name: item.name ?? "Item",
        variant_label: item.variant ?? "",
        art: item.art ?? "macaron",
        tint: item.tint ?? "cream",
        unit_price: item.unit_price ?? 0,
        quantity: item.quantity ?? 1,
        personalisation: item.personalisation ?? null,
      })),
    );
    if (itemsError) console.error("Failed to record items:", itemsError.message);
  }

  // Stock only moves for ready-to-ship units; made-to-order sits at zero.
  for (const item of items) {
    if (!item.product_id || item.personalisation) continue;
    await supabase.rpc("decrement_stock", {
      p_product_id: item.product_id,
      p_quantity: item.quantity ?? 1,
    });
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    // Signature mismatch means this did not come from Stripe — reject it.
    console.error("Webhook signature verification failed:", error);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.payment_status === "paid") await recordOrder(session);
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        await recordOrder(event.data.object);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // Returning 500 asks Stripe to retry, which is what we want here.
    console.error(`Handling ${event.type} failed:`, error);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
