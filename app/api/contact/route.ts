import { NextResponse } from "next/server";
import { SHOP } from "@/lib/config";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { clientKey, rateLimitDurable } from "@/lib/rate-limit";
import { captureMessage } from "@/lib/observability";
import { createAdminClient } from "@/lib/supabase/server";
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

// Every bound above is mirrored by a CHECK constraint on
// public.contact_enquiries (0006_enquiries.sql), and the two must move
// together. The table is the backstop — it is what makes an unbounded message
// impossible whichever code path writes it — so raising a limit here without
// raising it there turns a long message into a failed insert rather than a
// stored row. The topic enum is mirrored the same way.

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

/**
 * Writes the enquiry down. Returns the new row's id, or null if it could not
 * be stored.
 *
 * THE DEFECT THIS CLOSES. This route used to hand the message to Resend and
 * keep nothing, so the email WAS the delivery — its own comment said as much.
 * An unset `RESEND_API_KEY` or `EMAIL_FROM`, an unset
 * `NEXT_PUBLIC_SUPPORT_EMAIL`, a provider 4xx/5xx or an 8-second timeout each
 * destroyed the only copy of what the customer typed, and the route answered
 * `{ ok: true, delivered: false }` over the wreckage. On a shop that tells
 * customers in its own legal pages that it sends no order emails, this form is
 * one of very few channels they have, and a message reporting faulty goods is
 * the one that must survive a bad afternoon at a mail provider. (That is a
 * pointer to why it matters, not legal advice.) The row is now written first
 * and the email is a notification about a row that already exists.
 *
 * **Written with the service-role client, and the table grants no INSERT to
 * `anon`.** The alternative — an insert-only RLS policy so the browser writes
 * its own row — makes a public PostgREST endpoint out of this table, walking
 * straight past the validation and the rate limiting above. This route already
 * runs server-side, so the row is written by the same code that validated it
 * and the key in the browser bundle gets nothing at all. The reasoning is
 * written out in full in the grants block of 0006_enquiries.sql.
 *
 * Never throws: a database that is unreachable must not take the send attempt
 * down with it. The caller falls back to email-only and reports what happened.
 */
async function storeEnquiry(
  body: z.infer<typeof BodySchema>,
): Promise<string | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("contact_enquiries")
      .insert({
        name: body.name,
        email: body.email,
        topic: body.topic,
        order_number: body.orderNumber ?? null,
        message: body.message,
      })
      .select("id")
      .single();

    if (error) {
      // PostgREST's message is text about the statement — a constraint name, a
      // missing relation — not the customer's words. The row values are
      // deliberately not logged: that was the §0.9 PII-in-the-log-stream
      // defect, and this path handles nothing but PII.
      console.error("[contact] enquiry NOT stored", { reason: error.message });
      // A failed write on the one channel a customer has for "my order is
      // wrong". Nothing throws here on purpose, so nothing else would ever
      // report it. The row values are NOT attached — this function handles
      // nothing but PII — only PostgREST's text about the statement, which
      // `scrub()` cleans on the way out because it quotes rejected values.
      void captureMessage("Contact enquiry could not be stored", {
        scope: "contact",
        level: "error",
        route: "/api/contact",
        tags: { code: error.code ?? null, reason: error.message },
      }).catch(() => {});
      return null;
    }
    return data?.id ?? null;
  } catch (error) {
    // `createAdminClient()` throws when SUPABASE_SERVICE_ROLE_KEY is unset, and
    // fetch throws when Supabase is unreachable. Neither may 500 the form.
    console.error("[contact] enquiry NOT stored", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    void captureMessage("Contact enquiry could not be stored", {
      scope: "contact",
      level: "error",
      route: "/api/contact",
      tags: {
        reason: error instanceof Error ? error.message : "unknown",
      },
    }).catch(() => {});
    return null;
  }
}

/**
 * Stamps the enquiry as notified — the same shape and the same reasoning as
 * `orders.confirmation_email_sent_at` in 0005. Null means no notification has
 * gone out for this one, which is what separates "she was emailed about this"
 * from "this exists only in the table".
 *
 * Best-effort: the enquiry is already safe, and a failed stamp is not worth
 * failing a response a customer is waiting on. The cost of losing it is one
 * duplicate prompt, never a lost message.
 */
async function markNotified(id: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("contact_enquiries")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.warn("[contact] notify stamp failed", { reason: error.message });
  } catch {
    // Nothing to do and nothing lost: the row is written either way.
  }
}

export async function POST(request: Request) {
  // Durable when a shared store is configured, identical to before when it
  // is not — see lib/rate-limit.ts. One `await`, same arguments, same result.
  const limit = await rateLimitDurable(clientKey(request, "contact"), 5, 60_000);
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

  // STORE FIRST, THEN SEND. The order is the whole fix. An enquiry that is on
  // disk before Resend is called survives Resend failing, and the send stops
  // being the delivery and becomes a notification.
  const enquiryId = await storeEnquiry(body);
  const stored = enquiryId !== null;

  let delivered = false;
  let failure: string | null = null;

  // `isEmailConfigured()` is the single source of truth for "the shop can send
  // email", and it is checked here per request rather than trusted from the UI.
  // The public `NEXT_PUBLIC_EMAIL_ENABLED` claim flag that used to shadow it is
  // gone: it could be true with the secrets absent, so the form was rendered
  // and the enquiry was lost. The pages now derive from this same predicate —
  // see lib/contact.ts `formsReachStudio`, which is this condition exactly.
  // Without a support address there is nowhere to send it either.
  //
  // Note what this no longer decides: whether the enquiry survives. It decides
  // only whether the owner hears about it without opening the studio.
  if (isEmailConfigured() && SHOP.hasSupportEmail) {
    const lines = [
      `Topic: ${body.topic}`,
      `From: ${body.name} <${body.email}>`,
      body.orderNumber ? `Order number: ${body.orderNumber}` : null,
      "",
      body.message,
      "",
      // Which copy this is. Deleting the mail is safe in the first case and
      // throws the enquiry away in the second, and the owner cannot tell the
      // two apart by looking at it.
      stored
        ? "A copy is stored in the studio, so this mail can be deleted."
        : "THIS IS THE ONLY COPY — the studio could not store this enquiry.",
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

  if (delivered && enquiryId) await markNotified(enquiryId);

  // Deliberately no name, address, order number or message body — that was the
  // §0.9 PII-in-the-log-stream defect. `topic` is a fixed enum chosen from a
  // dropdown, not free text, and cannot identify anyone on its own.
  //
  // Severity now follows `stored`, not `delivered`. An enquiry on disk that was
  // not emailed is a prompt the owner has not received — a warning. An enquiry
  // that is neither is the original defect reproducing itself, and it is the
  // only one of the four that is an error.
  if (stored && delivered) {
    console.info("[contact] enquiry stored and notified", { topic: body.topic });
  } else if (stored) {
    console.warn("[contact] enquiry stored, studio NOT notified", {
      topic: body.topic,
      reason: failure,
    });
    // The message survives and IS readable: /admin/enquiries now lists these
    // rows for owner and studio (the `reports` capability), and an unnotified
    // one is on the "still to deal with" filter waiting to be found. So this is
    // no longer the lost enquiry the comment here used to call it — that
    // sentence was written while the screen was still owed in HANDOFF.md, and a
    // reader who believed it would over-rate the severity below.
    //
    // It stays a REPORT rather than a warning anyway, for the reason that
    // survived the screen: nothing pushes. Being findable by somebody who
    // thinks to open a studio page is not the same as being told, and the topic
    // enum here covers faulty goods and missing parcels — things a customer is
    // waiting on. The report is the push the email failed to be.
    //
    // "not_configured" is excluded: on a deploy with no mail provider every
    // page already tells the customer so, and reporting a state the owner chose
    // is noise.
    if (failure !== "not_configured") {
      void captureMessage("Contact enquiry stored but the studio was not notified", {
        scope: "contact",
        level: "warning",
        route: "/api/contact",
        tags: { topic: body.topic, sendFailure: failure },
      }).catch(() => {});
    }
  } else if (delivered) {
    console.warn("[contact] enquiry NOT stored, emailed only", {
      topic: body.topic,
    });
  } else {
    console.error("[contact] enquiry LOST — neither stored nor delivered", {
      topic: body.topic,
      reason: failure,
    });
    // The original §0.9 defect reproducing itself: a customer typed a message
    // and there is now no copy of it anywhere. `topic` is a fixed dropdown
    // enum and identifies nobody; the name, the address and the message body
    // are deliberately absent, here as in the log line above.
    void captureMessage("Contact enquiry lost — neither stored nor delivered", {
      scope: "contact",
      level: "fatal",
      route: "/api/contact",
      tags: { topic: body.topic, sendFailure: failure },
    }).catch(() => {});
  }

  // 200 in all four cases, for the reason it always was: the customer did
  // nothing wrong, and where the failure is an unconfigured provider, retrying
  // fails identically every time — an error status would only produce a "try
  // again" loop against a form that cannot succeed. The truth rides in the
  // flags instead.
  //
  // WHAT EACH FLAG MAY BE USED TO CLAIM, spelled out because overclaiming here
  // is the failure mode this route keeps producing:
  //
  //   delivered — a mail provider accepted a notification addressed to the
  //     studio inbox. That, and nothing past it. Not that it was read.
  //   stored — the message is a row in public.contact_enquiries and will still
  //     be there tomorrow. **It does not mean anybody has seen it**, and until
  //     the studio has a screen listing those rows, nobody can. Copy for
  //     `stored && !delivered` may say the message is safe and that no one has
  //     read it yet; it may not promise a reply.
  //
  // ContactForm.tsx branches on `delivered` alone today, and its undelivered
  // copy — "we could not get that to the studio, so nobody has read it" —
  // remains true when `stored` is true. That is deliberate: this flag is safe
  // to ship ahead of the copy that will use it, because the copy it ships
  // beside does not become false.
  return NextResponse.json({ ok: true, delivered, stored });
}
