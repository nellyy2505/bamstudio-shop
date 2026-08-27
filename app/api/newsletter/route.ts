import { NextResponse } from "next/server";
import { SHOP } from "@/lib/config";
import { isEmailConfigured, maskEmail, sendEmail } from "@/lib/email";
import { clientKey, rateLimitDurable } from "@/lib/rate-limit";
import { captureMessage } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

const BodySchema = z.object({
  email: z
    .email("That email address does not look right.")
    .max(200)
    // Normalised to lower case here, once, because the table's primary key IS
    // the address: `Mia@example.com` and `mia@example.com` must be one row, or
    // the key deduplicates nothing and an address taken off the list comes
    // back under the other spelling. `newsletter_signups` has a CHECK that
    // refuses anything not already lower-cased, so this cannot be forgotten
    // silently — the insert fails loudly instead. The 200 matches its bound.
    .transform((value) => value.trim().toLowerCase()),
});

/**
 * There is a record that someone asked. There is still no newsletter.
 *
 * WHAT CHANGED, AND WHAT DID NOT. This route used to forward a notification to
 * the studio inbox and keep nothing at all, so an unconfigured provider or a
 * Resend 5xx discarded the request outright — the same defect `/api/contact`
 * had, on a smaller payload. The address is now written to
 * `public.newsletter_signups` before the notification is attempted, so the
 * request survives the mail failing.
 *
 * What has NOT changed is what may be promised. That table is a record of who
 * asked and when; it is not a list that anything sends to. There is no
 * newsletter, no welcome email, no unsubscribe link and no code anywhere in
 * this project that mails a subscriber — so the footer copy still must not
 * offer any of them, and `delivered` still says only whether the studio was
 * notified. See WORKLOG §0.9 and the table comment in 0006_enquiries.sql.
 *
 * WHY ITS OWN TABLE rather than a row in `contact_enquiries`. An address is a
 * membership and a message is a piece of work. The membership is unique (asking
 * twice is one fact stated twice, so the address is the primary key and a
 * repeat submission is idempotent) and ends in an unsubscribe; the message
 * repeats freely — a customer who follows up has said a second thing — and ends
 * in a reply. One table would leave half its columns null for half its rows,
 * could not express the uniqueness rule, and would make clearing out answered
 * enquiries delete the mailing list.
 */

/**
 * Records the request. Returns whether the address is now on record.
 *
 * `ignoreDuplicates` makes this `insert ... on conflict do nothing`: a second
 * sign-up from the same address is not an error and not a new row, and — this
 * is the part that matters — it does not overwrite `unsubscribed_at`. Somebody
 * who has been taken off the list stays off, whatever the footer box is told
 * afterwards. A duplicate still counts as stored, because the true statement
 * ("we have your address") holds either way.
 *
 * Never throws, for the reason `/api/contact` gives: a database that is
 * unreachable must not take the notification attempt down with it.
 */
async function storeSignup(email: string): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("newsletter_signups")
      .upsert({ email, source: "footer" }, {
        onConflict: "email",
        ignoreDuplicates: true,
      });

    if (error) {
      // PostgREST text about the statement, never the address — the log stream
      // is not a mailing list (§0.9).
      console.error("[newsletter] request NOT stored", {
        address: maskEmail(email),
        reason: error.message,
      });
      // NOTE the difference from the log line directly above: the log gets a
      // MASKED address because it is on infrastructure the studio controls and
      // it is what lets a "I signed up and heard nothing" complaint be matched
      // to a failure. The error report gets NO address at all, masked or
      // otherwise — it leaves the country and lands in a third party's system,
      // so the rule there is stricter, not the same.
      void captureMessage("Newsletter sign-up could not be stored", {
        scope: "newsletter",
        level: "error",
        route: "/api/newsletter",
        tags: { code: error.code ?? null, reason: error.message },
      }).catch(() => {});
      return false;
    }
    return true;
  } catch (error) {
    // `createAdminClient()` throws when SUPABASE_SERVICE_ROLE_KEY is unset.
    console.error("[newsletter] request NOT stored", {
      address: maskEmail(email),
      reason: error instanceof Error ? error.message : "unknown",
    });
    void captureMessage("Newsletter sign-up could not be stored", {
      scope: "newsletter",
      level: "error",
      route: "/api/newsletter",
      tags: { reason: error instanceof Error ? error.message : "unknown" },
    }).catch(() => {});
    return false;
  }
}

/**
 * Stamps the row as notified, only if it has not been already: a second
 * sign-up from an address the studio was told about a month ago should not
 * rewrite the date the studio first heard. Best-effort — the address is
 * already on record and a lost stamp costs one duplicate prompt.
 */
async function markNotified(email: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase
      .from("newsletter_signups")
      .update({ notified_at: new Date().toISOString() })
      .eq("email", email)
      .is("notified_at", null);
  } catch {
    // Nothing to do and nothing lost: the row is written either way.
  }
}

export async function POST(request: Request) {
  // Durable when a shared store is configured, identical to before when it
  // is not — see lib/rate-limit.ts.
  const limit = await rateLimitDurable(clientKey(request, "newsletter"), 5, 60_000);
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

  // Store first, then notify — same order and same reason as /api/contact.
  const stored = await storeSignup(body.email);

  let delivered = false;
  let failure: string | null = null;

  // The same condition the footer uses to decide whether to offer the box at
  // all — lib/contact.ts `formsReachStudio(isEmailConfigured())`. It now
  // decides only whether the owner is told, not whether the request survives.
  if (isEmailConfigured() && SHOP.hasSupportEmail) {
    const result = await sendEmail({
      to: SHOP.supportEmail,
      subject: `[${SHOP.name}] newsletter sign-up request`,
      text: [
        `${body.email} asked to hear about new drops.`,
        "",
        stored
          ? "It is recorded in the studio, so this mail can be deleted. There"
          : "THIS IS THE ONLY COPY — the studio could not record it. There",
        "is still no newsletter and nothing goes out to this address.",
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

  if (delivered && stored) await markNotified(body.email);

  // Masked, never the full address: the platform log stream is not a mailing
  // list. Enough to correlate a support complaint ("I signed up and heard
  // nothing") with a specific failure, and not enough to contact anyone.
  //
  // As in /api/contact, severity follows `stored`: only the case where neither
  // worked is the request actually lost, and only that one is an error.
  if (stored && delivered) {
    console.info("[newsletter] request recorded and forwarded", {
      address: maskEmail(body.email),
    });
  } else if (stored) {
    console.warn("[newsletter] request recorded, studio NOT notified", {
      address: maskEmail(body.email),
      reason: failure,
    });
  } else if (delivered) {
    console.warn("[newsletter] request NOT recorded, forwarded by email only", {
      address: maskEmail(body.email),
    });
  } else {
    console.error("[newsletter] request LOST — neither recorded nor forwarded", {
      address: maskEmail(body.email),
      reason: failure,
    });
    // Somebody asked to hear about new drops and there is no record of it
    // anywhere. No address in the payload — see the note in `storeSignup`.
    void captureMessage("Newsletter sign-up lost — neither recorded nor forwarded", {
      scope: "newsletter",
      level: "error",
      route: "/api/newsletter",
      tags: { sendFailure: failure },
    }).catch(() => {});
  }

  // 200 either way, for the same reason as /api/contact: the submission was
  // valid and nothing the customer can do would change the outcome.
  //
  // WHAT THE TWO FLAGS MAY BE USED TO CLAIM:
  //
  //   delivered — the studio was emailed that someone asked. Not that anyone
  //     read it, and never that a newsletter exists.
  //   stored — the address is on record and is still there tomorrow. **Not
  //     that it is subscribed to anything**, because nothing sends to it.
  //     "We have your address, and there is no newsletter yet" is the whole of
  //     what this permits; "you're on the list" is not.
  //
  // NewsletterForm.tsx branches on `delivered` alone today. One line of its
  // undelivered copy is now wrong and must change: "That did not reach the
  // studio and nothing was saved" is false when `stored` is true. The exact
  // replacement is in the handover notes with this change.
  return NextResponse.json({ ok: true, delivered, stored });
}
