import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  name: z.string().trim().min(1, "Please tell us your name.").max(100),
  email: z.email("That email address does not look right."),
  topic: z.enum(["order", "returns", "custom", "wholesale", "other"]),
  // Sent as "" by the form when left blank, so empty is normalised away.
  orderNumber: z
    .string()
    .trim()
    .max(40, "Order numbers are shorter than that.")
    .optional()
    .transform((value) => (value ? value : undefined)),
  message: z
    .string()
    .trim()
    .min(10, "A few more words, so we know what you need.")
    .max(2000),
});

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "contact"), 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many messages. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Please check the form and try again.")
        : "Please check the form and try again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // TODO: wire this to an email provider (Resend) so the enquiry reaches the
  // studio inbox and the sender gets an acknowledgement. Until then it only
  // reaches the server log, which is not durable.
  console.log("[contact] enquiry", {
    name: body.name,
    email: body.email,
    topic: body.topic,
    orderNumber: body.orderNumber ?? null,
    message: body.message,
    received_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
