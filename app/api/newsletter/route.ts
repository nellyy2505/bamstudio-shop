import { NextResponse } from "next/server";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.email("That email address does not look right.").max(200),
});

export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "newsletter"), 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many messages. Please wait a minute." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "That email address does not look right." },
      { status: 400 },
    );
  }

  // TODO: wire this to an email provider (Resend) — add the address to the
  // audience/contact list there instead of logging it. Nothing is persisted
  // until that exists.
  console.log("[newsletter] signup", {
    email: body.email,
    received_at: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
