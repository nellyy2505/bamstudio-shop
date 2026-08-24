import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient, createClient, getUser } from "@/lib/supabase/server";
import { getCollections, isDatabaseConfigured } from "@/lib/queries";
import { FALLBACK_PRODUCTS } from "@/lib/fallback-data";
import {
  BUILDER_MAX_LETTERS,
  BUILDER_NO_CHARM_DISCOUNT,
  BUILDER_PRICING,
  PERSONALISATION_TEXT_MAX,
  PERSONALISATION_TEXT_PATTERN,
  PRINT_LEAD_TIME,
  SHIPPING,
  shippingCost,
  transitDays,
} from "@/lib/config";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";

const LineSchema = z.object({
  product_id: z.string().min(1),
  slug: z.string().min(1),
  colour: z.string().nullable().optional(),
  attachment_id: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(20),
  /** "text" mode personalisation — one printed line, e.g. a pet's name. */
  personalisation_text: z.string().max(PERSONALISATION_TEXT_MAX).optional(),
  custom: z
    .object({
      collection_slug: z.string().min(1).max(60),
      // Kept only for older clients; the server uses the stored name.
      collection_name: z.string().min(1).max(60),
      letters: z
        .string()
        .min(1)
        .max(BUILDER_MAX_LETTERS)
        .regex(/^[A-Za-z]+$/, "Letters only."),
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
  slug: string;
  name: string;
  art: string;
  tint: string;
  variant: string;
  colour: string | null;
  attachment_id: string | null;
  unit_price: number;
  quantity: number;
  personalisation: unknown;
};

/**
 * Packs the basket into Stripe's 500-character metadata budget as
 * "slug:qty,slug:qty". Entries are dropped whole rather than the string being
 * sliced — a cut mid-entry would hand the webhook a truncated slug and
 * silently skip that product's stock movement.
 */
const STOCK_METADATA_LIMIT = 480;

function stockMap(items: SummaryLine[]): string {
  const parts: string[] = [];
  let length = 0;

  for (const item of items) {
    if (item.personalisation) continue;
    const entry = `${item.slug}:${item.quantity}`;
    const cost = entry.length + (parts.length > 0 ? 1 : 0);
    if (length + cost > STOCK_METADATA_LIMIT) {
      console.warn(
        `Stock metadata full — ${item.slug} omitted; its stock will not move ` +
          "if the webhook has to rebuild this order.",
      );
      continue;
    }
    parts.push(entry);
    length += cost;
  }

  return parts.join(",");
}

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
}): Promise<{ ok: boolean }> {
  // Nothing to stage when the shop is running on sample data.
  if (!isDatabaseConfigured()) return { ok: true };

  const supabase = createAdminClient();
  let orderId: string | null = null;

  try {
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
      return { ok: false };
    }
    orderId = order.id;

    const { error: itemsError } = await supabase.from("order_items").insert(
      input.items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.name,
        variant_label: item.variant,
        art: item.art,
        tint: item.tint,
        colour: item.colour,
        attachment_id: item.attachment_id,
        unit_price: item.unit_price,
        quantity: item.quantity,
        personalisation: item.personalisation,
      })),
    );

    if (itemsError) {
      // An order row with no items is worse than no row at all: the webhook
      // would confirm it and we would have taken money with no record of what
      // to print. Remove it so the checkout fails cleanly instead.
      console.error("Could not stage items:", itemsError.message);
      await supabase.from("orders").delete().eq("id", order.id);
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("Could not stage order:", error);
    if (orderId) {
      await supabase
        .from("orders")
        .delete()
        .eq("id", orderId)
        .then(undefined, () => {});
    }
    return { ok: false };
  }
}

/**
 * Creates a Stripe Checkout Session.
 *
 * Prices are recomputed here from the database — the client only says WHICH
 * product and how many. A tampered basket cannot change what is charged.
 */
export async function POST(request: Request) {
  // This route writes order rows with the service-role key, so an unthrottled
  // loop could fill the table. Real shoppers check out a handful of times.
  const limit = rateLimit(clientKey(request, "checkout"), 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

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

  // With a database configured but no service-role key, checkout would take
  // money and the webhook would 500 on every delivery, recording nothing.
  // Refuse up front rather than discovering it in the Stripe dashboard.
  if (isDatabaseConfigured() && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing — refusing checkout.");
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const products = await loadProducts(body.lines.map((l) => l.slug));

  // Personalised lines are priced against a real collection, never the
  // colourway name the client claims.
  const needsCollections = body.lines.some((l) => l.custom);
  const collections = new Map(
    needsCollections
      ? (await getCollections()).map((c) => [c.slug, c] as const)
      : [],
  );

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

    // A `custom` block carries builder bundle pricing, so it must only ever
    // reach a builder product — otherwise an $18 item could be bought for $3.
    if (line.custom && product.personalisation_mode !== "builder") {
      return NextResponse.json(
        { error: `“${product.short_name}” is not built in the designer.` },
        { status: 400 },
      );
    }
    if (line.personalisation_text && product.personalisation_mode !== "text") {
      return NextResponse.json(
        { error: `“${product.short_name}” cannot be personalised with text.` },
        { status: 400 },
      );
    }
    if (product.personalisation_mode === "builder" && !line.custom) {
      return NextResponse.json(
        { error: `“${product.short_name}” needs to be built in the designer.` },
        { status: 400 },
      );
    }
    if (product.personalisation_mode === "text" && !line.personalisation_text) {
      return NextResponse.json(
        { error: `“${product.short_name}” needs the text you want printed.` },
        { status: 400 },
      );
    }

    // Colour is resolved per branch below: a builder line's "colour" is its
    // colourway, which is validated against the collections table, not the
    // product's own colour list (builder products have none).
    let colour: string | null = null;

    if (line.custom) {
      // Builder item: flat bundle price by letter count, ignore client price.
      const collection = collections.get(line.custom.collection_slug);
      if (!collection) {
        return NextResponse.json(
          { error: "That colourway is no longer available." },
          { status: 409 },
        );
      }

      const letters = line.custom.letters.replace(/[^A-Za-z]/g, "").toUpperCase();
      const bundle = BUILDER_PRICING[letters.length];
      if (!bundle) {
        return NextResponse.json(
          { error: "Name charms take 1–5 letters." },
          { status: 400 },
        );
      }
      unitPrice = bundle - (line.custom.with_charm ? 0 : BUILDER_NO_CHARM_DISCOUNT);
      // Taken from the collection we just looked up, never the client's copy.
      colour = collection.name;

      // The cord/keyring/strap choice has to reach the Stripe line, the order
      // detail page and the packing list, or the wrong finding gets shipped.
      const builderAttachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );
      // Use the collection's stored name, not the client's copy of it.
      description = [
        collection.name,
        letters,
        line.custom.with_charm ? "with charm" : "letters only",
        builderAttachment?.label,
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      // Colour is free text on the wire; only a colour this product actually
      // comes in may reach the Stripe line description or the order record.
      const colours = product.colours ?? [];
      if (line.colour) {
        const match = colours.find((c) => c.name === line.colour);
        if (!match) {
          return NextResponse.json(
            { error: `“${product.short_name}” doesn't come in that colour.` },
            { status: 400 },
          );
        }
        colour = match.name;
      } else if (colours.length > 0) {
        colour = colours[0].name;
      }

      const attachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );
      unitPrice = product.price + (attachment?.price_delta ?? 0);

      let printed: string | null = null;
      if (line.personalisation_text) {
        printed = line.personalisation_text.trim();
        if (!printed || !PERSONALISATION_TEXT_PATTERN.test(printed)) {
          return NextResponse.json(
            {
              error:
                "Personalised text can use letters, numbers, spaces and - ' & . / only.",
            },
            { status: 400 },
          );
        }
      }

      description = [
        colour,
        attachment?.label,
        printed ? `“${printed}”` : null,
      ]
        .filter(Boolean)
        .join(" · ");
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
      slug: product.slug,
      name: product.short_name,
      art: product.art,
      tint: product.tint,
      variant: description,
      colour,
      attachment_id: line.attachment_id ?? null,
      unit_price: unitPrice,
      quantity: line.quantity,
      personalisation:
        line.custom ??
        (line.personalisation_text
          ? { text: line.personalisation_text.trim() }
          : null),
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
      // Deliberately off: orders store subtotal/shipping/total with no
      // discount column, so a promo code would leave those three inconsistent.
      // Add a `discount` column and reconcile in the webhook before enabling.
      allow_promotion_codes: false,
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
            // Printing happens before the carrier ever sees it, so the
            // estimate Stripe shows is print lead time + transit. Derived so
            // editing lib/config.ts can't silently desync this quote.
            delivery_estimate: {
              minimum: {
                unit: "business_day",
                value: PRINT_LEAD_TIME.minDays + transitDays(body.shipping_method)[0],
              },
              maximum: {
                unit: "business_day",
                value: PRINT_LEAD_TIME.maxDays + transitDays(body.shipping_method)[1],
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
        // Small enough for Stripe's 500-char cap, and the one piece of the
        // basket the webhook cannot rebuild from line items.
        gift_note: (body.gift_note ?? "").slice(0, 450),
        // "slug:qty,slug:qty" — the only way the webhook's rebuild path can
        // find products to decrement. Personalised lines are omitted: they
        // hold no ready-to-ship stock.
        stock: stockMap(summary),
      },
    });

    const staged = await savePendingOrder({
      sessionId: session.id,
      userId: user?.id ?? null,
      email: user?.email ?? body.email ?? "",
      subtotal,
      shipping,
      shippingMethod: body.shipping_method,
      giftNote: body.gift_note ?? null,
      items: summary,
    });

    if (!staged.ok) {
      // Better to lose a checkout than to take money for an order we have no
      // record of and cannot print. Expiring the session makes the URL dead.
      await stripe.checkout.sessions
        .expire(session.id)
        .catch((error) => console.error("Could not expire session:", error));

      return NextResponse.json(
        {
          error:
            "We couldn't start your order just now. Nothing has been charged — please try again in a moment.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ url: session.url, id: session.id });
  } catch (error) {
    console.error("Stripe checkout failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
