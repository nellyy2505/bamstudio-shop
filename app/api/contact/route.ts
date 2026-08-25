import { NextResponse } from "next/server";
import { SHOP } from "@/lib/config";
import { isEmailConfigured, sendEmail } from "@/lib/email";
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

/**
 * Escapes the enquiry before it goes into the HTML part. The studio inbox is
 * the only reader, but the text is attacker-controlled and mail clients render
 * HTML — no reason to hand one an injection point.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

  // Nothing is persisted — there is no enquiries table — so the email IS the
  // delivery. If it does not send, the enquiry is genuinely lost and the caller
  // must not be told otherwise: a faulty-goods claim silently swallowed is the
  // worst version of WORKLOG §0.1.
  let delivered = false;
  let failure: string | null = null;

  // `isEmailConfigured()` is the single source of truth for "the shop can send
  // email", and it is checked here per request rather than trusted from the UI.
  // The public `NEXT_PUBLIC_EMAIL_ENABLED` claim flag that used to shadow it is
  // gone: it could be true with the secrets absent, so the form was rendered
  // and the enquiry was lost. The pages now derive from this same predicate —
  // see lib/contact.ts `formsReachStudio`, which is this condition exactly.
  // Without a support address there is nowhere to send it either.
  if (isEmailConfigured() && SHOP.hasSupportEmail) {
    const lines = [
      `Topic: ${body.topic}`,
      `From: ${body.name} <${body.email}>`,
      body.orderNumber ? `Order number: ${body.orderNumber}` : null,
      "",
      body.message,
    ].filter((line): line is string => line !== null);

    const result = await sendEmail({
      to: SHOP.supportEmail,
      subject: `[${SHOP.name}] ${body.topic} enquiry`,
      text: lines.join("\n"),
      html: `<pre style="font:14px/1.5 ui-monospace,monospace;white-space:pre-wrap">${escapeHtml(
        lines.join("\n"),
      )}</pre>`,
      // So replying in the studio inbox answers the customer directly.
      replyTo: body.email,
    });

    delivered = result.ok;
    if (!result.ok) failure = result.reason;
  } else {
    failure = "not_configured";
  }

  // Deliberately no name, address, order number or message body — that was the
  // §0.9 PII-in-the-log-stream defect. `topic` is a fixed enum chosen from a
  // dropdown, not free text, and cannot identify anyone on its own.
  if (delivered) {
    console.info("[contact] enquiry delivered", { topic: body.topic });
  } else {
    console.error("[contact] enquiry NOT delivered", {
      topic: body.topic,
      reason: failure,
    });
  }

  // 200 with delivered:false rather than an error status. The customer did
  // nothing wrong and retrying cannot help — an unconfigured provider fails
  // identically every time — so an error status would only produce a "try
  // again" loop against a form that will never succeed. The truth rides in the
  // flag instead, and ContactForm renders different copy for it: undelivered
  // means "we could not send this — please email the studio directly".
  return NextResponse.json({ ok: true, delivered });
}
