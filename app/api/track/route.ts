import { NextResponse } from "next/server";
import { z } from "zod";
import { isDatabaseConfigured } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BodySchema = z.object({
  orderNumber: z.string().trim().min(3).max(40),
  email: z.email().max(200),
});

/** Never distinguishes "no such order" from "email does not match". */
const NOT_FOUND = { found: false } as const;

export async function POST(request: Request) {
  // Order lookup returns a shipping address, so guessing must be expensive.
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

  // A missing database must look exactly like a miss, so a probe cannot use
  // the response to tell configured deployments from unconfigured ones.
  if (!isDatabaseConfigured()) {
    return NextResponse.json(NOT_FOUND, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("lookup_order", {
      p_order_number: body.orderNumber,
      p_email: body.email,
    });

    if (error) {
      console.error("lookup_order failed:", error.message);
      return NextResponse.json(NOT_FOUND, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const order = Array.isArray(data) ? data[0] : data;
    if (!order) {
      return NextResponse.json(NOT_FOUND, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    return NextResponse.json(
      { found: true, order },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("order tracking failed:", error);
    return NextResponse.json(NOT_FOUND, {
      headers: { "Cache-Control": "no-store" },
    });
  }
}
