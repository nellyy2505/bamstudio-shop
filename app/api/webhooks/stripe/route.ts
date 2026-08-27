import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { isEmailConfigured, maskEmail, sendEmail } from "@/lib/email";
import { captureException, captureMessage } from "@/lib/observability";
import { PRINT_LEAD_TIME, SHIPPING, SHOP } from "@/lib/config";
// The studio's own costing, reused rather than re-implemented: one definition
// of what a piece costs, whether the sale came from the website or from a
// market stall. It lives in lib/ and not in app/admin/data.ts, which is where
// this route used to import it from: a customer-facing endpoint should not put
// the staff area on its import graph to find out what a piece cost. Nor can it
// live in app/admin/actions.ts — every export from a "use server" file becomes
// a callable HTTP endpoint.
import { unitCostsAtSale } from "@/lib/cost-basis";
// A Lucky Scoop is sold before its contents are decided, so it is the one line
// on an order with no product row behind it. These three are what let this file
// write such a line back exactly as checkout would have: which Stripe metadata
// keys carry the tier, what the promise reads as, and which illustration goes
// in the two NOT NULL columns a scoop has no product to fill.
import { SCOOP_METADATA, scoopArt, scoopVariantLabel } from "@/lib/scoop-line";
import { money } from "@/lib/format";

export const runtime = "nodejs";
/** The raw body must reach Stripe's signature check untouched. */
export const dynamic = "force-dynamic";

/**
 * `orders.email` is NOT NULL (supabase/migrations/0001_init.sql), so the
 * Stripe-rebuild insert cannot record "Stripe gave us no address" as a null —
 * it has to write something. This is that something, produced in exactly one
 * place, and it is a truthy string: a plain `if (!order.email)` accepts it as
 * a real mailbox. Every reader must go through `hasCustomerEmail` instead.
 */
const NO_CUSTOMER_EMAIL = "unknown";

/**
 * Reports a failure without letting the report delay Stripe.
 *
 * `after()` for the same reason `queueOrderConfirmation` uses it: this route's
 * response is the signal that tells Stripe whether to retry, and it must not
 * wait on a third party. The fallback is a detached promise — weaker only in
 * that the platform may not wait for it before freezing the instance, which on
 * a Fly machine with `auto_stop_machines = "off"` and a 30s `kill_timeout` it
 * will. `after()` throws outside a request scope, which is exactly the case
 * when this is called from inside another `after()` task.
 *
 * WHAT NEVER GOES IN A REPORT FROM THIS FILE, and it is not the obvious list:
 *
 *   * `session.id`. It looks like an opaque Stripe identifier and it is in
 *     fact a credential — `/order/confirmed?session_id=...` reads a
 *     customer's name, address and basket back out of Stripe with nothing
 *     else, which is why that page sets `referrer: "no-referrer"`. It stays in
 *     the log, on infrastructure the studio controls, and goes no further.
 *   * the shipping address, the phone, the email, the customer's name.
 *
 * What DOES go: the internal order UUID and the customer-facing order number
 * (neither opens anything on its own — /track needs the number AND the
 * matching email), amounts in cents, order status, and provider failure
 * reasons. Enough to find the order in the studio and know what it cost.
 */
function report(task: () => Promise<unknown>) {
  const guarded = async () => {
    try {
      await task();
    } catch {
      // The reporter is contracted never to throw. If it ever does, it must
      // not be the thing that turns a confirmed order into a Stripe retry.
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

/** True only for an address we could actually deliver to. */
function hasCustomerEmail(email: string | null | undefined): email is string {
  return Boolean(email) && email !== NO_CUSTOMER_EMAIL;
}

/**
 * Statuses an order never comes back from. `cancelled` is set by a person —
 * refunded, or the customer asked — and a late delivery must not undo that.
 */
const TERMINAL_STATUSES = new Set(["cancelled"]);

/**
 * Asked by both `!== "pending"` repair branches in `confirmOrder`. Those
 * branches exist for an order that was confirmed and then abandoned mid-flight,
 * and they fall through to `finishConfirmation` — which would number a
 * cancelled order, spend its stock and email its customer a confirmation for an
 * order the shop has already pulled. Every other guard in this file is scoped
 * to `pending` to avoid exactly that; these two are scoped by this.
 */
function isTerminal(status: string | null | undefined): boolean {
  return TERMINAL_STATUSES.has(status ?? "");
}

function addressFrom(session: Stripe.Checkout.Session) {
  const details = session.collected_information?.shipping_details ?? null;
  const address = details?.address;
  const fullName = details?.name ?? session.customer_details?.name ?? "";
  const [firstName, ...restName] = fullName.split(" ");

  return {
    first_name: firstName ?? "",
    last_name: restName.join(" "),
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? null,
    suburb: address?.city ?? "",
    state: address?.state ?? "",
    postcode: address?.postal_code ?? "",
    phone: session.customer_details?.phone ?? null,
  };
}

/**
 * Order numbers are only issued on payment, so abandoned checkouts don't burn
 * them and customers don't see gaps of hundreds between consecutive orders.
 * The random suffix stops anyone enumerating other people's orders on /track.
 */
async function nextOrderNumber(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<string> {
  const { data, error } = await supabase.rpc("next_order_number");
  if (error || !data) {
    console.error("Could not allocate order number:", error?.message);
    throw new Error("order number allocation failed");
  }
  return data as string;
}

/**
 * Promotes the `pending` order staged at checkout to `confirmed`, filling in
 * the address and totals Stripe collected.
 *
 * Idempotent by construction: the update is scoped to rows still `pending`,
 * so Stripe's retries (and the duplicate `async_payment_succeeded` event)
 * change nothing the second time around.
 */
async function confirmOrder(session: Stripe.Checkout.Session) {
  const supabase = createAdminClient();

  const { data: staged, error: stagedError } = await supabase
    .from("orders")
    .select("id, status, order_items(id)")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  // This error used to be discarded, which made a transient read failure
  // indistinguishable from "nothing was staged": `staged` came back null, the
  // repair branch and the staged branch were both skipped, and control fell
  // through to the fresh insert — which tripped `stripe_session_id unique` and
  // was swallowed as a 200. Stripe stopped retrying and the real row stayed
  // `pending` forever, invisible to the customer and to the shop.
  //
  // `maybeSingle()` reports zero rows as `data: null, error: null`, so an
  // error here is a genuine read failure and never an empty result. We cannot
  // tell "already done" from "I failed to find out", so we must not return
  // 200: throw, let the handler answer 500, and let Stripe deliver again.
  if (stagedError) {
    console.error("Could not read staged order:", stagedError.message);
    throw new Error("staged order read failed");
  }

  // A staged row with no line items is unusable — confirming it would leave a
  // paid order with no record of what to print. Treat it exactly like a
  // missing row so the Stripe rebuild below fills it in instead.
  const stagedItems = (staged as { order_items?: unknown[] } | null)?.order_items;
  const stagedIsUsable = Boolean(staged) && (stagedItems?.length ?? 0) > 0;

  // Scoped to `pending`: a confirmed order that somehow has no items has
  // already taken money and moved stock, so deleting and rebuilding it would
  // double-decrement and renumber a sale the customer has been emailed about.
  // Only an unconfirmed staging row is safe to discard.
  const rebuildFromStripe = Boolean(staged) && !stagedIsUsable;
  if (staged && rebuildFromStripe) {
    if (staged.status !== "pending") {
      if (isTerminal(staged.status)) {
        // Cancelled by hand between checkout and this (late) delivery.
        // Repairing it would number it, move stock and confirm to a customer
        // whose order the shop has already pulled. None of that may happen —
        // but the money did arrive, so the refund it owes is written down
        // where a person will see it before we return.
        await recordPaidWhileCancelled(supabase, session, staged.id, staged.status);
        return;
      }
      // Already confirmed but carrying no items: a previous delivery inserted
      // the order and then died before its items landed. Deleting it would
      // renumber a sale the customer has been emailed about, and returning
      // would strand it forever — no order number, nothing to print, and
      // every later retry taking this same branch. Repair it in place; both
      // the item fill and finishConfirmation are safe to re-run.
      console.error(
        `Order ${staged.id} is ${staged.status} with no items — repairing.`,
      );
      await fillItemsFromStripe(supabase, staged.id, session);
      await finishConfirmation(supabase, staged.id);
      return;
    }
    console.error(
      `Staged order ${staged.id} has no items — rebuilding from Stripe.`,
    );
    const { error: deleteError } = await supabase
      .from("orders")
      .delete()
      .eq("id", staged.id)
      .eq("status", "pending");

    // Discarding this error let a failed delete fall straight into the insert
    // below, where the row we meant to remove is still holding the unique
    // `stripe_session_id` — turning a clean rebuild into a 23505 that has to
    // be untangled after the fact. Nothing has been written yet, so throwing
    // here costs only a retry and keeps the two paths from fighting.
    if (deleteError) {
      console.error("Could not clear staged order:", deleteError.message);
      throw new Error("staged order rebuild failed");
    }
  }

  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  if (staged && stagedIsUsable) {
    if (staged.status !== "pending") {
      if (isTerminal(staged.status)) {
        // Same as the repair branch above: a cancelled order is not an
        // unfinished one, and finishing it would contradict a decision a
        // person already made. See `isTerminal`.
        await recordPaidWhileCancelled(supabase, session, staged.id, staged.status);
        return;
      }
      // Already confirmed — but a previous delivery may have died between the
      // confirming update and the follow-up work. Both steps compare-and-set
      // (a null order number, an unclaimed stock_applied), so running them
      // again is safe and is what makes the retry worth anything.
      await finishConfirmation(supabase, staged.id);
      return;
    }

    // The order number is allocated AFTER we know this update won the race.
    // Allocating it inline would burn a sequence value on every duplicate
    // delivery, defeating the point of gap-free numbers.
    const { data: updated, error } = await supabase
      .from("orders")
      .update({
        status: "confirmed",
        email:
          session.customer_details?.email ??
          session.customer_email ??
          undefined,
        total: session.amount_total ?? undefined,
        shipping_address: addressFrom(session),
        stripe_payment_intent: paymentIntent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", staged.id)
      .eq("status", "pending")
      .select("id");

    if (error) {
      console.error("Could not confirm order:", error.message);
      throw new Error("order confirm failed");
    }

    // Zero rows means a concurrent delivery already confirmed this order.
    // PostgREST reports no error for that, so the count is the only signal —
    // without it, retries would decrement stock a second time.
    if (!updated || updated.length === 0) return;

    await finishConfirmation(supabase, staged.id);
    return;
  }

  // No staged row — the database was unreachable at checkout. Rebuild what we
  // can from Stripe so the sale is never lost.
  const { data: order, error } = await supabase
    .from("orders")
    .insert({
      user_id: session.metadata?.user_id || null,
      // NOT NULL, and Stripe does not always give us an address. The sentinel
      // is read back through `hasCustomerEmail`, which is what keeps it from
      // being handed to a mail provider as a recipient.
      email:
        session.customer_details?.email ??
        session.customer_email ??
        NO_CUSTOMER_EMAIL,
      status: "confirmed",
      subtotal: Number(session.metadata?.subtotal ?? session.amount_subtotal ?? 0),
      shipping: Number(session.metadata?.shipping ?? 0),
      total: session.amount_total ?? 0,
      shipping_method: session.metadata?.shipping_method || "standard",
      // The one basket detail Stripe's line items cannot carry back.
      gift_note: session.metadata?.gift_note || null,
      shipping_address: addressFrom(session),
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
    })
    .select("id")
    .single();

  if (error || !order) {
    if (error?.code === "23505") {
      // A unique violation on `stripe_session_id` CAN mean a concurrent retry
      // inserted this order first — genuinely already done by someone else, so
      // 200 is right. But it fires just as readily when we only reached this
      // insert because the staged-row read failed, and a blanket 200 there is
      // what stranded paid orders: Stripe stops retrying and the row that
      // actually exists is still `pending`. Prove it is finished first.
      if (await orderIsFinished(supabase, session.id)) return;
      console.error(
        `Duplicate stripe_session_id ${session.id}, but that order is not ` +
          "finished — asking Stripe to retry rather than closing the event.",
      );
      throw new Error("order insert conflicted with an unfinished order");
    }
    console.error("Could not record order:", error?.message);
    throw new Error("order insert failed");
  }

  await fillItemsFromStripe(supabase, order.id, session);
  await finishConfirmation(supabase, order.id);
}

/**
 * Writes down a payment that took money the shop cannot honour.
 *
 * THE DEFECT THIS CLOSES (supabase/migrations/0005_sale_integrity.sql §3).
 *
 * A cancelled order that is paid anyway is a silent charge. The two branches
 * above are right to refuse to number it, move its stock or email its customer
 * — a person pulled that order — but the entire response used to be a
 * `console.error` saying "refund this one by hand" followed by a 200 to Stripe.
 * The customer is charged, receives nothing, and the only record is a log line
 * on a platform nobody reads. The refund stays manual, because refunding is a
 * decision with a customer at the other end of it; what changes is that it
 * becomes a row on the studio overview instead of a line in a log.
 *
 * `stripe_session_id` is unique on the table and the insert ignores duplicates,
 * so Stripe's redeliveries record one incident rather than one per delivery.
 *
 * A failure to record DOES throw, and that is a deliberate reversal of the old
 * comment here ("return rather than throw: no retry can ever make a cancelled
 * order eligible"). That was true while there was nothing a retry could
 * accomplish. There is now: recording the debt. Once the row exists every
 * later delivery inserts nothing and returns 200, so the retry loop is bounded
 * by success rather than by Stripe giving up.
 */
async function recordPaidWhileCancelled(
  supabase: ReturnType<typeof createAdminClient>,
  session: Stripe.Checkout.Session,
  orderId: string,
  status: string | null,
) {
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  const { error } = await supabase.from("payment_incidents").upsert(
    {
      order_id: orderId,
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
      // What the customer was actually charged — the sum that has to go back.
      amount_cents: session.amount_total ?? 0,
      kind: "paid_while_cancelled",
      order_status: status,
      detail:
        `Payment for session ${session.id} arrived after the order was ` +
        `${status}. Not numbered, no stock moved, no confirmation sent. ` +
        "Refund this one by hand in Stripe.",
    },
    { onConflict: "stripe_session_id", ignoreDuplicates: true },
  );

  if (error) {
    console.error(
      `Could not record the refund owed on order ${orderId}:`,
      error.message,
    );
    throw new Error("payment incident record failed");
  }

  // Still logged, because a log line is free and the studio overview is not
  // somewhere anyone is looking at 3am.
  console.error(
    `Order ${orderId} is ${status}; payment for session ${session.id} arrived ` +
      "anyway. Recorded as a refund owed — issue it by hand in Stripe.",
  );

  // ...and neither is the studio overview somewhere anyone is looking at 3am,
  // which is the whole argument for this line. Money has been taken for goods
  // that will not ship, and every existing signal — a log line, a row on a
  // screen — requires somebody to go and look. `fatal` because the customer is
  // out of pocket until a person acts. No session id: see `report` above.
  report(() =>
    captureMessage("Payment taken for a cancelled order — refund owed", {
      scope: "stripe-webhook",
      level: "fatal",
      route: "/api/webhooks/stripe",
      tags: {
        orderId,
        orderStatus: status,
        amountCents: session.amount_total ?? null,
        currency: session.currency ?? null,
      },
    }),
  );
}

/**
 * Answers the one question the 23505 path needs: did somebody else genuinely
 * finish this order, or did we merely fail to find out?
 *
 * Finished means every step of confirmOrder + finishConfirmation has run —
 * the row exists, it is past `pending`, it carries a customer-facing number,
 * its stock claim is taken, and it has line items to print. Anything short of
 * that returns false and the caller throws, because 200 is Stripe's cue to
 * stop retrying and we will not spend that on a guess. A read failure here
 * throws for the same reason: an unreadable row is not a confirmed one.
 *
 * The cost of being strict is at worst one extra Stripe retry when a genuine
 * concurrent winner is still mid-flight; that retry then sees it finished.
 */
async function orderIsFinished(
  supabase: ReturnType<typeof createAdminClient>,
  sessionId: string,
): Promise<boolean> {
  const { data: existing, error } = await supabase
    .from("orders")
    .select("id, status, order_number, stock_applied, order_items(id)")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (error) {
    console.error("Could not re-read order after conflict:", error.message);
    throw new Error("order conflict re-read failed");
  }

  // The unique constraint just fired, so a row with this session id exists. If
  // we cannot see it, our view of the table is not the truth — never 200.
  if (!existing) return false;

  const items = (existing as { order_items?: unknown[] }).order_items;
  return (
    existing.status !== "pending" &&
    Boolean(existing.order_number) &&
    existing.stock_applied === true &&
    (items?.length ?? 0) > 0
  );
}

type ProductRow = {
  id: string;
  slug: string;
  short_name: string;
  art: string;
  tint: string;
  colours: { name?: string }[] | null;
  attachments: { id?: string; label?: string }[] | null;
  personalisation_mode: string | null;
};

/** The separator checkout joins a line's variant parts with. */
const VARIANT_SEPARATOR = " · ";

/** The inline Stripe product for a line, when it was expanded and still exists. */
function expandedProduct(item: Stripe.LineItem): Stripe.Product | null {
  const product = item.price?.product;
  if (!product || typeof product === "string") return null;
  if ("deleted" in product && product.deleted) return null;
  return product;
}

/**
 * The product name for a line. `line_item.description` is documented as
 * defaulting to the product name, and that is all it ever is here — the
 * variant lives on the product's own description, which is why the listing is
 * expanded.
 */
function productNameOf(item: Stripe.LineItem): string | null {
  return expandedProduct(item)?.name ?? item.description ?? null;
}

/** The variant string checkout put in `price_data.product_data.description`. */
function variantDescriptionOf(item: Stripe.LineItem): string | null {
  return expandedProduct(item)?.description ?? null;
}

/**
 * The product slug checkout stamps on the line's inline product metadata.
 *
 * This is the only key on a Stripe line that identifies a product row
 * unambiguously: `short_name` is NOT unique in the schema — only `slug` and
 * `sku` are (supabase/migrations/0001_init.sql) — so two products sharing a
 * short name used to be indistinguishable here and the rebuild could link the
 * wrong row, printing and posting the wrong thing.
 *
 * Null for a line whose metadata does not carry it, which is what the name
 * fallback below exists for.
 */
function productSlugOf(item: Stripe.LineItem): string | null {
  const slug = expandedProduct(item)?.metadata?.slug;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

/**
 * What checkout stamped on a Lucky Scoop line, or null for every other line.
 *
 * THE DEFECT THIS CLOSES, before it existed. `fillItemsFromStripe` resolves
 * each Stripe line to a product row **by slug**, and `scoop_tiers.slug` and
 * `products.slug` are separate unique indexes on separate tables — nothing
 * prevents a tier called `mixed-scoop` and a charm called `mixed-scoop` from
 * both existing. Without a marker, a rebuilt scoop line would look its tier's
 * slug up in `products`, find that charm, write the charm's `product_id` onto
 * the line, cost it from the charm's recipe, and then hand it to
 * `decrementStock` — which would take a charm off the shelf for a scoop nobody
 * has drawn. The mutual-exclusion CHECK would not catch it, because the line
 * would carry a product id and no tier id: a scoop silently rebuilt as a
 * charm, on an order the customer has already paid for.
 *
 * So the tier's **id** rides on the line's own product metadata, which survives
 * the `expand: ['data.price.product']` this file already does, and this is the
 * first question asked about every line — before any lookup.
 *
 * The id rather than the slug on purpose: the id is what
 * `order_items.scoop_tier_id` needs, and a slug can be renamed between the
 * session being created and a delayed payment clearing days later.
 *
 * `pieces` is parsed defensively and falls back to the tier's own promise being
 * unstated rather than to a made-up number — see `fillItemsFromStripe`.
 */
function scoopOf(item: Stripe.LineItem): {
  tierId: string;
  pieces: number | null;
  theme: string | null;
} | null {
  const metadata = expandedProduct(item)?.metadata;
  const tierId = metadata?.[SCOOP_METADATA.tier];
  if (typeof tierId !== "string" || tierId.length === 0) return null;

  const rawPieces = Number(metadata?.[SCOOP_METADATA.pieces]);
  const theme = metadata?.[SCOOP_METADATA.theme];

  return {
    tierId,
    // Null, not 1 and not 5. A piece count we cannot read is a promise we
    // cannot restate, and the label is left off rather than invented — see
    // where it is used.
    pieces:
      Number.isInteger(rawPieces) && rawPieces > 0 ? rawPieces : null,
    theme: typeof theme === "string" && theme.length > 0 ? theme : null,
  };
}

/**
 * Recovers the printable detail of a line from the variant description
 * checkout composed, which is the only place Stripe carries it:
 *
 *   text / plain lines : colour · attachment label · “printed text”
 *   builder charms     : colourway · LETTERS · with charm|letters only · finding
 *
 * Segments are matched against the product's own colour and attachment lists
 * rather than trusted, so a segment we cannot place stays null. A wrong
 * printed charm costs a reprint and a customer, so nothing here is guessed.
 *
 * What Stripe genuinely does NOT carry, and is therefore left null on purpose:
 *
 *  - the builder colourway's `collection_slug` — only the collection's display
 *    name reaches the Stripe line, so builder personalisation is written with
 *    `collection_name` (which is what the order detail page prints) and
 *    without the slug. Looking the slug up by name would be a second guess on
 *    top of a display string;
 *  - `colour` and `attachment_id` for any line whose product row we could not
 *    find — with no colour or attachment list there is nothing to validate a
 *    segment against;
 *  - `colour` for a builder line where more than one segment is unaccounted
 *    for: the colourway is only taken when it is the single leftover;
 *  - the free-text `personalisation` of a line whose product is not in `text`
 *    mode, and letters for one not in `builder` mode — mislabelling a line as
 *    personalised also silently suppresses its stock movement.
 */
function recoverVariant(
  variant: string | null,
  product: ProductRow | undefined,
): {
  colour: string | null;
  attachment_id: string | null;
  personalisation: Record<string, unknown> | null;
} {
  const nothing = { colour: null, attachment_id: null, personalisation: null };
  if (!variant || !product) return nothing;

  const segments = variant
    .split(VARIANT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const colours = (product.colours ?? [])
    .map((colour) => colour?.name)
    .filter((name): name is string => Boolean(name));
  const attachments = (product.attachments ?? []).filter(
    (attachment): attachment is { id: string; label: string } =>
      Boolean(attachment?.id) && Boolean(attachment?.label),
  );

  let colour: string | null = null;
  let attachmentId: string | null = null;
  let letters: string | null = null;
  let withCharm: boolean | null = null;
  let printed: string | null = null;
  const unplaced: string[] = [];

  for (const segment of segments) {
    const attachment = attachments.find((a) => a.label === segment);
    const isColour = colours.includes(segment);

    // A segment that matches BOTH a colour name and a finding's label names
    // two different things, and the string carries no clue which the customer
    // chose. Trying the attachment list first — which is what this loop did —
    // invented a cord or strap nobody ordered AND dropped the colour, so the
    // wrong thing would be picked and posted. Place it as neither:
    // `variant_label` still holds the raw string, so the packing list shows
    // what was actually bought. Skipped before `unplaced` as well, so a
    // builder line cannot promote an ambiguous segment to its colourway.
    if (attachment && isColour) continue;

    if (attachment && !attachmentId) {
      attachmentId = attachment.id;
      continue;
    }
    if (!colour && isColour) {
      colour = segment;
      continue;
    }
    if (
      product.personalisation_mode === "text" &&
      segment.length > 1 &&
      segment.startsWith("“") &&
      segment.endsWith("”")
    ) {
      // Personalised text can only contain letters, numbers, spaces and
      // - ' & . / (PERSONALISATION_TEXT_PATTERN), so it can never contain the
      // separator and is always one whole segment.
      printed = segment.slice(1, -1);
      continue;
    }
    if (product.personalisation_mode === "builder") {
      if (segment === "with charm" || segment === "letters only") {
        withCharm = segment === "with charm";
        continue;
      }
      if (/^[A-Z]+$/.test(segment)) {
        // Last match wins on purpose: checkout writes the colourway before
        // the letters, so an all-caps colourway name is overwritten by the
        // real letters rather than mistaken for them. It then simply stays
        // out of `colour` instead of being guessed at.
        letters = segment;
        continue;
      }
    }
    unplaced.push(segment);
  }

  // A builder product has no colour list of its own — its "colour" is a
  // colourway from the collections table, and checkout stores that name in
  // `colour`. It is the one segment nothing else claims, so accept it only
  // when exactly one is left over; two would be a guess.
  if (
    product.personalisation_mode === "builder" &&
    !colour &&
    unplaced.length === 1
  ) {
    colour = unplaced[0];
  }

  let personalisation: Record<string, unknown> | null = null;
  if (product.personalisation_mode === "builder" && letters) {
    personalisation = {
      letters,
      ...(withCharm === null ? {} : { with_charm: withCharm }),
      ...(colour ? { collection_name: colour } : {}),
    };
  } else if (product.personalisation_mode === "text" && printed) {
    personalisation = { text: printed };
  }

  return { colour, attachment_id: attachmentId, personalisation };
}

/**
 * Rebuilds an order's line items from the Stripe session, for the paths where
 * the basket we staged is gone. Stripe knows the names, variants and amounts;
 * the slug:qty map checkout left in metadata and the line's own product name
 * restore the product link and artwork.
 *
 * Safe to re-run: it no-ops when the order already has items, so a retry
 * cannot duplicate them.
 */
async function fillItemsFromStripe(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  session: Stripe.Checkout.Session,
) {
  const { data: existing, error: existingError } = await supabase
    .from("order_items")
    .select("id")
    .eq("order_id", orderId)
    .limit(1);

  // This probe destructured only `data`, so a failed read looked exactly like
  // "no items yet" and the insert below ran a second time on the retry —
  // duplicating every line. That is not merely cosmetic: decrementStock
  // re-reads order_items, so duplicated lines double-count stock too.
  if (existingError) {
    console.error("Could not check existing items:", existingError.message);
    throw new Error("order items probe failed");
  }
  if (existing && existing.length > 0) return;

  // `expand` is what makes a repaired order printable. Without it the only
  // string available is `line_item.description`, which is the product NAME —
  // so the variant (colour or colourway, finding, letters, printed text) was
  // lost and `variant_label` was written as "". The inline product's own
  // description is the exact string checkout composed for that line.
  const lineItems = await getStripe().checkout.sessions.listLineItems(
    session.id,
    { limit: 100, expand: ["data.price.product"] },
  );

  // An empty list used to insert nothing, report success and let the caller
  // number the order and spend its stock claim — leaving a paid, confirmed,
  // numbered order with no record of what to print, and a 200 that told
  // Stripe to stop retrying. A paid Checkout Session always has line items,
  // so an empty list is a failed read of Stripe, not an empty basket: ask for
  // the delivery again rather than closing the event on nothing.
  if (lineItems.data.length === 0) {
    console.error(
      `Stripe returned no line items for ${session.id} — refusing to finish ` +
        "an order with nothing to print.",
    );
    throw new Error("order items rebuild found no line items");
  }

  // Two lookups, merged. Slugs are unique in the schema, so they are the only
  // trustworthy key: the ones checkout stamped on each line's product metadata
  // plus the ones in the stock map. The stock map alone is not enough — it
  // omits personalised lines by design, and those are exactly the ones that
  // most need a product row (without it there is no attachment list to turn a
  // finding's label back into its id, and no artwork). The line's product name
  // is looked up too, but only as the fallback for orders placed before
  // checkout started stamping the slug.
  //
  // SCOOP LINES ARE EXCLUDED FROM BOTH LOOKUPS. A scoop has no product row to
  // find, and its tier's slug and name can each collide with a real product's
  // — `scoop_tiers` and `products` have their own unique indexes, and
  // `short_name` is not unique even within `products`. Letting a tier's strings
  // into these lists would not merely waste a lookup: `byName` is first-writer-
  // wins, so a tier called "Pet scoop" could claim that key and hand its row to
  // an actual product line of the same name further down the basket.
  const productLines = lineItems.data.filter((item) => scoopOf(item) === null);

  const slugs = [
    ...new Set([
      ...parseStockMap(session.metadata?.stock).keys(),
      ...productLines
        .map((item) => productSlugOf(item))
        .filter((slug): slug is string => Boolean(slug)),
    ]),
  ];
  const names = [
    ...new Set(
      productLines
        .map((item) => productNameOf(item))
        .filter((name): name is string => Boolean(name)),
    ),
  ];

  const productRows: ProductRow[] = [];
  for (const lookup of [
    { column: "slug", values: slugs },
    { column: "short_name", values: names },
  ]) {
    if (lookup.values.length === 0) continue;
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, slug, short_name, art, tint, colours, attachments, personalisation_mode",
      )
      .in(lookup.column, lookup.values);

    // Discarding this error defaulted every line on the order to
    // art:"macaron", tint:"cream" and product_id null — a repaired order that
    // looks complete, links to nothing and prints the wrong artwork. There is
    // nothing to fall back to, so make Stripe retry instead.
    if (error) {
      console.error("Could not load products for rebuild:", error.message);
      throw new Error("order items product lookup failed");
    }
    productRows.push(...((data ?? []) as ProductRow[]));
  }

  // The slug index is exact: `slug` is unique, so one slug is one product row.
  const bySlug = new Map<string, ProductRow>();
  for (const row of productRows) {
    if (!bySlug.has(row.slug)) bySlug.set(row.slug, row);
  }

  // The name index is the fallback, and it is inherently ambiguous:
  // `short_name` is not unique, so first writer wins and the slug pass — the
  // products checkout actually charged — is the one that gets to be first.
  const byName = new Map<string, ProductRow>();
  for (const row of productRows) {
    if (!byName.has(row.short_name)) byName.set(row.short_name, row);
  }

  // THE DEFECT THIS CLOSES (defect 2): `unit_cost_cents` was written in
  // exactly one place — the market-stall form in app/admin/actions.ts — so
  // every website sale landed with a null making cost and /admin/reports had
  // nothing to subtract for the online channel. The cost is stamped here, at
  // the moment the sale is recorded, and never derived at read time: the
  // column exists to say what the piece cost WHEN IT SOLD, and re-deriving it
  // later would silently rewrite every historical margin the next time
  // filament or electricity changed price (0003_admin.sql says exactly that
  // above the column).
  //
  // Null for a product nobody has measured, and null for a line whose product
  // row could not be found. Nulls stay null: reports already count the lines
  // carrying no cost and say the profit understates what was spent, which is
  // true, where a zero would be a 100% margin that is not.
  const costs = await unitCostsAtSale(
    [...new Set(productRows.map((row) => row.id))],
  );

  const { error } = await supabase.from("order_items").insert(
    lineItems.data.map((item) => {
      const name = productNameOf(item) ?? "Item";

      /*
       * A LUCKY SCOOP. Asked first, before any product lookup, because a scoop
       * must never be resolved against `products` at all — see `scoopOf`.
       *
       * Everything written here matches what checkout stages on the ordinary
       * path, and for the same reasons:
       *
       *  - `scoop_tier_id` set, `product_id` NULL. Mutually exclusive in the
       *    schema, and the null product id is also what keeps this line out of
       *    `decrementStock`'s loop. A scoop's stock moves in the studio when
       *    the pack is recorded, not here — at this moment nobody knows which
       *    products would even be decremented.
       *  - `product_name` is the tier's name as it was at the sale, read off
       *    the Stripe line rather than re-read from `scoop_tiers`. The name is
       *    editable in the studio, and what this customer bought is a fact
       *    about this order — the same argument `unit_price` is copied under.
       *  - `unit_cost_cents` NULL. There is no recipe to cost a scoop from and
       *    the pack has not happened; a zero would read as 100% margin on
       *    something that has not been made yet.
       *  - `art`/`tint` come from the theme, through the one map checkout also
       *    uses, so a rebuilt scoop renders identically to a staged one. Both
       *    columns are NOT NULL and a scoop has no product row to fill them.
       *  - `variant_label` restates the promise, and is left EMPTY rather than
       *    guessed when the piece count did not survive the round trip. "5
       *    pieces" on an order that promised three is a worse answer than
       *    saying nothing; the tier id is on the line either way, so the studio
       *    can still see what was owed.
       */
      const scoop = scoopOf(item);
      if (scoop) {
        const { art, tint } = scoopArt(scoop.theme);
        return {
          order_id: orderId,
          product_id: null,
          scoop_tier_id: scoop.tierId,
          product_name: name,
          variant_label:
            scoop.pieces === null ? "" : scoopVariantLabel(scoop.pieces),
          art,
          tint,
          unit_price: item.price?.unit_amount ?? 0,
          quantity: item.quantity ?? 1,
          colour: null,
          attachment_id: null,
          personalisation: null,
          unit_cost_cents: null,
        };
      }

      // Slug first: it is the unique key and cannot pick the wrong row. The
      // name fallback stays because Stripe replays history — a session created
      // before checkout began stamping the slug can still reach this webhook
      // afterwards (a delayed payment method clearing days later, or a retry of
      // an old delivery), and its lines carry no metadata.slug. Dropping the
      // fallback would leave those lines with no product row at all: null
      // product_id, default artwork, no attachment list.
      const slug = productSlugOf(item);
      const product = (slug ? bySlug.get(slug) : undefined) ?? byName.get(name);
      const variant = variantDescriptionOf(item);
      const recovered = recoverVariant(variant, product);

      return {
        order_id: orderId,
        product_id: product?.id ?? null,
        // Explicitly null, and not merely omitted. PostgREST requires every
        // object in a bulk insert to carry the SAME key set — a scoop line in
        // the same basket contributes `scoop_tier_id`, so leaving it off here
        // would fail the whole insert with "All object keys must match" and
        // strand a paid, mixed order with nothing to print. It is also the
        // truthful value: this line is a product, not a scoop.
        scoop_tier_id: null,
        product_name: name,
        // The same string checkout writes to variant_label on the staged
        // path: it is read straight back off the line's own product.
        variant_label: variant ?? "",
        // NOT NULL columns with no honest source when the product is unknown.
        art: product?.art ?? "macaron",
        tint: product?.tint ?? "cream",
        unit_price: item.price?.unit_amount ?? 0,
        quantity: item.quantity ?? 1,
        // Null wherever Stripe does not carry it — see recoverVariant.
        colour: recovered.colour,
        attachment_id: recovered.attachment_id,
        personalisation: recovered.personalisation,
        unit_cost_cents: product ? (costs.get(product.id) ?? null) : null,
      };
    }),
  );

  if (error) {
    // Without items there is nothing to print, so make Stripe retry rather
    // than leaving a paid order that looks complete and isn't.
    console.error("Could not record items:", error.message);
    throw new Error("order items rebuild failed");
  }
}

/**
 * The steps that follow a successful confirm. Split out so a retry can pick
 * up an order that was confirmed but never got its number or its stock
 * movement — the window where the previous delivery crashed or timed out.
 */
async function finishConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  const orderNumber = await assignOrderNumber(supabase, orderId);

  // THE DEFECT THIS CLOSES (supabase/migrations/0005_sale_integrity.sql §1).
  //
  // The confirmation used to be queued from inside `assignOrderNumber`, in the
  // branch only the delivery that *allocated* the number can reach. That made
  // it a one-shot: the order has a number ever after, so every later delivery
  // returned early and the mail was never re-queued. A machine restart, a
  // Resend 429 or `after()` being cut short therefore left a charged customer
  // with a confirmed order and no email — and /track needs the order number
  // that email carries.
  //
  // Now the retry is driven by a fact in the database rather than by who won a
  // race: `assignOrderNumber` hands back the order number whenever the order
  // has one and `confirmation_email_sent_at` is still null, so any Stripe
  // delivery can pick up a send that was lost. `sendOrderConfirmation` stamps
  // the column only once the provider has accepted the message.
  //
  // The trade is deliberate and this way round: two deliveries racing here can
  // both send, so the worst case is a duplicate confirmation. A duplicate is a
  // mild annoyance; a missing one is a customer who cannot look up what they
  // paid for.
  if (orderNumber) queueOrderConfirmation(supabase, orderId, orderNumber);

  await decrementStock(supabase, orderId);
}

/**
 * Gives a confirmed order its customer-facing number, once and only once.
 * Scoped to rows that don't have one yet, so a retry cannot renumber an order
 * the customer has already been emailed about.
 *
 * Returns the order number when this order still needs its confirmation email,
 * and null when it does not — because one has already been recorded as sent, or
 * because a concurrent delivery is the one that will send it. The caller does
 * the queueing; see `finishConfirmation`.
 */
async function assignOrderNumber(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<string | null> {
  // Read before allocating. `nextOrderNumber` used to be awaited inside the
  // update payload, so the sequence was consumed on EVERY call — including the
  // duplicate deliveries whose `is null` compare-and-set matches no rows. That
  // burned an order number per duplicate Stripe delivery, which is exactly the
  // gap-free numbering the design comment on nextOrderNumber exists to protect.
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("order_number, confirmation_email_sent_at")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    console.error("Could not read order number:", readError.message);
    throw new Error("order number read failed");
  }
  if (!current) {
    // An order we just confirmed cannot be missing. Never report success for
    // an order we can no longer see.
    console.error(`Order ${orderId} disappeared before numbering.`);
    throw new Error("order missing before numbering");
  }
  // Already numbered — by an earlier delivery, or by the one that raced us.
  // That is not a reason to stop: the mail is the part that can be lost, and
  // the stamp is what says whether it was. Null there means nothing has ever
  // gone out for this order, so this delivery is entitled to send it.
  if (current.order_number) {
    return current.confirmation_email_sent_at ? null : current.order_number;
  }

  const orderNumber = await nextOrderNumber(supabase);

  const { data: updated, error } = await supabase
    .from("orders")
    .update({ order_number: orderNumber })
    .eq("id", orderId)
    .is("order_number", null)
    .select("id");

  if (error) {
    console.error("Could not assign order number:", error.message);
    throw new Error("order number assignment failed");
  }

  // `.select()` is what makes the assignment observable: PostgREST reports no
  // error when a compare-and-set matches nothing, so without it a silent
  // no-op and a real assignment looked identical. Zero rows here means a
  // concurrent delivery numbered the order between our read and our update —
  // its number stands and ours is discarded, costing one gap in that narrow
  // race instead of one per duplicate delivery.
  if (!updated || updated.length === 0) {
    console.warn(
      `Order ${orderId} was numbered concurrently; ${orderNumber} discarded.`,
    );
    // The delivery that won the race owns the confirmation for the number it
    // actually wrote. Ours was never stored, so emailing it would quote a
    // number that is not on the order.
    return null;
  }

  // Reaching here is the proof that THIS delivery allocated the number. The
  // order is confirmed and numbered by now and its items are already written
  // on every path that gets here, so there is something true to say.
  //
  // What has NOT happened yet is the stock movement. `finishConfirmation`
  // calls this function BEFORE `decrementStock` and queues the mail in
  // between, so the mail is queued while the stock claim is still unspent —
  // and `after()` runs its task whatever status the handler goes on to return.
  // If `decrementStock` then throws, the customer gets their confirmation AND
  // Stripe gets a 500 and redelivers; the retry finds the order numbered and
  // its mail already stamped, so nothing is re-sent. Net effect: exactly one
  // email about an order whose stock never moved.
  //
  // That is the intended trade, and this is the ordering to keep. Everything
  // the mail asserts — confirmed, here is your number, here is what you bought,
  // here is the print lead time — is already true and stays true; the stock
  // count is internal bookkeeping the mail never mentions. Numbering first is
  // also what gives the retry something to be idempotent against. The reverse
  // order would withhold a confirmation for a genuinely paid, genuinely
  // numbered order because an inventory RPC failed, which is much the worse of
  // the two failures. What is left over is a named 500 in the log (see
  // `decrementStock`) and a stock count to correct by hand.
  return orderNumber;
}

/* ------------------------------------------------------------------ email */

type ConfirmationItem = {
  product_name: string | null;
  variant_label: string | null;
  quantity: number | null;
  unit_price: number | null;
  personalisation: unknown;
  /**
   * Set on a Lucky Scoop line and null on every other. Read only to decide
   * whether the email has to explain that the contents are not chosen yet —
   * the line itself renders from `product_name` and `variant_label` like any
   * other, because "Pet scoop / 5 pieces" is precisely what was bought.
   */
  scoop_tier_id: string | null;
};

/** True for an order carrying at least one Lucky Scoop. */
function hasScoop(items: ConfirmationItem[]): boolean {
  return items.some((item) => Boolean(item.scoop_tier_id));
}

/**
 * The one sentence a scoop adds to a confirmation, and the several it must not.
 *
 * WHAT IT SAYS. That the pieces have not been chosen yet. Every other line on
 * this email describes a thing the customer picked; a scoop is the one they did
 * not, and a receipt that listed "Pet scoop — 5 pieces — $25.00" beside a
 * keyring, with no further word, would read as though five named pieces were
 * already set aside. Under the Australian Consumer Law the description binds,
 * and "lucky" does not waive it, so the email restates the actual bargain.
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. Nothing about a video. 0007 records that
 * whether every scoop is filmed is one of the decisions only the owner can
 * make, and it is not settled — `scoop_packs.video_url` is nullable precisely
 * so an order arriving at midnight is not unpostable until it has been filmed.
 * A promise of a video in a confirmation email is a term of sale nobody agreed
 * to. Nothing about returns either: whether a surprise is "made to order" for
 * change-of-mind purposes is a legal question this email must not answer by
 * implication, and the personalisation sentence below is correctly not
 * triggered by a scoop.
 */
const SCOOP_NOTE =
  "Your Lucky Scoop is drawn and packed by hand after you order, from the " +
  "pool shown on its page — so what's in it isn't decided yet.";

type ConfirmationOrder = {
  email: string | null;
  confirmation_email_sent_at?: string | null;
  subtotal: number | null;
  shipping: number | null;
  total: number | null;
  shipping_method: string | null;
  order_items?: ConfirmationItem[] | null;
};

/** "Standard" / "Express" — never inlined, so lib/config stays the one source. */
function shippingLabel(methodId: string | null): string {
  const method = SHIPPING.methods.find((m) => m.id === methodId);
  return (method ?? SHIPPING.methods[0]).label;
}

/** One rendered basket line: "2 × Macaron Keyring (Blush · Split ring)". */
function confirmationLines(items: ConfirmationItem[]) {
  return items.map((item) => {
    const quantity = item.quantity ?? 1;
    const variant = item.variant_label ? ` (${item.variant_label})` : "";
    return {
      label: `${quantity} × ${item.product_name || "Item"}${variant}`,
      amount: money((item.unit_price ?? 0) * quantity),
    };
  });
}

/**
 * The plain-text confirmation. Everything in here has to be true of an order
 * that has just been paid for and numbered:
 *
 *  - no GST line — the business is not registered for it (SHOP.gstRegistered);
 *  - PRINT_LEAD_TIME is printing time, said as printing time, never delivery;
 *  - no promise of a dispatch or tracking email, because nothing sends one;
 *  - /track needs the order number AND the email used at checkout, so the
 *    email says so rather than telling someone to "use your order number";
 *  - a contact line only when there is a real mailbox behind it
 *    (SHOP.hasSupportEmail), never the [HELLO@YOURDOMAIN] placeholder.
 */
function confirmationText(
  orderNumber: string,
  order: ConfirmationOrder,
  items: ConfirmationItem[],
): string {
  const lines = confirmationLines(items);
  return [
    `Thanks for your order — it's paid for and in the queue.`,
    ``,
    `Order number: ${orderNumber}`,
    ``,
    `What you ordered`,
    ...lines.map((line) => `  ${line.label} — ${line.amount}`),
    ``,
    `  Subtotal: ${money(order.subtotal ?? 0)}`,
    `  Postage (${shippingLabel(order.shipping_method)}): ${money(order.shipping ?? 0)}`,
    `  Total paid: ${money(order.total ?? 0)}`,
    ``,
    `What happens next`,
    `Everything is printed to order. Printing takes ${PRINT_LEAD_TIME.label} before`,
    `your parcel is posted, and postage time is on top of that — the printing`,
    `window is not a delivery date.`,
    ``,
    `Checking on your order`,
    `${siteUrl()}/track shows where it is up to. You'll need the order`,
    `number above and the email address you ordered with — it takes both to`,
    `find an order, so it's worth keeping this email.`,
    ``,
    `We don't send dispatch or tracking emails, so /track is the place to look.`,
    // Only for an order that has one. See SCOOP_NOTE for what this sentence
    // does and does not undertake.
    ...(hasScoop(items) ? [``, `About your scoop`, SCOOP_NOTE] : []),
    // Only for an order that actually has one: telling someone who bought a
    // plain keyring that their order is non-returnable would be untrue.
    ...(items.some((item) => item.personalisation)
      ? [``, `Personalised pieces can't be returned unless they arrive faulty.`]
      : []),
    ...(SHOP.hasSupportEmail
      ? [``, `Something not right? Reply to this email or write to ${SHOP.supportEmail}.`]
      : []),
    ``,
    `${SHOP.name} — ${SHOP.city}, ${SHOP.country}`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The same words as `confirmationText`, laid out. Inline styles only and no
 * images or external assets — mail clients strip stylesheets, and a broken
 * layout on a receipt reads as a broken shop.
 */
function confirmationHtml(
  orderNumber: string,
  order: ConfirmationOrder,
  items: ConfirmationItem[],
): string {
  const cell = 'style="padding:6px 0;border-bottom:1px solid #eee;"';
  const rows = confirmationLines(items)
    .map(
      (line) =>
        `<tr><td ${cell}>${escapeHtml(line.label)}</td>` +
        `<td ${cell} align="right">${escapeHtml(line.amount)}</td></tr>`,
    )
    .join("");
  const totals = [
    ["Subtotal", money(order.subtotal ?? 0)],
    [
      `Postage (${shippingLabel(order.shipping_method)})`,
      money(order.shipping ?? 0),
    ],
    ["Total paid", money(order.total ?? 0)],
  ]
    .map(
      ([label, amount]) =>
        `<tr><td style="padding:4px 0;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;" align="right">${escapeHtml(amount)}</td></tr>`,
    )
    .join("");
  const track = `${siteUrl()}/track`;
  const support = SHOP.hasSupportEmail
    ? `<p style="margin:0 0 12px;">Something not right? Reply to this email or write to ${escapeHtml(SHOP.supportEmail)}.</p>`
    : "";

  return [
    `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#2b2b2b;max-width:560px;">`,
    `<p style="margin:0 0 12px;">Thanks for your order — it's paid for and in the queue.</p>`,
    `<p style="margin:0 0 16px;"><strong>Order number: ${escapeHtml(orderNumber)}</strong></p>`,
    `<table style="width:100%;border-collapse:collapse;margin:0 0 12px;">${rows}</table>`,
    `<table style="width:100%;border-collapse:collapse;margin:0 0 20px;">${totals}</table>`,
    `<p style="margin:0 0 12px;"><strong>What happens next</strong><br>Everything is printed to order. Printing takes ${escapeHtml(PRINT_LEAD_TIME.label)} before your parcel is posted, and postage time is on top of that — the printing window is not a delivery date.</p>`,
    `<p style="margin:0 0 12px;"><strong>Checking on your order</strong><br><a href="${escapeHtml(track)}" style="color:#b4506b;">${escapeHtml(track)}</a> shows where it is up to. You'll need the order number above and the email address you ordered with — it takes both to find an order, so it's worth keeping this email.</p>`,
    `<p style="margin:0 0 12px;">We don't send dispatch or tracking emails, so /track is the place to look.</p>`,
    hasScoop(items)
      ? `<p style="margin:0 0 12px;"><strong>About your scoop</strong><br>${escapeHtml(SCOOP_NOTE)}</p>`
      : "",
    items.some((item) => item.personalisation)
      ? `<p style="margin:0 0 12px;">Personalised pieces can't be returned unless they arrive faulty.</p>`
      : "",
    support,
    `<p style="margin:0;color:#777;">${escapeHtml(SHOP.name)} — ${escapeHtml(SHOP.city)}, ${escapeHtml(SHOP.country)}</p>`,
    `</div>`,
  ].join("");
}

/**
 * Reads back what was actually recorded for the order and sends the customer
 * their confirmation. Runs detached from the response, so every failure ends
 * in a log line and nothing else.
 *
 * The order row is the source, not the Stripe session: it is the same record
 * /track and the account order page will show, so the email cannot describe an
 * order that differs from the one the shop will print.
 */
async function sendOrderConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  orderNumber: string,
) {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "email, subtotal, shipping, total, shipping_method, " +
        "confirmation_email_sent_at, " +
        // `scoop_tier_id` is here so the email can tell a Lucky Scoop from a
        // charm. It is a marker and nothing more — no pack, no contents, no
        // pieces. Those live in `scoop_packs`/`scoop_pack_items`, which are
        // service_role in and out, and at the moment this email is sent they do
        // not exist yet in any case.
        "order_items(product_name, variant_label, quantity, unit_price, " +
        "personalisation, scoop_tier_id)",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error(
      `Could not read order ${orderNumber} to confirm it by email:`,
      error.message,
    );
    report(() =>
      captureMessage("Order could not be read to send its confirmation", {
        scope: "stripe-webhook",
        level: "error",
        route: "/api/webhooks/stripe",
        tags: { orderNumber, orderId, reason: error.message },
      }),
    );
    return;
  }

  const order = data as ConfirmationOrder | null;

  // The retry path re-queues the mail for any numbered order with no stamp, so
  // two deliveries can both reach this point. Re-reading the stamp here — after
  // the queue gate, immediately before the send — narrows that window to the
  // few milliseconds between this read and the provider call. It is not a lock
  // and is not pretending to be one; the ordering trade is spelled out in
  // `finishConfirmation`.
  if (order?.confirmation_email_sent_at) return;

  if (!order || !hasCustomerEmail(order.email)) {
    // Either the column is empty, or it holds NO_CUSTOMER_EMAIL — what the
    // Stripe-rebuild insert writes when Stripe gave us no address at all. That
    // sentinel is a truthy string, so it has to be tested by name: a bare
    // `!order.email` let it straight through, and we handed Resend the word
    // "unknown" as a recipient, collected a 422, and logged `maskEmail`'s
    // `***` — an unhelpful failure for the one case this guard exists for.
    console.error(
      `Order ${orderNumber} has no address to confirm to — nothing sent.`,
    );
    report(() =>
      captureMessage("Paid order has no address to confirm to", {
        scope: "stripe-webhook",
        level: "error",
        route: "/api/webhooks/stripe",
        // The order number, never the column's contents. `hasCustomerEmail`
        // being false means it is empty or the NO_CUSTOMER_EMAIL sentinel, and
        // which of the two it is is the only fact worth carrying.
        tags: { orderNumber, orderId, sentinel: order?.email === NO_CUSTOMER_EMAIL },
      }),
    );
    return;
  }

  const items = (order.order_items ?? []).filter(Boolean);
  if (items.length === 0) {
    // A confirmation listing nothing is worse than no confirmation: it tells a
    // customer their order is fine when we cannot see what is on it.
    console.error(`Order ${orderNumber} has no items — no confirmation sent.`);
    report(() =>
      captureMessage("Paid order has no line items — no confirmation sent", {
        scope: "stripe-webhook",
        level: "error",
        route: "/api/webhooks/stripe",
        tags: { orderNumber, orderId },
      }),
    );
    return;
  }

  const result = await sendEmail({
    to: order.email,
    subject: `Order ${orderNumber} confirmed — ${SHOP.name}`,
    text: confirmationText(orderNumber, order, items),
    html: confirmationHtml(orderNumber, order, items),
    // Only when there is a mailbox behind it; otherwise replies go wherever
    // EMAIL_FROM points, which is at least a real sender.
    ...(SHOP.hasSupportEmail ? { replyTo: SHOP.supportEmail } : {}),
  });

  // Masked on both branches: this is the one place in the order flow holding a
  // customer's address, and the platform log stream is not where it belongs.
  // The message body is never logged at all.
  if (result.ok) {
    console.info(
      `Order ${orderNumber} confirmed to ${maskEmail(order.email)}.`,
    );

    // Stamped only now, and only on success. This is the whole recovery story:
    // until this write lands the order still reads as unconfirmed by email, so
    // the next Stripe delivery re-queues the send rather than assuming it
    // happened. Scoped to a null stamp so a concurrent delivery's timestamp is
    // not overwritten with a later one.
    const { error: stampError } = await supabase
      .from("orders")
      .update({ confirmation_email_sent_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("confirmation_email_sent_at", null);

    // Not thrown: this task is detached from the response and the mail has
    // already gone. An unrecorded success means a later delivery may send a
    // second copy — the safe direction, and the direction this whole change
    // chooses on purpose.
    if (stampError) {
      console.error(
        `Order ${orderNumber} was confirmed by email but the send could not ` +
          "be recorded; a Stripe redelivery may send it again:",
        stampError.message,
      );
    }
    return;
  }
  console.error(
    `Order ${orderNumber} confirmation to ${maskEmail(order.email)} was not ` +
      `sent (${result.reason}):`,
    result.detail,
  );
  // The 2am Resend 429 this whole round is named after. The customer has paid,
  // the order is correct, and the only notification they were ever going to
  // get did not arrive. The stamp is deliberately NOT written above, so a later
  // Stripe delivery re-queues the send — but Stripe's retries run out, and
  // after that nobody finds out until the customer asks.
  //
  // The masked address is in the log line above and NOT here: `result.detail`
  // is already scrubbed by lib/email.ts, and `scrub()` in lib/observability.ts
  // takes a second pass at it, because provider errors quote the address they
  // rejected.
  report(() =>
    captureMessage("Order confirmation email was not sent", {
      scope: "stripe-webhook",
      level: "error",
      route: "/api/webhooks/stripe",
      tags: {
        orderNumber,
        orderId,
        reason: result.reason,
        status: result.status,
        detail: result.detail,
      },
    }),
  );
}

/**
 * Schedules the confirmation email so it cannot touch this webhook's response.
 *
 * `after()` is the right tool rather than an awaited call: Next runs the task
 * once the response has already been sent, so a slow provider cannot delay the
 * 200 that tells Stripe the work is done, and a rejected task cannot turn a
 * confirmed order into a 500 that makes Stripe redeliver an order that is
 * already printed. Awaiting `sendEmail` inline would add up to its 8s timeout
 * to every confirmation, on the one request in the system that must answer
 * fast; and `sendEmail` returning a failure result rather than throwing does
 * not by itself protect us, because the read and the rendering either side of
 * it can still throw.
 */
function queueOrderConfirmation(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
  orderNumber: string,
) {
  // Unconfigured is a complete no-op: no task, no extra query, no log line.
  // The shop's own copy is gated on `isEmailConfigured()` — this exact
  // predicate, not a public mirror of it — so the claim and the capability can
  // no longer disagree: if this returns false, every page has already told the
  // customer no order email is coming, and the silence breaks nothing.
  if (!isEmailConfigured()) return;

  const task = async () => {
    try {
      await sendOrderConfirmation(supabase, orderId, orderNumber);
    } catch (error) {
      // sendEmail is contracted never to throw and everything around it is
      // guarded, but this runs detached from the request: an escaping
      // rejection is an unhandled rejection in the runtime, not something the
      // customer or Stripe ever sees. A missing email is a far smaller problem
      // than a redelivered webhook, so it stops here.
      console.error(`Order ${orderNumber} confirmation email failed:`, error);
      // Detached from the request, so `onRequestError` in instrumentation.ts
      // never sees this one — the runtime's unhandled-rejection handler would
      // be the only other witness. Nested `after()` is not available inside an
      // `after()` task, which is why `report` falls back to a bare promise.
      report(() =>
        captureException(error, {
          scope: "stripe-webhook",
          level: "error",
          route: "/api/webhooks/stripe",
          tags: { orderNumber, task: "confirmation-email" },
        }),
      );
    }
  };

  try {
    after(task);
  } catch (error) {
    // `after()` throws when it is called outside a request scope. A route
    // handler always has one, so this is belt and braces — but the entire
    // point of this function is that mail cannot break a confirmed order, and
    // that has to hold for the scheduling call itself. A detached promise
    // cannot propagate either; it is only weaker in that the platform may not
    // wait for it before freezing the instance.
    console.error(
      `Could not schedule the confirmation email for ${orderNumber}:`,
      error,
    );
    report(() =>
      captureException(error, {
        scope: "stripe-webhook",
        level: "error",
        route: "/api/webhooks/stripe",
        tags: { orderNumber, task: "confirmation-email-schedule" },
      }),
    );
    void task();
  }
}

/** Parses the compact "slug:qty,slug:qty" map checkout leaves in metadata. */
function parseStockMap(raw: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  if (!raw) return map;
  for (const entry of raw.split(",")) {
    const [slug, qty] = entry.split(":");
    const quantity = Number(qty);
    if (slug && Number.isFinite(quantity) && quantity > 0) {
      map.set(slug, (map.get(slug) ?? 0) + quantity);
    }
  }
  return map;
}

/**
 * Claims the right to move an order's stock, exactly once, via a
 * compare-and-set. Returns false when another delivery already claimed it.
 * Both the staged path and the Stripe-rebuild path go through this, so a
 * retry that lands on the other path cannot double-count.
 */
async function claimStock(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("orders")
    .update({ stock_applied: true })
    .eq("id", orderId)
    .eq("stock_applied", false)
    .select("id");

  if (error) {
    console.error("Could not claim stock movement:", error.message);
    throw new Error("stock claim failed");
  }
  return Boolean(data && data.length > 0);
}

/**
 * Hands back a stock claim that was taken but never spent, so a later Stripe
 * delivery can attempt the movement again. Only ever called while nothing has
 * been decremented yet: `decrement_stock` has no per-item idempotency, so
 * replaying a partially applied loop would double-count the products that
 * already succeeded.
 *
 * A failure to release is logged and swallowed on purpose — the caller is
 * already throwing, and the original failure is the one worth reporting. The
 * cost of a stuck claim is a stock count that has to be corrected by hand, not
 * a lost order.
 */
async function releaseStockClaim(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  const { error } = await supabase
    .from("orders")
    .update({ stock_applied: false })
    .eq("id", orderId)
    .eq("stock_applied", true);

  if (error) {
    console.error(
      `Could not release the stock claim on order ${orderId}; its stock will ` +
        "need moving by hand:",
      error.message,
    );
  }
}

/**
 * Ready-to-ship stock only; made-to-order lines sit at zero already.
 *
 * Claims the work with a compare-and-set on `stock_applied` before touching
 * any counts, so a Stripe retry — or a retry finishing a half-completed
 * confirm — cannot decrement the same order twice.
 *
 * The claim being taken first is what made the swallowed errors below
 * permanent: once `stock_applied` is true no later delivery re-enters this
 * function, so a discarded failure meant the counts never moved and never
 * would. Both failures now surface as a 500, and the claim is handed back
 * whenever it can be handed back safely.
 */
async function decrementStock(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  if (!(await claimStock(supabase, orderId))) return;

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("product_id, scoop_tier_id, quantity, personalisation")
    .eq("order_id", orderId);

  if (itemsError) {
    // Nothing has moved yet, so the claim is safe to release and the retry can
    // do the whole movement cleanly.
    console.error("Could not read items for stock:", itemsError.message);
    await releaseStockClaim(supabase, orderId);
    throw new Error("stock item read failed");
  }

  let applied = 0;
  for (const item of items ?? []) {
    /*
     * A LUCKY SCOOP MOVES NO STOCK HERE, AND THIS IS THE LINE THAT SAYS SO.
     *
     * A scoop is sold before its contents are decided. At this moment — money
     * taken, order numbered — nobody, the studio included, knows which products
     * are going in the bag, so there is nothing to decrement. Stock comes off
     * later, in the pack panel, one `decrement_stock` per piece actually drawn,
     * guarded by `scoop_packs.stock_applied` so a re-saved panel cannot take the
     * same pieces twice (0007_lucky_scoop.sql).
     *
     * The `!item.product_id` test below would already skip it, because a scoop
     * line's product id is null by CHECK constraint. That is an ACCIDENT of two
     * facts holding at once, not a decision, and it evaporates silently the day
     * anyone backfills a product id or relaxes the constraint — after which
     * every scoop sold would quietly take a charm off the shelf that nobody had
     * drawn. Asking the question directly is what makes the rule survive that.
     */
    if (item.scoop_tier_id) continue;
    if (!item.product_id || item.personalisation) continue;
    const { data: shortfall, error } = await supabase.rpc("decrement_stock", {
      p_product_id: item.product_id,
      p_quantity: item.quantity ?? 1,
    });
    if (error) {
      // Logging and carrying on returned 200 with the counts un-moved and the
      // claim already spent, so the drift was permanent and invisible. Release
      // the claim only while nothing has landed; once a decrement has gone
      // through, a replay would double-count it, and one order short of its
      // stock movement — named here in the log — beats silent drift across
      // every product on it.
      console.error(
        `Stock decrement failed for order ${orderId}, product ` +
          `${item.product_id} (${applied} line(s) already applied):`,
        error.message,
      );
      if (applied === 0) await releaseStockClaim(supabase, orderId);
      throw new Error("stock decrement failed");
    }
    applied += 1;

    // THE DEFECT THIS CLOSES (supabase/migrations/0005_sale_integrity.sql §2).
    //
    // `decrement_stock` used to return void and clamp at zero, so selling the
    // last one twice succeeded twice and said nothing at all. It now returns
    // the shortfall — how many units were sold that the buffer did not have —
    // and accumulates it on `products.oversold_units` for the inventory screen.
    //
    // This is NOT an error and does not fail the delivery: the shop prints to
    // order, so an oversell is a print-this-first signal, not a sale that
    // should have been refused. See the migration for why checkout does not
    // stop it. Logged with the order so the piece can be traced to the sale
    // that got ahead of the shelf.
    const oversold = Number(shortfall ?? 0);
    if (oversold > 0) {
      console.warn(
        `Order ${orderId} oversold product ${item.product_id} by ${oversold} ` +
          "unit(s) — the buffer was short. Print these first; the count is on " +
          "products.oversold_units.",
      );
    }
  }
}

/**
 * Removes the `pending` row for a checkout that will never be paid.
 *
 * The failed delete is logged and NOT thrown, and this is the one discarded
 * failure in the file that is right to discard. Nothing a customer can see is
 * at stake: the row is `pending`, which is excluded from the account order
 * list and from guest tracking, so it is not a visible order; it holds no
 * order number and has moved no stock; and its Stripe session is terminal, so
 * no later delivery ever needs its `stripe_session_id` back. A 500 here would
 * tell Stripe a payment event failed in order to buy a tidier table. The
 * session id is logged so a leftover row can be cleared by hand.
 *
 * Scoped to `status = 'pending'` so a confirmed order can never be deleted by
 * a late failure event.
 */
async function discardStagedOrder(sessionId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("stripe_session_id", sessionId)
    .eq("status", "pending");

  if (error) {
    console.error(
      `Could not discard the staged order for ${sessionId}:`,
      error.message,
    );
  }
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    // A signature mismatch means this did not come from Stripe — reject it.
    console.error("Webhook signature verification failed:", error);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // Delayed methods stay unpaid here and arrive later as
        // async_payment_succeeded, so only confirm what is actually paid.
        if (session.payment_status === "paid") await confirmOrder(session);
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await confirmOrder(event.data.object);
        break;
      case "checkout.session.async_payment_failed": {
        // A delayed payment that never cleared. Stripe does not send
        // `expired` for a completed session, so without this the staged row
        // would sit pending forever.
        await discardStagedOrder(event.data.object.id);
        break;
      }
      case "checkout.session.expired": {
        // Tidy up the staged row so abandoned baskets don't accumulate.
        await discardStagedOrder(event.data.object.id);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // A 500 asks Stripe to retry, which is what we want here.
    console.error(`Handling ${event.type} failed:`, error);
    // Every database failure in this file throws up to here, so this one line
    // covers order insert/update/read failures, stock claiming, item writes
    // and order-number allocation. `onRequestError` will not fire — the throw
    // is caught, and a caught error is invisible to Next's hook — so this is
    // the only place it can be reported from.
    //
    // Stripe retries with backoff for about three days and then stops. That is
    // the window in which somebody has to notice; a 500 on its own notifies
    // nobody at all.
    report(() =>
      captureException(error, {
        scope: "stripe-webhook",
        level: "fatal",
        route: "/api/webhooks/stripe",
        // Event TYPE, not event id and not session id: the type is a fixed
        // Stripe enum and groups usefully, the ids do not group at all and one
        // of them opens a customer's order. `livemode` separates a real
        // customer's money from a test card.
        tags: { eventType: event.type, livemode: event.livemode },
      }),
    );
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
