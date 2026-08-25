import { after, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { isEmailConfigured, maskEmail, sendEmail } from "@/lib/email";
import { PRINT_LEAD_TIME, SHIPPING, SHOP } from "@/lib/config";
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
        // Repairing it would number it, move stock and — since numbering is
        // what queues the mail — confirm to a customer whose order the shop
        // has already pulled. Return rather than throw: no retry can ever make
        // a cancelled order eligible, so a 500 buys nothing but an unbounded
        // redelivery loop. Logged as an error because the money did arrive and
        // the refund is a manual job.
        console.error(
          `Order ${staged.id} is ${staged.status}; payment for session ` +
            `${session.id} arrived anyway. Not repairing, not numbering, not ` +
            "moving stock, not confirming by email — refund this one by hand.",
        );
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
        console.error(
          `Order ${staged.id} is ${staged.status}; payment for session ` +
            `${session.id} arrived anyway. Not numbering, not moving stock, ` +
            "not confirming by email — refund this one by hand.",
        );
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
  const slugs = [
    ...new Set([
      ...parseStockMap(session.metadata?.stock).keys(),
      ...lineItems.data
        .map((item) => productSlugOf(item))
        .filter((slug): slug is string => Boolean(slug)),
    ]),
  ];
  const names = [
    ...new Set(
      lineItems.data
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

  const { error } = await supabase.from("order_items").insert(
    lineItems.data.map((item) => {
      const name = productNameOf(item) ?? "Item";
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
  await assignOrderNumber(supabase, orderId);
  await decrementStock(supabase, orderId);
}

/**
 * Gives a confirmed order its customer-facing number, once and only once.
 * Scoped to rows that don't have one yet, so a retry cannot renumber an order
 * the customer has already been emailed about.
 */
async function assignOrderNumber(
  supabase: ReturnType<typeof createAdminClient>,
  orderId: string,
) {
  // Read before allocating. `nextOrderNumber` used to be awaited inside the
  // update payload, so the sequence was consumed on EVERY call — including the
  // duplicate deliveries whose `is null` compare-and-set matches no rows. That
  // burned an order number per duplicate Stripe delivery, which is exactly the
  // gap-free numbering the design comment on nextOrderNumber exists to protect.
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("order_number")
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
  if (current.order_number) return;

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
    return;
  }

  // Reaching here is the proof that THIS delivery did the work, and it is the
  // whole at-most-once story for the confirmation email. `order_number` goes
  // null → non-null under a compare-and-set and never goes back, so of the
  // first delivery, Stripe's retries and the duplicate
  // `async_payment_succeeded`, exactly one can ever see rows here: every other
  // one either returns at the `current.order_number` check above or loses this
  // race and takes the branch above. The order is confirmed and numbered by
  // now and its items are already written on every path that gets here, so
  // there is something true to say. Queue the mail from here and nowhere else.
  //
  // What has NOT happened yet is the stock movement. `finishConfirmation`
  // calls this function BEFORE `decrementStock`, so the mail is queued while
  // the stock claim is still unspent — and `after()` runs its task whatever
  // status the handler goes on to return. If `decrementStock` then throws,
  // the customer gets their confirmation AND Stripe gets a 500 and redelivers;
  // the retry returns at the `current.order_number` check above, so nothing is
  // ever re-sent. Net effect: exactly one email about an order whose stock
  // never moved.
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
  queueOrderConfirmation(supabase, orderId, orderNumber);
}

/* ------------------------------------------------------------------ email */

type ConfirmationItem = {
  product_name: string | null;
  variant_label: string | null;
  quantity: number | null;
  unit_price: number | null;
  personalisation: unknown;
};

type ConfirmationOrder = {
  email: string | null;
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
        "order_items(product_name, variant_label, quantity, unit_price, personalisation)",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error(
      `Could not read order ${orderNumber} to confirm it by email:`,
      error.message,
    );
    return;
  }

  const order = data as ConfirmationOrder | null;
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
    return;
  }

  const items = (order.order_items ?? []).filter(Boolean);
  if (items.length === 0) {
    // A confirmation listing nothing is worse than no confirmation: it tells a
    // customer their order is fine when we cannot see what is on it.
    console.error(`Order ${orderNumber} has no items — no confirmation sent.`);
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
    return;
  }
  console.error(
    `Order ${orderNumber} confirmation to ${maskEmail(order.email)} was not ` +
      `sent (${result.reason}):`,
    result.detail,
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
    .select("product_id, quantity, personalisation")
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
    if (!item.product_id || item.personalisation) continue;
    const { error } = await supabase.rpc("decrement_stock", {
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
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
