import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import type {
  ArtKey,
  OrderStatus,
  PublicTrackedAddress,
  PublicTrackedItem,
  PublicTrackedOrder,
  Tint,
} from "@/lib/types";

export const runtime = "nodejs";

const BodySchema = z.object({
  orderNumber: z.string().trim().min(3).max(40),
  email: z.email().max(200),
});

/**
 * Never distinguishes "no such order" from "email does not match" — and now
 * also never distinguishes either from "this deployment has no service-role
 * key" or "the database errored". Every one of those is this exact body with
 * this exact header; only 400 (bad input) and 429 (throttled) differ, and both
 * are decided before any lookup happens.
 */
const NOT_FOUND = { found: false } as const;

/**
 * One constructor for every miss, so the bytes cannot drift apart. Named
 * `miss` rather than `notFound` so nobody reads it as next/navigation's
 * `notFound()`, which throws a 404 — this is a deliberate 200.
 */
function miss() {
  return NextResponse.json(NOT_FOUND, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * `isDatabaseConfigured()` (lib/queries.ts) checks the URL and the *anon* key
 * and knows nothing about the service-role key, so it is the wrong guard here:
 * this route no longer uses the anon key at all. `lookup_order` is revoked
 * from `anon` precisely so the throttle below cannot be skipped by calling
 * PostgREST directly with the public key, which means the legitimate path has
 * to hold the service-role key instead.
 *
 * Checking it here rather than letting `createAdminClient()` throw keeps the
 * missing-key case cheap and quiet, but the try/catch below is still the
 * backstop — either way the caller sees a miss and only the server log knows
 * why. The app is meant to run with no database at all (see CLAUDE.md), so
 * "not configured" must stay a normal answer, not an error.
 */
function isLookupConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Allow-list, not a deny-list: the row is rebuilt field by field, so a column
 * added to `lookup_order` later reaches nobody until someone adds it here.
 *
 * `shipping_address` is jsonb and carries `phone`. /track is a public page
 * reachable with an order number and an email, and app/track/TrackForm.tsx
 * renders the name, line1, optional line2 and "suburb state postcode" — it has
 * never rendered the phone number. Storing it stays correct (the studio may
 * need to ring about a delivery); sending it to the browser was gratuitous.
 */
function toPublicAddress(value: unknown): PublicTrackedAddress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const address = value as Record<string, unknown>;

  return {
    first_name: text(address.first_name),
    last_name: text(address.last_name),
    line1: text(address.line1),
    line2: nullableText(address.line2),
    suburb: text(address.suburb),
    state: text(address.state),
    postcode: text(address.postcode),
  };
}

function toPublicItems(value: unknown): PublicTrackedItem[] {
  if (!Array.isArray(value)) return [];

  return value.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    return {
      product_name: text(item.product_name),
      variant_label: nullableText(item.variant_label),
      // Art and tint come from our own catalogue, never from the request; an
      // unknown key falls back to the theme default in ProductArt.
      art: text(item.art) as ArtKey,
      tint: text(item.tint) as Tint,
      unit_price: number(item.unit_price),
      quantity: number(item.quantity),
    };
  });
}

function toPublicOrder(row: unknown): PublicTrackedOrder | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const order = row as Record<string, unknown>;
  if (!order.order_number) return null;

  return {
    order_number: text(order.order_number),
    status: text(order.status) as OrderStatus,
    total: number(order.total),
    shipping_method: text(order.shipping_method),
    tracking_number: nullableText(order.tracking_number),
    created_at: text(order.created_at),
    shipping_address: toPublicAddress(order.shipping_address),
    items: toPublicItems(order.items),
  };
}

export async function POST(request: Request) {
  // Order lookup returns a shipping address, so guessing must be expensive.
  // This throttle is now the *only* thing standing in front of the lookup, so
  // it is no longer decorative: `lookup_order` is revoked from `anon`, and the
  // route holds the service-role key, so PostgREST with the public key is no
  // longer a way around it.
  const limit = rateLimit(clientKey(request, "track"), 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { found: false, error: "Too many attempts. Please wait a minute." },
      {
        status: 429,
        headers: {
          "Retry-After": String(limit.retryAfter),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { found: false, error: "Enter both an order number and the email you ordered with." },
      { status: 400 },
    );
  }

  // A missing database — or a database we hold no key for — must look exactly
  // like a miss, so a probe cannot use the response to tell configured
  // deployments from unconfigured ones.
  if (!isLookupConfigured()) {
    // The reason is named in the log and nowhere else: the response below is
    // the same fifteen bytes a genuine miss returns.
    const missing = [
      process.env.NEXT_PUBLIC_SUPABASE_URL ? null : "NEXT_PUBLIC_SUPABASE_URL",
      process.env.SUPABASE_SERVICE_ROLE_KEY ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean);
    console.error(
      `track lookup unavailable: ${missing.join(" and ")} not set — see SETUP.md`,
    );
    return miss();
  }

  try {
    // Service-role client: it bypasses RLS entirely, which is only acceptable
    // because nothing in the request body can steer it. The body yields
    // exactly two validated strings and both are handed to `lookup_order` as
    // RPC arguments — never interpolated into SQL, never used to pick a table,
    // a column, a filter or a key. The function is SECURITY DEFINER, matches
    // on order number AND email, and excludes `pending`, so the service-role
    // key widens nothing: it only restores the one path that revoking the
    // `anon` grant closes. Do not add a body-controlled table, column, filter
    // or `.from()` to this client.
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("lookup_order", {
      p_order_number: body.orderNumber,
      p_email: body.email,
    });

    if (error) {
      console.error("lookup_order failed:", error.message);
      return miss();
    }

    const order = toPublicOrder(Array.isArray(data) ? data[0] : data);
    if (!order) {
      return miss();
    }

    return NextResponse.json(
      { found: true, order },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Includes `createAdminClient()` throwing on a missing key, which the
    // guard above should already have caught. The caller learns nothing.
    console.error("order tracking failed:", error);
    return miss();
  }
}
