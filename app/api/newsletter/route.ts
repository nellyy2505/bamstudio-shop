import { NextResponse } from "next/server";
import { SHOP } from "@/lib/config";
import { isEmailConfigured, maskEmail, sendEmail } from "@/lib/email";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z.email("That email address does not look right.").max(200),
});

/**
 * There is no subscriber list.
 *
 * No table, no audience, no unsubscribe mechanism — and this route does not
 * own the schema, so it cannot create one. What it can do is make sure the
 * request is not silently discarded: when email is configured it notifies the
 * studio inbox that someone asked to be added, and the owner adds them by hand
 * wherever the list eventually lives.
 *
 * That is a *notification*, not a subscription. `delivered` says only that the
 * notification reached the studio. The footer copy must not promise a
 * newsletter, a welcome email or an unsubscribe link, because none of those
 * exist yet — see WORKLOG §0.1. The order-confirmation email the Stripe webhook
 * now sends changes nothing here: there is still no subscriber list.
 *
 * The condition below is the same one the footer uses to decide whether to
 * offer the box at all — lib/contact.ts `formsReachStudio(isEmailConfigured())`.
 */
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

  let delivered = false;
  let failure: string | null = null;

  if (isEmailConfigured() && SHOP.hasSupportEmail) {
    const result = await sendEmail({
      to: SHOP.supportEmail,
      subject: `[${SHOP.name}] newsletter sign-up request`,
      text: [
        `${body.email} asked to hear about new drops.`,
        "",
        "There is no subscriber list yet — add this address by hand, and",
        "delete this mail once you have. Nothing else recorded it.",
      ].join("\n"),
      // Lets the owner reply to confirm, and keeps the address out of the
      // reply-to guessing game if they forward it.
      replyTo: body.email,
    });
    delivered = result.ok;
    if (!result.ok) failure = result.reason;
  } else {
    failure = "not_configured";
  }

  // Masked, never the full address: the platform log stream is not a mailing
  // list. Enough to correlate a support complaint ("I signed up and heard
  // nothing") with a specific failure, and not enough to contact anyone.
  if (delivered) {
    console.info("[newsletter] request forwarded", {
      address: maskEmail(body.email),
    });
  } else {
    console.error("[newsletter] request NOT forwarded", {
      address: maskEmail(body.email),
      reason: failure,
    });
  }

  // 200 either way, for the same reason as /api/contact: the submission was
  // valid and nothing the customer can do would change the outcome. `delivered`
  // is what the footer must branch on — false means the request reached nobody
  // and the copy has to say so rather than "you're on the list".
  return NextResponse.json({ ok: true, delivered });
}
