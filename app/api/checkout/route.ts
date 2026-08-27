import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import {
  getCollections,
  isDatabaseConfigured,
  loadProductsBySlug,
  loadScoopTiersBySlug,
} from "@/lib/queries";
import {
  BASKET_LIMITS,
  BUILDER_MAX_LETTERS,
  BUILDER_NO_CHARM_DISCOUNT,
  BUILDER_PRICING,
  isFreeShipping,
  PERSONALISATION_TEXT_MAX,
  PERSONALISATION_TEXT_PATTERN,
  PRINT_LEAD_TIME,
  SHIPPING,
  transitDays,
} from "@/lib/config";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import { toShippingLines } from "@/lib/shipping/lines";
// The studio's own costing, reused rather than re-implemented: one definition
// of what a piece costs, whether the sale came from the website or from a
// market stall. It lives in lib/ and not in app/admin/data.ts, which is where
// this route used to import it from: a customer-facing endpoint should not put
// the staff area on its import graph to find out what a piece cost. Nor can it
// live in app/admin/actions.ts — every export from a "use server" file becomes
// a callable HTTP endpoint.
import { unitCostsAtSale } from "@/lib/cost-basis";
import {
  scoopArt,
  scoopLineMetadata,
  scoopVariantLabel,
  toScoopShippingLines,
} from "@/lib/scoop-line";
import { quoteBasket } from "@/lib/shipping/quote";

export const runtime = "nodejs";

const LineSchema = z.object({
  product_id: z.string().min(1),
  slug: z.string().min(1),
  colour: z.string().nullable().optional(),
  attachment_id: z.string().nullable().optional(),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
  /** "text" mode personalisation — one printed line, e.g. a pet's name. */
  personalisation_text: z.string().max(PERSONALISATION_TEXT_MAX).optional(),
  custom: z
    .object({
      collection_slug: z.string().min(1).max(60),
      // Kept only for older clients; the server uses the stored name.
      collection_name: z.string().min(1).max(60),
      letters: z
        .string()
        .min(1)
        .max(BUILDER_MAX_LETTERS)
        .regex(/^[A-Za-z]+$/, "Letters only."),
      with_charm: z.boolean(),
    })
    .optional(),
});

/**
 * A Lucky Scoop line. A slug and a quantity, and deliberately nothing else.
 *
 * There is no price here, no piece count and no weight, because there is
 * nothing on this wire the server would believe: the tier row supplies all
 * three, exactly as `products` supplies a product's price. Nor is there a
 * colour, a finding or personalisation — a scoop has none of those, and a field
 * that accepted one would invite a caller to think it might.
 *
 * Separate from `LineSchema` rather than folded into it. `scoop_tiers.slug` and
 * `products.slug` are separate unique indexes on separate tables, so the same
 * string may exist in both; one array of bare slugs would leave this route
 * deciding which table a line meant, and deciding wrong charges a tier's price
 * for a charm — or worse, decrements a charm for a tier.
 */
const ScoopLineSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
});

const BodySchema = z
  .object({
    // Both caps come from lib/config.ts. They used to be literals here and in
    // /api/shipping/quote, with a third transcription in the cart, and nothing
    // held the three copies together — a basket the client would build and this
    // schema would refuse comes back as a blanket "Invalid basket." naming no
    // line. One definition, imported by every surface that has to respect it.
    //
    // `min(1)` has moved off this array onto the refinement below, because a
    // basket of nothing but scoops has no product lines at all. The refinement
    // preserves both halves of what `min(1).max(maxLines)` said — a body with
    // neither kind of line is still "Invalid basket.", and the line cap is now
    // counted across the whole basket rather than per array, so forty of each
    // cannot become eighty.
    lines: z.array(LineSchema).default([]),
    scoop_lines: z.array(ScoopLineSchema).default([]),
    email: z.string().email().optional(),
    shipping_method: z.enum(["standard", "express"]).default("standard"),
    gift_note: z.string().max(500).optional(),
  })
  .refine(
    (body) =>
      body.lines.length + body.scoop_lines.length >= 1 &&
      body.lines.length + body.scoop_lines.length <= BASKET_LIMITS.maxLines,
  );

type SummaryLine = {
  product_id: string;
  slug: string;
  name: string;
  art: string;
  tint: string;
  variant: string;
  colour: string | null;
  attachment_id: string | null;
  unit_price: number;
  quantity: number;
  personalisation: unknown;
};

/**
 * A priced scoop line, ready to be staged.
 *
 * A SEPARATE ARRAY FROM `SummaryLine[]`, AND THAT IS THE POINT. Two things in
 * this file walk the product summary and must never see a scoop:
 * `stockMap()`, which builds the `slug:qty` map the webhook's rebuild path
 * decrements from, and `unitCostsAtSale()`, which looks a product's making cost
 * up by id. A scoop has no shelf to come off and no recipe to cost, so both
 * would be wrong for it — `stockMap` catastrophically so, since the slug it
 * would emit could match a real product and take that product off the shelf.
 *
 * Keeping the two lists apart makes that structural. A filter would work today
 * and would be one forgotten `if` away from not working; a type that cannot be
 * passed to either function cannot be forgotten.
 *
 * Note the fields that are absent rather than nulled: no `colour`, no
 * `attachment_id`, no `personalisation`. And note `unit_cost_cents` is nowhere
 * here at all — it is written as NULL at the insert, and the studio stamps the
 * real figure when the pack is recorded.
 */
type ScoopSummaryLine = {
  tier_id: string;
  name: string;
  art: string;
  tint: string;
  variant: string;
  unit_price: number;
  quantity: number;
};

/**
 * Packs the basket into Stripe's 500-character metadata budget as
 * "slug:qty,slug:qty". Entries are dropped whole rather than the string being
 * sliced — a cut mid-entry would hand the webhook a truncated slug and
 * silently skip that product's stock movement.
 */
const STOCK_METADATA_LIMIT = 480;

function stockMap(items: SummaryLine[]): string {
  const parts: string[] = [];
  let length = 0;

  for (const item of items) {
    if (item.personalisation) continue;
    const entry = `${item.slug}:${item.quantity}`;
    const cost = entry.length + (parts.length > 0 ? 1 : 0);
    if (length + cost > STOCK_METADATA_LIMIT) {
      console.warn(
        `Stock metadata full — ${item.slug} omitted; its stock will not move ` +
          "if the webhook has to rebuild this order.",
      );
      continue;
    }
    parts.push(entry);
    length += cost;
  }

  return parts.join(",");
}

/**
 * Records the basket as a `pending` order keyed by the Stripe session, so the
 * webhook only has to confirm it. Stripe's 500-character metadata limit makes
 * carrying the basket on the session itself unworkable.
 *
 * A failure here must not block checkout: the webhook can still rebuild an
 * order from the Stripe session, so we log and continue.
 */
async function savePendingOrder(input: {
  sessionId: string;
  userId: string | null;
  email: string;
  subtotal: number;
  shipping: number;
  shippingMethod: string;
  giftNote: string | null;
  items: SummaryLine[];
  scoopItems: ScoopSummaryLine[];
  /**
   * What was quoted, as opposed to what was charged. `shipping` above can be 0
   * because of the free-postage promotion while the studio still pays the
   * carrier — these three are what makes that reconcilable, and what makes a
   * postage bill checkable against the orders that caused it. Null means the
   * order predates postage quoting.
   */
  quoteSource: string | null;
  quotedWeightGrams: number | null;
  quotedServiceCode: string | null;
}): Promise<{ ok: boolean }> {
  // Nothing to stage when the shop is running on sample data.
  if (!isDatabaseConfigured()) return { ok: true };

  const supabase = createAdminClient();
  let orderId: string | null = null;

  try {
    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        user_id: input.userId,
        email: input.email,
        status: "pending",
        subtotal: input.subtotal,
        shipping: input.shipping,
        total: input.subtotal + input.shipping,
        shipping_method: input.shippingMethod,
        gift_note: input.giftNote,
        shipping_address: {},
        stripe_session_id: input.sessionId,
        shipping_quote_source: input.quoteSource,
        quoted_weight_grams: input.quotedWeightGrams,
        quoted_service_code: input.quotedServiceCode,
      })
      .select("id")
      .single();

    if (error || !order) {
      console.error("Could not stage order:", error?.message);
      return { ok: false };
    }
    orderId = order.id;

    // THE DEFECT THIS CLOSES (defect 2): `unit_cost_cents` was written in
    // exactly one place — the market-stall form in app/admin/actions.ts — so
    // every website sale landed with a null making cost and /admin/reports had
    // nothing to subtract for the online channel.
    //
    // Stamped here, as the basket is recorded, and never derived at read time:
    // the column exists to say what the piece cost WHEN IT SOLD, and computing
    // it later would rewrite every historical margin the next time filament or
    // electricity changed price. Minutes separate this from the payment, and
    // the alternative — waiting for the webhook — would leave the ordinary,
    // staged path with no cost at all.
    //
    // Never blocks a sale. A cost that cannot be worked out is a null, which
    // reports already handle honestly; a checkout that fails because the
    // costing tables were unreadable would be a far worse trade.
    let costs = new Map<string, number | null>();
    try {
      costs = await unitCostsAtSale(input.items.map((item) => item.product_id));
    } catch (error) {
      console.error("Could not cost the basket; lines keep a null cost:", error);
    }

    const { error: itemsError } = await supabase.from("order_items").insert([
      ...input.items.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        scoop_tier_id: null,
        product_name: item.name,
        variant_label: item.variant,
        art: item.art,
        tint: item.tint,
        colour: item.colour,
        attachment_id: item.attachment_id,
        unit_price: item.unit_price,
        quantity: item.quantity,
        personalisation: item.personalisation,
        // Null for a product nobody has measured — an honest gap the reports
        // count and say out loud, rather than a zero that reads as 100% margin.
        unit_cost_cents: costs.get(item.product_id) ?? null,
      })),
      /*
       * A SCOOP LINE. Everything below is decided by one fact: this was sold
       * before anybody knew what would be in it.
       *
       *  - `scoop_tier_id` and NOT `product_id`. The two are mutually exclusive
       *    in the schema, and the null here is what the CHECK constraint wants
       *    to see. It is also what keeps the line out of stock claiming: the
       *    webhook's decrement loop asks for a product id and there is none.
       *  - `product_name` is the TIER'S name, because "Pet scoop" is what the
       *    customer chose and what /track, the account pages, the confirmation
       *    email and the studio's packing list all render.
       *  - `unit_cost_cents` is NULL, and stays null until the pack is recorded.
       *    There is no recipe to cost a scoop from at this moment, so any figure
       *    written here would be invented. `unitCostsAtSale()` is never called
       *    with a tier id — it could only answer for a product.
       *  - `personalisation` is null. A scoop is not made to a customer's spec;
       *    marking it personalised would also, in this codebase, suppress its
       *    stock movement, which is the right outcome reached by a wrong reason.
       */
      ...input.scoopItems.map((item) => ({
        order_id: order.id,
        product_id: null,
        scoop_tier_id: item.tier_id,
        product_name: item.name,
        variant_label: item.variant,
        art: item.art,
        tint: item.tint,
        colour: null,
        attachment_id: null,
        unit_price: item.unit_price,
        quantity: item.quantity,
        personalisation: null,
        // Not "unknown yet" as a zero. Null, until the studio records what
        // actually went in and `recordScoopPack` stamps the real figure.
        unit_cost_cents: null,
      })),
    ]);

    if (itemsError) {
      // An order row with no items is worse than no row at all: the webhook
      // would confirm it and we would have taken money with no record of what
      // to print. Remove it so the checkout fails cleanly instead.
      console.error("Could not stage items:", itemsError.message);
      await supabase.from("orders").delete().eq("id", order.id);
      return { ok: false };
    }

    return { ok: true };
  } catch (error) {
    console.error("Could not stage order:", error);
    if (orderId) {
      await supabase
        .from("orders")
        .delete()
        .eq("id", orderId)
        .then(undefined, () => {});
    }
    return { ok: false };
  }
}

/**
 * Creates a Stripe Checkout Session.
 *
 * Prices are recomputed here from the database — the client only says WHICH
 * product and how many. A tampered basket cannot change what is charged.
 */
export async function POST(request: Request) {
  // This route writes order rows with the service-role key, so an unthrottled
  // loop could fill the table. Real shoppers check out a handful of times.
  const limit = rateLimit(clientKey(request, "checkout"), 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid basket." }, { status: 400 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json(
      { error: "Payments are not configured yet." },
      { status: 503 },
    );
  }

  // The next two guards are a matched pair, and they enforce one rule: never
  // take money for an order that cannot be recorded. Stripe is configured by
  // the time we get here (getStripe() succeeded above), so each guard only has
  // to ask whether the *database* half is whole. (a) covers half-configured;
  // (b) covers not configured at all.

  // (a) Database configured but no service-role key: checkout would take money
  // and the webhook would 500 on every delivery, recording nothing. Refuse up
  // front rather than discovering it in the Stripe dashboard.
  if (isDatabaseConfigured() && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing — refusing checkout.");
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  // (b) The mirror of (a): live Stripe, no database at all. savePendingOrder()
  // returns ok early when the database is unconfigured, so nothing downstream
  // catches this — the charge succeeds, no order row is ever written, and
  // /order/confirmed still tells the customer their order is confirmed. Money
  // taken, nothing to print, nothing to track.
  //
  // The NODE_ENV check is deliberate and load-bearing. DO NOT "tidy" it away
  // into an unconditional guard — that has already been done, and re-fixed,
  // twice (WORKLOG §5 rounds 3 and 4), and round 4's rule is the constraint: a
  // guard may reject a query *error*, never the *absence* of a database.
  // Running with no database at all is an intended mode (CLAUDE.md), and it is
  // exactly what the only verification flow this project has depends on: a
  // dummy Stripe key, no Supabase env, and the real CartView payloads replayed
  // against this route (scripts/replay-checkout.mjs), where 502 — reached
  // Stripe — is the pass. An unconditional guard turns every one of those
  // cases into a 503 that never reaches the validation being tested, and three
  // previous regressions were caught only by that replay. Outside production
  // the key in use is a test key and no real money can move, so the trade is
  // one-sided: guard where the charge is real, stay out of the way where it
  // is not.
  if (process.env.NODE_ENV === "production" && !isDatabaseConfigured()) {
    console.error(
      "Supabase is not configured in production — refusing checkout: a real " +
        "charge would leave no order record and nothing to print.",
    );
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const [products, tiers] = await Promise.all([
    loadProductsBySlug(body.lines.map((l) => l.slug)),
    // Read through RLS on purpose — see loadScoopTiersBySlug. A draft or
    // unpriced tier is simply not in this map, so it can never be charged for.
    loadScoopTiersBySlug(body.scoop_lines.map((l) => l.slug)),
  ]);

  // Personalised lines are priced against a real collection, never the
  // colourway name the client claims.
  const needsCollections = body.lines.some((l) => l.custom);
  let collections = new Map<string, Awaited<ReturnType<typeof getCollections>>[number]>();
  if (needsCollections) {
    try {
      // strict: a colourway must be checked against the real table, never a
      // bundled fallback that could still list one we have retired.
      const rows = await getCollections(true);
      collections = new Map(rows.map((c) => [c.slug, c] as const));
    } catch {
      return NextResponse.json(
        { error: "Personalised items are briefly unavailable. Please try again." },
        { status: 503 },
      );
    }
  }

  const lineItems: {
    price_data: {
      currency: string;
      unit_amount: number;
      product_data: {
        name: string;
        description?: string;
        // `slug` is the unique key that lets the webhook's rebuild path find the
        // row a line was charged for. The scoop keys (see SCOOP_METADATA in
        // lib/scoop-line.ts) are what let it tell a tier's slug from a
        // product's — the two live in different tables and can be the same
        // string — so the index signature is what carries them without every
        // ordinary line pretending it might have them.
        metadata: Record<string, string>;
      };
    };
    quantity: number;
  }[] = [];
  const summary: SummaryLine[] = [];
  const scoopSummary: ScoopSummaryLine[] = [];
  let subtotal = 0;

  for (const line of body.lines) {
    const product = products.get(line.slug);
    if (!product) {
      return NextResponse.json(
        { error: `“${line.slug}” is no longer available.` },
        { status: 409 },
      );
    }

    let unitPrice: number;
    let description: string;

    // A `custom` block carries builder bundle pricing, so it must only ever
    // reach a builder product — otherwise an $18 item could be bought for $3.
    if (line.custom && product.personalisation_mode !== "builder") {
      return NextResponse.json(
        { error: `“${product.short_name}” is not built in the designer.` },
        { status: 400 },
      );
    }
    if (line.personalisation_text && product.personalisation_mode !== "text") {
      return NextResponse.json(
        { error: `“${product.short_name}” cannot be personalised with text.` },
        { status: 400 },
      );
    }
    if (product.personalisation_mode === "builder" && !line.custom) {
      return NextResponse.json(
        { error: `“${product.short_name}” needs to be built in the designer.` },
        { status: 400 },
      );
    }
    if (product.personalisation_mode === "text" && !line.personalisation_text) {
      return NextResponse.json(
        { error: `“${product.short_name}” needs the text you want printed.` },
        { status: 400 },
      );
    }

    // Colour is resolved per branch below: a builder line's "colour" is its
    // colourway, which is validated against the collections table, not the
    // product's own colour list (builder products have none).
    let colour: string | null = null;

    if (line.custom) {
      // Builder item: flat bundle price by letter count, ignore client price.
      const collection = collections.get(line.custom.collection_slug);
      if (!collection) {
        return NextResponse.json(
          { error: "That colourway is no longer available." },
          { status: 409 },
        );
      }

      const letters = line.custom.letters.replace(/[^A-Za-z]/g, "").toUpperCase();
      const bundle = BUILDER_PRICING[letters.length];
      if (!bundle) {
        return NextResponse.json(
          { error: "Name charms take 1–5 letters." },
          { status: 400 },
        );
      }
      // The cord/keyring/strap choice has to reach the Stripe line, the order
      // detail page and the packing list, or the wrong finding gets shipped.
      const builderAttachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );

      // Every builder finding is free today, but honour the delta anyway —
      // otherwise adding a paid one to a builder product would give it away.
      unitPrice =
        bundle -
        (line.custom.with_charm ? 0 : BUILDER_NO_CHARM_DISCOUNT) +
        (builderAttachment?.price_delta ?? 0);

      // Taken from the collection we just looked up, never the client's copy.
      colour = collection.name;
      // Use the collection's stored name, not the client's copy of it.
      description = [
        collection.name,
        letters,
        line.custom.with_charm ? "with charm" : "letters only",
        builderAttachment?.label,
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      // Colour is free text on the wire; only a colour this product actually
      // comes in may reach the Stripe line description or the order record.
      const colours = product.colours ?? [];
      if (line.colour) {
        const match = colours.find((c) => c.name === line.colour);
        if (!match) {
          return NextResponse.json(
            { error: `“${product.short_name}” doesn't come in that colour.` },
            { status: 400 },
          );
        }
        colour = match.name;
      } else if (colours.length > 0) {
        colour = colours[0].name;
      }

      const attachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );
      unitPrice = product.price + (attachment?.price_delta ?? 0);

      let printed: string | null = null;
      if (line.personalisation_text) {
        printed = line.personalisation_text.trim();
        if (!printed || !PERSONALISATION_TEXT_PATTERN.test(printed)) {
          return NextResponse.json(
            {
              error:
                "Personalised text can use letters, numbers, spaces and - ' & . / only.",
            },
            { status: 400 },
          );
        }
      }

      description = [
        colour,
        attachment?.label,
        printed ? `“${printed}”` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }

    if (unitPrice < 0) {
      return NextResponse.json({ error: "Invalid price." }, { status: 400 });
    }

    subtotal += unitPrice * line.quantity;
    lineItems.push({
      price_data: {
        currency: "aud",
        unit_amount: unitPrice,
        product_data: {
          name: product.short_name,
          ...(description ? { description } : {}),
          // `short_name` is NOT unique in the schema — only `slug` and `sku`
          // are (supabase/migrations/0001_init.sql). The webhook's rebuild
          // path, used when the database was unreachable here and no order was
          // staged, has to map each Stripe line back to a product row, and
          // matching on the name silently linked the wrong row whenever two
          // products share a short name: wrong product_id, wrong artwork,
          // wrong thing printed and posted. The slug is the unique key, and
          // this is the only place it can be attached to a line so that Stripe
          // hands it back (metadata on the inline product survives the
          // `expand: ['data.price.product']` the webhook already does).
          metadata: { slug: product.slug },
        },
      },
      quantity: line.quantity,
    });

    summary.push({
      product_id: product.id,
      slug: product.slug,
      name: product.short_name,
      art: product.art,
      tint: product.tint,
      variant: description,
      colour,
      attachment_id: line.attachment_id ?? null,
      unit_price: unitPrice,
      quantity: line.quantity,
      personalisation:
        line.custom ??
        (line.personalisation_text
          ? { text: line.personalisation_text.trim() }
          : null),
    });
  }

  /* ------------------------------------------------------------ the scoops */

  for (const line of body.scoop_lines) {
    const tier = tiers.get(line.slug);

    // Not published. RLS is the first gate and it has already been applied —
    // an inactive or unpriced tier never entered the map — so an absence here
    // means the tier is a draft, was retired, or never existed. The 409 wording
    // matches the product branch above: same shape of problem, same answer.
    if (!tier) {
      return NextResponse.json(
        { error: `“${line.slug}” is no longer available.` },
        { status: 409 },
      );
    }

    /*
     * THE SELLABILITY GATE, and it has to be here rather than only on the
     * shopfront.
     *
     * RLS hides a draft; it knows nothing about whether the bowl is empty,
     * because that is a fact about `products.stock_on_hand` across the tier's
     * pool and it changes with every sale and every print. The tier page's
     * judgement was made when that page was rendered, which may have been ten
     * minutes and three other customers ago. This POST is the last moment
     * before money moves, so it is the only place the question can be asked
     * with an answer worth having.
     *
     * A scoop is the ONE product in this shop where an empty shelf must stop a
     * sale. Everything else is printed to order, so 0005_sale_integrity.sql
     * deliberately lets an oversell through and prints the backlog — a two-day
     * print is not a lost order. You cannot print a surprise on Tuesday to
     * satisfy Monday's order without deciding for the customer what they got,
     * and the pool exists precisely to stop the shop deciding that. So this
     * refuses, and it refuses BEFORE the Stripe session is created: the
     * alternative is a charged customer and a bowl with nothing in it, which
     * needs a person, a refund and an apology.
     *
     * `blockers` are written for the studio ("no packed weight"), so they are
     * logged and not shown. The customer gets a sentence about the thing they
     * were trying to buy.
     */
    if (!tier.availability.sellable) {
      console.warn(
        `Refused a scoop checkout for tier ${tier.slug}: ` +
          tier.availability.blockers.join("; "),
      );
      return NextResponse.json(
        {
          error:
            `“${tier.name}” has just sold out — there aren't enough pieces in ` +
            "the bowl to fill another one. Nothing has been charged.",
        },
        { status: 409 },
      );
    }

    /*
     * The price, recomputed from the tier row — never from the browser, exactly
     * as a product's is. `price_cents` is nullable in the column and in the
     * type, and both RLS and `availability.sellable` have already refused a
     * null, so this is unreachable. It is written anyway because the thing it
     * guards is a `0` reaching Stripe as a free scoop, and "unreachable" is a
     * claim about two other pieces of code staying as they are.
     */
    const price = tier.price_cents;
    if (price === null || price <= 0) {
      console.error(
        `Tier ${tier.slug} is sellable but has no usable price — refusing.`,
      );
      return NextResponse.json(
        { error: `“${tier.name}” is not on sale just now.` },
        { status: 409 },
      );
    }

    // The promise, and the only thing about the contents that is knowable now.
    const variant = scoopVariantLabel(tier.piece_count);
    const { art, tint } = scoopArt(tier.theme);

    subtotal += price * line.quantity;

    lineItems.push({
      price_data: {
        currency: "aud",
        unit_amount: price,
        product_data: {
          // The tier's name — what the customer chose and what every screen
          // that renders this order will print.
          name: tier.name,
          description: variant,
          // Carries the tier id, the piece count and the theme as well as the
          // slug, so the webhook's Stripe-rebuild path can write a scoop line
          // that is identical to the one staged below without looking anything
          // up — and, critically, without mistaking a tier slug for a product
          // slug and decrementing a charm. See SCOOP_METADATA.
          metadata: scoopLineMetadata(tier),
        },
      },
      quantity: line.quantity,
    });

    scoopSummary.push({
      tier_id: tier.id,
      name: tier.name,
      art,
      tint,
      variant,
      unit_price: price,
      quantity: line.quantity,
    });
  }

  /*
   * Postage, from Australia Post, priced on the *server's* copy of the basket.
   *
   * `quoteBasket()` is the single entry point and `POST /api/shipping/quote`
   * — what the cart calls — goes through the same function on the same
   * server-loaded rows, so the figure shown in the basket and the figure Stripe
   * charges come from one expression rather than two that agree by coincidence.
   *
   * It never throws and never returns zero for a non-empty basket: cache, then
   * the live carrier API, then a built-in table that needs no network and
   * deliberately returns the band above the one the basket falls in. A slow or
   * missing carrier makes postage dearer, never free, and never blocks a sale.
   *
   * Who pays it is a separate question, and deliberately so:
   * `isFreeShipping()` is the shop's own promotion over the subtotal, while
   * `quoteBasket()` is what the post office wants. Waiving the charge must not
   * change what was quoted — the provenance columns staged below record the
   * real weight and service even on a free-postage order, which is the only way
   * to reconcile a carrier bill later.
   */
  const quote = await quoteBasket(
    [
      ...toShippingLines(body.lines, products),
      /*
       * A scoop has no product row and so no weight of its own. The TIER
       * carries a worst-case packed weight, and `toScoopShippingLines` — the
       * same builder `POST /api/shipping/quote` uses, so the cart's figure and
       * this one cannot come from two expressions — turns it into a line
       * `quoteBasket()` weighs alongside the charms.
       *
       * It also makes the whole basket a parcel. `scoop_tiers` deliberately has
       * no `letter_eligible` column (0007), and `selectPackaging` rule 1 is
       * "every line", so one scoop is enough. That is the intended answer: a
       * Large Letter is untracked and uninsured, and a scoop that goes missing
       * cannot be reprinted, because what was in it came out of a bowl.
       */
      ...toScoopShippingLines(body.scoop_lines, tiers),
    ],
    body.shipping_method,
  );
  const shipping = isFreeShipping(subtotal, body.shipping_method)
    ? 0
    : quote.amountCents;
  const method = SHIPPING.methods.find((m) => m.id === body.shipping_method)!;

  const user = await getUser().catch(() => null);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      customer_email: user?.email ?? body.email,
      success_url: `${siteUrl()}/order/confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/cart?cancelled=1`,
      // Deliberately off: orders store subtotal/shipping/total with no
      // discount column, so a promo code would leave those three inconsistent.
      // Add a `discount` column and reconcile in the webhook before enabling.
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["AU"] },
      phone_number_collection: { enabled: true },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shipping, currency: "aud" },
            display_name:
              shipping === 0 ? `${method.label} (free)` : method.label,
            // Printing happens before the carrier ever sees it, so the
            // estimate Stripe shows is print lead time + transit. Derived so
            // editing lib/config.ts can't silently desync this quote.
            delivery_estimate: {
              minimum: {
                unit: "business_day",
                value: PRINT_LEAD_TIME.minDays + transitDays(body.shipping_method)[0],
              },
              maximum: {
                unit: "business_day",
                value: PRINT_LEAD_TIME.maxDays + transitDays(body.shipping_method)[1],
              },
            },
          },
        },
      ],
      // Stripe caps each metadata value at 500 characters, so the basket is
      // persisted to our own database below rather than carried here.
      metadata: {
        user_id: user?.id ?? "",
        shipping_method: body.shipping_method,
        subtotal: String(subtotal),
        shipping: String(shipping),
        // Small enough for Stripe's 500-char cap, and the one piece of the
        // basket the webhook cannot rebuild from line items.
        gift_note: (body.gift_note ?? "").slice(0, 450),
        // "slug:qty,slug:qty" — the only way the webhook's rebuild path can
        // find products to decrement. Personalised lines are omitted: they
        // hold no ready-to-ship stock.
        //
        // Scoops cannot appear here at all, and that is structural rather than
        // filtered: `stockMap` takes `SummaryLine[]`, scoops live in
        // `scoopSummary`, and the compiler will not let one be passed for the
        // other. It matters more than it looks. A tier slug in this map would
        // be looked up in `products` by the webhook, and `scoop_tiers.slug` and
        // `products.slug` are separate unique indexes — a tier and a charm may
        // share a string. A scoop's stock does not move here in any case: it
        // moves in the studio, one decrement per piece, when the pack is
        // recorded (0007_lucky_scoop.sql).
        stock: stockMap(summary),
      },
    });

    const staged = await savePendingOrder({
      sessionId: session.id,
      userId: user?.id ?? null,
      email: user?.email ?? body.email ?? "",
      subtotal,
      shipping,
      shippingMethod: body.shipping_method,
      giftNote: body.gift_note ?? null,
      items: summary,
      scoopItems: scoopSummary,
      quoteSource: quote.source,
      quotedWeightGrams: quote.weightGrams,
      // Empty only for an empty basket, which cannot reach here — checkout
      // requires at least one line. Stored as null rather than "" so a reader
      // cannot mistake a missing service for a real one.
      quotedServiceCode: quote.serviceCode || null,
    });

    if (!staged.ok) {
      // Better to lose a checkout than to take money for an order we have no
      // record of and cannot print. Expiring the session makes the URL dead.
      await stripe.checkout.sessions
        .expire(session.id)
        .catch((error) => console.error("Could not expire session:", error));

      return NextResponse.json(
        {
          error:
            "We couldn't start your order just now. Nothing has been charged — please try again in a moment.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ url: session.url, id: session.id });
  } catch (error) {
    console.error("Stripe checkout failed:", error);
    return NextResponse.json(
      { error: "Could not start checkout. Please try again." },
      { status: 502 },
    );
  }
}
