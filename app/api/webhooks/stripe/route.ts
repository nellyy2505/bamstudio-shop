import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
/** The raw body must reach Stripe's signature check untouched. */
export const dynamic = "force-dynamic";

function addressFrom(session: Stripe.Checkout.Session) {
  const details = session.collected_information?.shipping_details ?? null;
  const address = details?.address;
  const fullName = details?.name ?? session.customer_details?.name ?? "";
  const [firstName, ...restName] = fullName.split(" ");

  return {
    first_name: firstName ?? "",
    last_name: restName.join(" "),
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? null,
    suburb: address?.city ?? "",
    state: address?.state ?? "",
    postcode: address?.postal_code ?? "",
    phone: session.customer_details?.phone ?? null,
  };
}

/**
 * Promotes the `pending` order staged at checkout to `confirmed`, filling in
 * the address and totals Stripe collected.
 *
 * Idempotent by construction: the update is scoped to rows still `pending`,
 * so Stripe's retries (and the duplicate `async_payment_succeeded` event)
 * change nothing the second time around.
 */
async function confirmOrder(session: Stripe.Checkout.Session) {
  const supabase = createAdminClient();

  const { data: staged } = await supabase
    .from("orders")
    .select("id, status")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  if (staged) {
    if (staged.status !== "pending") return; // already handled

    const { error } = await supabase
      .from("orders")
      .update({
        status: "confirmed",
        email:
          session.customer_details?.email ??
          session.customer_email ??
          undefined,
        total: session.amount_total ?? undefined,
        shipping_address: addressFrom(session),
        stripe_payment_intent: paymentIntent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", staged.id)
      .eq("status", "pending");

    if (error) {
      console.error("Could not confirm order:", error.message);
      throw new Error("order confirm failed");
    }

    await decrementStock(supabase, staged.id);
    return;
  }

  // No staged row — the database was unreachable at checkout. Rebuild what we
  // can from Stripe so the sale is never lost.
  const lineItems = await getStripe().checkout.sessions.listLineItems(
    session.id,
    { limit: 100 },
  );

  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: session.metadata?.user_id || null,
      email:
        session.customer_details?.email ?? session.customer_email ?? "unknown",
      status: "confirmed",
      subtotal: Number(session.metadata?.subtotal ?? session.amount_subtotal ?? 0),
      shipping: Number(session.metadata?.shipping ?? 0),
      total: session.amount_total ?? 0,
      shipping_method: session.metadata?.shipping_method || "standard",
      shipping_address: addressFrom(session),
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
    })
    .select("id")
    .single();

  if (error || !order) {
    // A unique violation means a concurrent retry won the race — that's fine.
    if (error?.code === "23505") return;
    console.error("Could not record order:", error?.message);
    throw new Error("order insert failed");
  }

  const { error: itemsError } = await supabase.from("order_items").insert(
    lineItems.data.map((item) => ({
      order_id: order.id,
      product_name: item.description ?? "Item",
      variant_label: "",
      art: "macaron",
      tint: "cream",
      unit_price: item.price?.unit_amount ?? 0,
      quantity: item.quantity ?? 1,
    })),
  );
  if (itemsError) console.error("Could not record items:", itemsError.message);
}

/** Ready-to-ship stock only; made-to-order lines sit at zero already. */
async function decrementStock(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  const { data: items } = await supabase
    .from("order_items")
    .select("product_id, quantity, personalisation")
    .eq("order_id", orderId);

  for (const item of items ?? []) {
    if (!item.product_id || item.personalisation) continue;
    const { error } = await supabase.rpc("decrement_stock", {
      p_product_id: item.product_id,
      p_quantity: item.quantity ?? 1,
    });
    if (error) console.error("Stock decrement failed:", error.message);
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
    // A signature mismatch means this did not come from Stripe — reject it.
    console.error("Webhook signature verification failed:", error);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Delayed methods stay unpaid here and arrive later as
        // async_payment_succeeded, so only confirm what is actually paid.
        if (session.payment_status === "paid") await confirmOrder(session);
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await confirmOrder(event.data.object);
        break;
      case "checkout.session.expired": {
        // Tidy up the staged row so abandoned baskets don't accumulate.
        const supabase = createAdminClient();
        await supabase
          .from("orders")
          .delete()
          .eq("stripe_session_id", event.data.object.id)
          .eq("status", "pending");
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // A 500 asks Stripe to retry, which is what we want here.
    console.error(`Handling ${event.type} failed:`, error);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
