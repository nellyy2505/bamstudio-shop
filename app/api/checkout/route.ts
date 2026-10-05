import { NextResponse } from "next/server";
import { z } from "zod";
import { getStripe, siteUrl } from "@/lib/stripe";
import { createAdminClient, getUser } from "@/lib/supabase/server";
import {
  getBakeryColours,
  getBakeryDesigns,
  getBakeryFillings,
  getCollections,
  isDatabaseConfigured,
  loadFillingProductsBySlug,
  loadProductsBySlug,
  loadScoopTiersBySlug,
} from "@/lib/queries";
import {
  BASKET_LIMITS,
  PERSONALISATION_TEXT_MAX,
  PERSONALISATION_TEXT_PATTERN,
  PRINT_LEAD_TIME,
  SHIPPING,
  shippingCharge,
  transitDays,
} from "@/lib/config";
import { BUILDER_UNITS_HARD_MAX } from "@/lib/pricing/builder-fallback";
import {
  charmPrice as charmPriceFor,
  getCharmDiscountCents,
  getLadder,
  maxUnits,
  priceFor,
} from "@/lib/pricing/builder";
import { clientKey, rateLimitDurable } from "@/lib/rate-limit";
import { toShippingLines } from "@/lib/shipping/lines";
// The studio's own costing, reused rather than re-implemented: one definition
// of what a piece costs, whether the sale came from the website or from a
// market stall. It lives in lib/ and not in app/admin/data.ts, which is where
// this route used to import it from: a customer-facing endpoint should not put
// the staff area on its import graph to find out what a piece cost. Nor can it
// live in app/admin/actions.ts - every export from a "use server" file becomes
// a callable HTTP endpoint.
import { unitCostsAtSale } from "@/lib/cost-basis";
import {
  scoopArt,
  scoopLineMetadata,
  scoopVariantLabel,
  toScoopShippingLines,
} from "@/lib/scoop-line";
import {
  costOfFillings,
  describeProblem,
  describeSelection,
  validateSelection,
  type BakerySelection,
} from "@/lib/bakery";
import { quoteBasket } from "@/lib/shipping/quote";
import type { Product } from "@/lib/types";

export const runtime = "nodejs";

const LineSchema = z.object({
  product_id: z.string().min(1).max(64),
  slug: z.string().min(1).max(120),
  colour: z.string().max(60).nullable().optional(),
  attachment_id: z.string().max(60).nullable().optional(),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
  /** "text" mode personalisation - one printed line, e.g. a pet's name. */
  personalisation_text: z.string().max(PERSONALISATION_TEXT_MAX).optional(),
  /**
   * A bakery box: the design, the colour and the pieces that go in it.
   *
   * The array bound is a rail on payload size, not the rule. How many pieces a
   * box holds is `products.bakery_piece_count` on the row being bought, which a
   * module-scope schema cannot await; the real count is checked below by
   * `validateSelection`, which is also where a withdrawn design or filling is
   * refused.
   */
  bakery: z
    .object({
      design: z.string().min(1).max(60),
      colour_id: z.string().min(1).max(64),
      fillings: z.array(z.string().min(1).max(80)).min(1).max(12),
    })
    .optional(),
  custom: z
    .object({
      collection_slug: z.string().min(1).max(60),
      // Kept only for older clients; the server uses the stored name.
      collection_name: z.string().min(1).max(60),
      /*
       * A RAIL, NOT THE RULE. The most letters this builder actually sells is
       * the top rung of a ladder in the database, and a zod schema built at
       * module scope cannot await it. So this bounds the size of a parsed
       * payload - a request claiming eight hundred letters is refused before
       * anything counts them - and the real limit is applied below, against the
       * ladder, where a price for that many letters either exists or does not.
       */
      letters: z
        .string()
        .min(1)
        .max(BUILDER_UNITS_HARD_MAX)
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
 * colour, a finding or personalisation - a scoop has none of those, and a field
 * that accepted one would invite a caller to think it might.
 *
 * Separate from `LineSchema` rather than folded into it. `scoop_tiers.slug` and
 * `products.slug` are separate unique indexes on separate tables, so the same
 * string may exist in both; one array of bare slugs would leave this route
 * deciding which table a line meant, and deciding wrong charges a tier's price
 * for a charm - or worse, decrements a charm for a tier.
 */
const ScoopLineSchema = z.object({
  slug: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(BASKET_LIMITS.maxLineQuantity),
});

const BodySchema = z
  .object({
    // Both caps come from lib/config.ts. They used to be literals here and in
    // /api/shipping/quote, with a third transcription in the cart, and nothing
    // held the three copies together - a basket the client would build and this
    // schema would refuse comes back as a blanket "Invalid basket." naming no
    // line. One definition, imported by every surface that has to respect it.
    //
    // `min(1)` has moved off this array onto the refinement below, because a
    // basket of nothing but scoops has no product lines at all. The refinement
    // preserves both halves of what `min(1).max(maxLines)` said - a body with
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
  /**
   * The product ids of a bakery box's contents, one per piece, duplicates
   * included.
   *
   * Carried separately from `personalisation` (which holds slugs, because that
   * is what a packing slip and a customer can read) so the staging step can
   * cost the box from four measured pieces instead of from the empty container,
   * and so the webhook knows which shelves to take them off.
   */
  filling_product_ids?: string[];
};

/**
 * A priced scoop line, ready to be staged.
 *
 * A SEPARATE ARRAY FROM `SummaryLine[]`, AND THAT IS THE POINT. Two things in
 * this file walk the product summary and must never see a scoop:
 * `stockMap()`, which builds the `slug:qty` map the webhook's rebuild path
 * decrements from, and `unitCostsAtSale()`, which looks a product's making cost
 * up by id. A scoop has no shelf to come off and no recipe to cost, so both
 * would be wrong for it - `stockMap` catastrophically so, since the slug it
 * would emit could match a real product and take that product off the shelf.
 *
 * Keeping the two lists apart makes that structural. A filter would work today
 * and would be one forgotten `if` away from not working; a type that cannot be
 * passed to either function cannot be forgotten.
 *
 * Note the fields that are absent rather than nulled: no `colour`, no
 * `attachment_id`, no `personalisation`. And note `unit_cost_cents` is nowhere
 * here at all - it is written as NULL at the insert, and the studio stamps the
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
 * sliced - a cut mid-entry would hand the webhook a truncated slug and
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
        `Stock metadata full, ${item.slug} omitted; its stock will not move ` +
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
   * carrier - these three are what makes that reconcilable, and what makes a
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
    // exactly one place - the market-stall form in app/admin/actions.ts - so
    // every website sale landed with a null making cost and /admin/reports had
    // nothing to subtract for the online channel.
    //
    // Stamped here, as the basket is recorded, and never derived at read time:
    // the column exists to say what the piece cost WHEN IT SOLD, and computing
    // it later would rewrite every historical margin the next time filament or
    // electricity changed price. Minutes separate this from the payment, and
    // the alternative - waiting for the webhook - would leave the ordinary,
    // staged path with no cost at all.
    //
    // Never blocks a sale. A cost that cannot be worked out is a null, which
    // reports already handle honestly; a checkout that fails because the
    // costing tables were unreadable would be a far worse trade.
    let costs = new Map<string, number | null>();
    try {
      /*
       * The box products AND everything inside them. A bakery box's own product
       * row is an empty container: costing a line from it alone would report the
       * lid and none of the four pieces, which on a flat-priced box is exactly
       * the number that would hide the problem flat pricing creates.
       */
      costs = await unitCostsAtSale([
        ...input.items.map((item) => item.product_id),
        ...input.items.flatMap((item) => item.filling_product_ids ?? []),
      ]);
    } catch (error) {
      console.error("Could not cost the basket; lines keep a null cost:", error);
    }

    /**
     * What one of these lines cost to make.
     *
     * For a bakery box: the container plus its contents, and null the moment
     * any one piece has never been measured. Null rather than a partial sum for
     * the reason `unitCostsAtSale` returns null for an unmeasured product - a
     * box costed from three of its four pieces is a flattering number that
     * looks like a real one, and the reports already know how to say "some of
     * these carry no cost" but cannot know a number is short.
     */
    const lineCost = (item: (typeof input.items)[number]): number | null => {
      const box = costs.get(item.product_id) ?? null;
      if (!item.filling_product_ids || item.filling_product_ids.length === 0) {
        return box;
      }
      const contents = costOfFillings(
        item.filling_product_ids,
        new Map(item.filling_product_ids.map((id) => [id, costs.get(id) ?? null])),
      );
      if (contents === null) return null;
      // A container nobody has measured makes the whole box unmeasured, the
      // same as an unmeasured piece would.
      return box === null ? null : box + contents;
    };

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
        // Null for a product nobody has measured - an honest gap the reports
        // count and say out loud, rather than a zero that reads as 100% margin.
        unit_cost_cents: lineCost(item),
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
       *    with a tier id - it could only answer for a product.
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
 * Prices are recomputed here from the database - the client only says WHICH
 * product and how many. A tampered basket cannot change what is charged.
 */
export async function POST(request: Request) {
  // This route writes order rows with the service-role key, so an unthrottled
  // loop could fill the table. Real shoppers check out a handful of times.
  //
  // `rateLimitDurable`, not `rateLimit`: a deploy or a restart used to hand the
  // loop a clean allowance, and this is the endpoint where that costs rows in
  // the orders table rather than a wasted query. `await` is the whole
  // difference and dropping it is not a lint error here - the config carries no
  // type-aware `no-misused-promises`, so `limit.ok` would read `undefined`,
  // `!limit.ok` would be true, and every checkout in the shop would answer 429.
  // The store call is bounded at 500ms with a circuit breaker and falls back to
  // the in-process bucket, so a bad minute at Upstash cannot stop the shop
  // taking money (lib/rate-limit.ts).
  const limit = await rateLimitDurable(clientKey(request, "checkout"), 10, 60_000);
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
    console.error("SUPABASE_SERVICE_ROLE_KEY is missing, refusing checkout.");
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  // (b) The mirror of (a): live Stripe, no database at all. savePendingOrder()
  // returns ok early when the database is unconfigured, so nothing downstream
  // catches this - the charge succeeds, no order row is ever written, and
  // /order/confirmed still tells the customer their order is confirmed. Money
  // taken, nothing to print, nothing to track.
  //
  // The NODE_ENV check is deliberate and load-bearing. DO NOT "tidy" it away
  // into an unconditional guard - that has already been done, and re-fixed,
  // twice (WORKLOG §5 rounds 3 and 4), and round 4's rule is the constraint: a
  // guard may reject a query *error*, never the *absence* of a database.
  // Running with no database at all is an intended mode (CLAUDE.md), and it is
  // exactly what the only verification flow this project has depends on: a
  // dummy Stripe key, no Supabase env, and the real CartView payloads replayed
  // against this route (scripts/replay-checkout.mjs), where 502 - reached
  // Stripe - is the pass. An unconditional guard turns every one of those
  // cases into a 503 that never reaches the validation being tested, and three
  // previous regressions were caught only by that replay. Outside production
  // the key in use is a test key and no real money can move, so the trade is
  // one-sided: guard where the charge is real, stay out of the way where it
  // is not.
  if (process.env.NODE_ENV === "production" && !isDatabaseConfigured()) {
    console.error(
      "Supabase is not configured in production, refusing checkout: a real " +
        "charge would leave no order record and nothing to print.",
    );
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  const [products, tiers] = await Promise.all([
    loadProductsBySlug(body.lines.map((l) => l.slug)),
    // Read through RLS on purpose - see loadScoopTiersBySlug. A draft or
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

  /*
   * The charm a builder line asked for, priced from its own product row.
   *
   * Loaded here and not with the lines above because which product it is comes
   * from the *collection*, which is only known once the colourways are in hand.
   * The client sends `with_charm: true` and nothing else - it never names the
   * charm and never names a price, so the worst a tampered basket can do is ask
   * for a charm on a colourway that has none, which is refused below.
   */
  const charmSlugs = new Set<string>();
  for (const line of body.lines) {
    if (!line.custom?.with_charm) continue;
    const slug = collections.get(line.custom.collection_slug)?.charm_slug;
    if (slug) charmSlugs.add(slug);
  }
  const charmProducts = charmSlugs.size
    ? await loadProductsBySlug([...charmSlugs])
    : new Map<string, Product>();

  /*
   * The letter ladder and the charm discount, read once per request rather than
   * per line, and read HERE rather than imported.
   *
   * This is the moment that matters: a price the customer was shown a minute
   * ago is a claim, and this is where the shop decides what it actually
   * charges. Reading it now means a price the owner changed while somebody had
   * the builder open is applied at checkout, and it means a basket cannot be
   * charged from a constant that was compiled into the bundle at deploy time.
   */
  const [letterLadder, charmDiscount] = await Promise.all([
    getLadder("letter_caps"),
    getCharmDiscountCents(),
  ]);

  /*
   * The bakery reference data, and only when a box is actually in the basket.
   *
   * Read HERE, at the moment of charging, and never taken from the request: a
   * design withdrawn or a filling deactivated while somebody had the builder
   * open has to fail now, because this is the last point before money moves.
   * The fillings map is slug to product, so a box can be costed and its stock
   * moved from rows this server looked up rather than names a client sent.
   */
  const wantsBakery = body.lines.some((line) => line.bakery);
  const [boxLadder, bakeryDesigns, bakeryColours, bakeryFillings] = wantsBakery
    ? await Promise.all([
        getLadder("bakery_box"),
        getBakeryDesigns(),
        getBakeryColours(),
        getBakeryFillings(),
      ])
    : [null, [], [], []];

  const designSlugs = new Set(bakeryDesigns.map((d) => d.slug));
  const colourIds = new Set(bakeryColours.map((c) => c.id));
  const fillingSlugs = new Set(bakeryFillings.map((f) => f.slug));
  const fillingProducts = wantsBakery
    ? await loadFillingProductsBySlug([...fillingSlugs])
    : new Map<string, Product>();

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
        // product's - the two live in different tables and can be the same
        // string - so the index signature is what carries them without every
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
    let bakerySelection: BakerySelection | null = null;
    let fillingProductIds: string[] | undefined;

    // A `custom` block carries builder bundle pricing, so it must only ever
    // reach a builder product - otherwise an $18 item could be bought for $3.
    if (line.custom && product.personalisation_mode !== "builder") {
      return NextResponse.json(
        { error: `“${product.short_name}” is not built in the designer.` },
        { status: 400 },
      );
    }
    /*
     * The same guard the builder line has, for the same reason: a `bakery` block
     * carries box pricing, so it must only ever reach a bakery product, or a $15
     * box could be bought at the price of whatever else was pointed at. And the
     * converse, which the builder does not need because a name with no letters
     * cannot be added: an empty box IS a coherent request and must be refused,
     * or somebody buys a container for the price of a filled one.
     */
    if (line.bakery && product.personalisation_mode !== "bakery") {
      return NextResponse.json(
        { error: `“${product.short_name}” is not a bakery box.` },
        { status: 400 },
      );
    }
    if (!line.bakery && product.personalisation_mode === "bakery") {
      return NextResponse.json(
        { error: `“${product.short_name}” has to be filled before you can buy it.` },
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

      /*
       * The price for this many letters, from the database, at the moment of
       * charging. No rung means no price, and no price means no sale: a length
       * the ladder does not cover is refused rather than guessed at, because
       * the only ways to guess are to extrapolate the step (inventing a price
       * the owner never set) or to fall through to zero (giving it away).
       *
       * The message names the ladder's real bounds rather than a hardcoded
       * "1-5", which is what it used to say and would have been wrong the first
       * time she added a sixth rung.
       */
      const bundle = priceFor(letterLadder, letters.length);
      if (!bundle) {
        const top = maxUnits(letterLadder);
        return NextResponse.json(
          {
            error:
              top > 0
                ? `Name charms take 1 to ${top} letters.`
                : "Name charms are not on sale at the moment.",
          },
          { status: 400 },
        );
      }
      // The cord/keyring/strap choice has to reach the Stripe line, the order
      // detail page and the packing list, or the wrong finding gets shipped.
      const builderAttachment = (product.attachments ?? []).find(
        (a) => a.id === line.attachment_id,
      );

      /*
       * Caps, plus the charm if one was asked for, plus the finding.
       *
       * The charm's price comes from its own product row less the studio's
       * discount, read here rather than imported - never from the client, and
       * never from a copy stored on the collection. A charm asked for on a colourway that
       * has none, or whose product has since been retired, is refused: adding
       * nothing would hand over a charm for free, and the packing list would
       * still say to include one.
       */
      let charmPrice = 0;
      if (line.custom.with_charm) {
        const charm = collection.charm_slug
          ? charmProducts.get(collection.charm_slug)
          : undefined;
        if (!charm) {
          return NextResponse.json(
            {
              error: `The ${collection.name} charm is no longer available. Remove it and try again.`,
            },
            { status: 409 },
          );
        }
        charmPrice = charmPriceFor(charm.price, charmDiscount);
      }

      // Every builder finding is free today, but honour the delta anyway -
      // otherwise adding a paid one to a builder product would give it away.
      unitPrice = bundle + charmPrice + (builderAttachment?.price_delta ?? 0);

      // Taken from the collection we just looked up, never the client's copy.
      colour = collection.name;
      // Use the collection's stored name, not the client's copy of it.
      description = [
        collection.name,
        letters,
        line.custom.with_charm
          ? `with ${collection.charm_name} charm`
          : "letters only",
        builderAttachment?.label,
      ]
        .filter(Boolean)
        .join(" · ");
    } else if (line.bakery) {
      /*
       * A BOX IS PRICED BY ITS SIZE, NOT ITS CONTENTS. The rung is looked up by
       * `products.bakery_piece_count`, and the fillings do not move it, which is
       * the owner's decision. The consequence is written down in lib/bakery.ts:
       * the studio carries the difference between a cheap box and a dear one,
       * so `unit_cost_cents` below is stamped from the four real pieces and not
       * from the empty container, or the gap would never show up in a report.
       */
      const pieceCount = product.bakery_piece_count ?? 0;
      const boxPrice = boxLadder ? priceFor(boxLadder, pieceCount) : null;

      const selection: BakerySelection = {
        kind: "bakery",
        design: line.bakery.design,
        colour_id: line.bakery.colour_id,
        fillings: line.bakery.fillings,
      };

      const problems = validateSelection(
        selection,
        { slug: product.slug, pieceCount },
        { designSlugs, colourIds, fillingSlugs, priceCents: boxPrice },
      );
      if (problems.length > 0) {
        return NextResponse.json(
          { error: describeProblem(problems[0]) },
          // 409 rather than 400: the commonest cause is something withdrawn
          // between building the box and paying for it, which is a conflict
          // with the shop's current state and not a malformed request.
          { status: 409 },
        );
      }

      unitPrice = boxPrice as number;

      const design = bakeryDesigns.find((d) => d.slug === selection.design);
      const boxColour = bakeryColours.find((c) => c.id === selection.colour_id);
      const nameBySlug = new Map(bakeryFillings.map((f) => [f.slug, f.short_name || f.name]));

      colour = boxColour?.name ?? null;
      description = describeSelection(selection, {
        design: design?.name ?? "Box",
        colour: boxColour?.name ?? "",
        fillingNames: selection.fillings.map((s) => nameBySlug.get(s) ?? s),
      });

      bakerySelection = selection;
      // Ids, not slugs: what the cost read and the stock decrement both key on.
      // A filling whose product row went missing between the pool read and here
      // is dropped rather than faked, and `costOfFillings` then answers null
      // because the map has no cost for it.
      fillingProductIds = selection.fillings.flatMap((slug) => {
        const row = fillingProducts.get(slug);
        return row ? [row.id] : [];
      });
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
      // An attachment this product is not sold with would be charged at the
      // base price and then packed as something nobody paid for.
      if (line.attachment_id && !attachment) {
        return NextResponse.json(
          { error: `“${product.short_name}” doesn't come with that attachment.` },
          { status: 400 },
        );
      }
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
          // `short_name` is NOT unique in the schema - only `slug` and `sku`
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
        bakerySelection ??
        line.custom ??
        (line.personalisation_text
          ? { text: line.personalisation_text.trim() }
          : null),
      ...(fillingProductIds ? { filling_product_ids: fillingProductIds } : {}),
    });
  }

  /* ------------------------------------------------------------ the scoops */

  for (const line of body.scoop_lines) {
    const tier = tiers.get(line.slug);

    // Not published. RLS is the first gate and it has already been applied -
    // an inactive or unpriced tier never entered the map - so an absence here
    // means the tier is a draft, was retired, or never existed. The 409 wording
    // matches the product branch above: same shape of problem, same answer.
    if (!tier) {
      return NextResponse.json(
        { error: `“${line.slug}” is no longer available.` },
        { status: 409 },
      );
    }

    /*
     * IS IT FOR SALE AT ALL - switched on, and priced. Nothing else.
     *
     * THERE WAS A STOCK GATE HERE AND IT WAS WRONG. It refused the sale when
     * the tier's pool could not fill a scoop off the shelf, on the reasoning
     * that a scoop promises pieces that exist now. It does not: THE SHOP PRINTS
     * TO ORDER. She scoops from the bowl, and if the bowl is short she prints
     * the rest before packing - exactly what `decrement_stock` assumes for
     * every other line on this order when it returns a shortfall and keeps
     * selling (0005_sale_integrity.sql). The gate's only possible effect was to
     * take a paid product off the shop because a shelf count dipped. Do not put
     * it back; `lib/scoop.ts` records the correction in full.
     *
     * What remains is the same pair of questions the product branch above asks:
     * does this exist (`!tier`, handled just above), and is it on sale. RLS is
     * the first gate and has already refused a draft or unpriced tier to the
     * anon key; this is the second, so that the answer does not depend on one
     * policy staying exactly as it is.
     *
     * `blockers` are written for the studio ("not active"), so they are logged
     * and not shown. The customer gets a sentence about the thing they were
     * trying to buy - and no "sold out", which is now never the reason.
     */
    if (!tier.availability.sellable) {
      console.warn(
        `Refused a scoop checkout for tier ${tier.slug}: ` +
          tier.availability.blockers.join("; "),
      );
      return NextResponse.json(
        {
          error:
            `“${tier.name}” isn't on sale just now. Nothing has been charged.`,
        },
        { status: 409 },
      );
    }

    /*
     * The price, recomputed from the tier row - never from the browser, exactly
     * as a product's is. `price_cents` is nullable in the column and in the
     * type, and both RLS and `availability.sellable` have already refused a
     * null, so this is unreachable. It is written anyway because the thing it
     * guards is a `0` reaching Stripe as a free scoop, and "unreachable" is a
     * claim about two other pieces of code staying as they are.
     */
    const price = tier.price_cents;
    if (price === null || price <= 0) {
      console.error(
        `Tier ${tier.slug} is sellable but has no usable price, refusing.`,
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
          // The tier's name - what the customer chose and what every screen
          // that renders this order will print.
          name: tier.name,
          description: variant,
          // Carries the tier id, the piece count and the theme as well as the
          // slug, so the webhook's Stripe-rebuild path can write a scoop line
          // that is identical to the one staged below without looking anything
          // up - and, critically, without mistaking a tier slug for a product
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
   * - what the cart calls - goes through the same function on the same
   * server-loaded rows, so the figure shown in the basket and the figure Stripe
   * charges come from one expression rather than two that agree by coincidence.
   *
   * It never throws and never returns zero for a non-empty basket: cache, then
   * the live carrier API, then a built-in table that needs no network and
   * deliberately returns the band above the one the basket falls in. A slow or
   * missing carrier makes postage dearer, never free, and never blocks a sale.
   *
   * Who pays it is a separate question, and deliberately so:
   * `shippingCharge()` is the shop's own promotion over the subtotal, while
   * `quoteBasket()` is what the post office wants. Waiving or halving the
   * charge must not change what was quoted - the provenance columns staged
   * below record the real weight and service even on a free-postage order,
   * which is the only way to reconcile a carrier bill later. On a half-paid
   * order that reconciliation matters more, not less: the studio is now paying
   * part of a bill it never sees on the order row.
   */
  const quote = await quoteBasket(
    [
      ...toShippingLines(body.lines, products),
      /*
       * A scoop has no product row and so no weight of its own. The TIER
       * carries a worst-case packed weight, and `toScoopShippingLines` - the
       * same builder `POST /api/shipping/quote` uses, so the cart's figure and
       * this one cannot come from two expressions - turns it into a line
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
  // Australia Post will not carry a domestic parcel over 22 kg, and the
  // fallback table would price one as if it could. Ask the customer to get in
  // touch instead of charging postage that cannot cover the delivery.
  if (quote.weightGrams > 22_000) {
    return NextResponse.json(
      {
        error:
          "That's too heavy for one parcel. Please split it into smaller orders or contact us.",
      },
      { status: 409 },
    );
  }

  const shipping = shippingCharge(
    quote.amountCents,
    subtotal,
    body.shipping_method,
  );
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
        // "slug:qty,slug:qty" - the only way the webhook's rebuild path can
        // find products to decrement. Personalised lines are omitted: they
        // hold no ready-to-ship stock.
        //
        // Scoops cannot appear here at all, and that is structural rather than
        // filtered: `stockMap` takes `SummaryLine[]`, scoops live in
        // `scoopSummary`, and the compiler will not let one be passed for the
        // other. It matters more than it looks. A tier slug in this map would
        // be looked up in `products` by the webhook, and `scoop_tiers.slug` and
        // `products.slug` are separate unique indexes - a tier and a charm may
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
      // Empty only for an empty basket, which cannot reach here - checkout
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
            "We couldn't start your order just now. Nothing has been charged, please try again in a moment.",
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
