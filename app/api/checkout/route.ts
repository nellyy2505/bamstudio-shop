import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { isDatabaseConfigured } from "@/lib/queries";
import { FALLBACK_PRODUCTS } from "@/lib/fallback-data";
import {
  BUILDER_NO_CHARM_DISCOUNT,
  BUILDER_PRICING,
  SHIPPING,
  shippingCost,
} from "@/lib/config";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";

const LineSchema = z.object({
  product_id: z.string().min(1),
  slug: z.string().min(1),
  colour: z.string().nullable().optional(),
  attachment_id: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(20),
  custom: z
    .object({
      collection_slug: z.string().min(1),
      collection_name: z.string().min(1),
      letters: z.string().min(1).max(5),
      with_charm: z.boolean(),
    })
    .optional(),
});

const BodySchema = z.object({
  lines: z.array(LineSchema).min(1).max(40),
  email: z.string().email().optional(),
  shipping_method: z.enum(["standard", "express"]).default("standard"),
  gift_note: z.string().max(500).optional(),
});

async function loadProducts(slugs: string[]): Promise<Map<string, Product>> {
  if (!isDatabaseConfigured()) {
    return new Map(
      FALLBACK_PRODUCTS.filter((p) => slugs.includes(p.slug)).map((p) => [
        p.slug,
        p,
      ]),
    );
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .in("slug", slugs)
    .eq("active", true);

  return new Map(((data ?? []) as Product[]).map((p) => [p.slug, p]));
}

type SummaryLine = {
  product_id: string;
  name: string;
  art: string;
  tint: string;
  variant: string;
  unit_price: number;
  quantity: number;
  personalisation: unknown;
};

/**
 * Records the basket as a `pending` order keyed by the Stripe session, so the
 * webhook only has to confirm it. Stripe's 500-character metadata limit makes
 * carrying the basket on the session itself unworkable.
 *
 * A failure here must not block checkout: the webhook can still rebuild an
 * order from the Stripe session, so we log and continue.
 */
async function savePendingOrder(input: {
  sessionId: string;
  userId: string | null;
  email: string;
  subtotal: number;
  shipping: number;
  shippingMethod: string;
  giftNote: string | null;
  items: SummaryLine[];
}) {
  if (!isDatabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const supabase = createAdminClient();
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        user_id: input.userId,
        email: input.email,
        status: "pending",
        subtotal: input.subtotal,
        shipping: input.shipping,
        total: input.subtotal + input.shipping,
        shipping_method: input.shippingMethod,
        gift_note: input.giftNote,
        shipping_address: {},
        stripe_session_id: input.sessionId,
      })
      .select("id")
      .single();

    if (error || !order) {
      console.error("Could not stage order:", error?.message);
      return;
    }

    const { error: itemsError } = await supabase.from("order_items").insert(
      input.items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.name,
        variant_label: item.variant,
        art: item.art,
        tint: item.tint,
        unit_price: item.unit_price,
        quantity: item.quantity,
        personalisation: item.personalisation,
      })),
    );
    if (itemsError) console.error("Could not stage items:", itemsError.message);
  } catch (error) {
    console.error("Could not stage order:", error);
  }
}

/**
 * Creates a Stripe Checkout Session.
 *
 * Prices are recomputed here from the database — the client only says WHICH
 * product and how many. A tampered basket cannot change what is charged.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid basket." }, { status: 400 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json(
      { error: "Payments are not configured yet." },
      { status: 503 },
    );
  }

  const products = await loadProducts(body.lines.map((l) => l.slug));

  const lineItems: {
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: { name: string; description?: string };
    };
    quantity: number;
  }[] = [];
  const summary: SummaryLine[] = [];
  let subtotal = 0;

  for (const line of body.lines) {
    const product = products.get(line.slug);
    if (!product) {
      return NextResponse.json(
        { error: `“${line.slug}” is no longer available.` },
        { status: 409 },
      );
    }

    let unitPrice: number;
    let description: string;

    if (line.custom) {
      // Builder item: flat bundle price by letter count, ignore client price.
      const letters = line.custom.letters.replace(/[^A-Za-z]/g, "").toUpperCase();
      const bundle = BUILDER_PRICING[letters.length];
      if (!bundle) {
        return NextResponse.json(
          { error: "Name charms take 1–5 letters." },
          { status: 400 },
        );
      }
      unitPrice = bundle - (line.custom.with_charm ? 0 : BUILDER_NO_CHARM_DISCOUNT);
      description = `${line.custom.collection_name} · ${letters}${
        line.custom.with_charm ? " · with charm" : " · letters only"
      }`;
    } else {
      const attachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );
      unitPrice = product.price + (attachment?.price_delta ?? 0);
      description = [line.colour, attachment?.label].filter(Boolean).join(" · ");
    }

    if (unitPrice < 0) {
      return NextResponse.json({ error: "Invalid price." }, { status: 400 });
    }

    subtotal += unitPrice * line.quantity;
    lineItems.push({
      price_data: {
        currency: "aud",
        unit_amount: unitPrice,
        product_data: {
          name: product.short_name,
          ...(description ? { description } : {}),
        },
      },
      quantity: line.quantity,
    });

    summary.push({
      product_id: product.id,
      name: product.short_name,
      art: product.art,
      tint: product.tint,
      variant: description,
      unit_price: unitPrice,
      quantity: line.quantity,
      personalisation: line.custom ?? null,
    });
  }

  const shipping = shippingCost(subtotal, body.shipping_method);
  const method = SHIPPING.methods.find((m) => m.id === body.shipping_method)!;

  const user = await getUser().catch(() => null);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: user?.email ?? body.email,
      success_url: `${siteUrl()}/order/confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/cart?cancelled=1`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["AU"] },
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping, currency: "aud" },
            display_name:
              shipping === 0 ? `${method.label} (free)` : method.label,
            delivery_estimate: {
              minimum: {
                unit: "business_day",
                value: body.shipping_method === "express" ? 3 : 5,
              },
              maximum: {
                unit: "business_day",
                value: body.shipping_method === "express" ? 7 : 11,
              },
            },
          },
        },
      ],
      // Stripe caps each metadata value at 500 characters, so the basket is
      // persisted to our own database below rather than carried here.
      metadata: {
        user_id: user?.id ?? "",
        shipping_method: body.shipping_method,
        subtotal: String(subtotal),
        shipping: String(shipping),
      },
    });

    await savePendingOrder({
      sessionId: session.id,
      userId: user?.id ?? null,
      email: user?.email ?? body.email ?? "",
      subtotal,
      shipping,
      shippingMethod: body.shipping_method,
      giftNote: body.gift_note ?? null,
      items: summary,
    });

    return NextResponse.json({ url: session.url, id: session.id });
  } catch (error) {
    console.error("Stripe checkout failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
