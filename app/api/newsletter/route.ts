import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.email("That email address does not look right.").max(200),
});

export async function POST(request: Request) {
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
