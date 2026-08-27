/**
 * Behavioural harness for the money path: `app/api/webhooks/stripe/route.ts`
 * and the scoop half of `app/api/checkout/route.ts`.
 *
 *   node scripts/check-webhook.mjs
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS IN THE REPO
 *
 * There was a 43-scenario harness for this route. It lived in `/tmp` and it was
 * lost with the session that wrote it, and WORKLOG.md has said ever since that
 * it must be rebuilt BEFORE the webhook's payload changes again. Lucky Scoop
 * changes the payload — a line with no product row, which must be written to
 * `order_items` with a tier id and must be kept out of stock claiming — so this
 * is that rebuild, and it is in `scripts/` rather than in `/tmp` so the next
 * change to this route starts with something to run.
 *
 * It is smaller than 43 scenarios and does not pretend otherwise: it covers the
 * paths this change touches plus the invariants that change is most likely to
 * break. What it does NOT cover is listed at the bottom.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT RUNS AGAINST
 *
 * The REAL route modules, loaded through jiti so the TypeScript and the `@/`
 * aliases resolve exactly as Next resolves them. Only the four edges are faked:
 * Supabase, Stripe, the mail provider and the costing tables. Nothing in the
 * routes is copied, re-implemented or stubbed — a test that asserts against a
 * copy of the code is a test that passes after the original is broken.
 */

import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = path.join(ROOT, "scripts", "webhook-harness");

// The webhook refuses to run without a signing secret, and checkout refuses to
// take money with no service-role key. Both guards are real and both are being
// satisfied rather than bypassed.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test";
process.env.STRIPE_SECRET_KEY = "sk_test";
process.env.NEXT_PUBLIC_SITE_URL = "https://bamstudio.test";
// No AUSPOST_API_KEY: quoteBasket() falls through to its built-in table, which
// needs no network. That is the deliberately pessimistic path, and it is the
// one a test run should take.

const jiti = createJiti(import.meta.url, {
  alias: {
    "@/lib/supabase/server": path.join(HARNESS, "fake-supabase.mjs"),
    "@/lib/stripe": path.join(HARNESS, "fake-stripe.mjs"),
    "@/lib/email": path.join(HARNESS, "fake-email.mjs"),
    "@/lib/cost-basis": path.join(HARNESS, "fake-cost-basis.mjs"),
    "@/lib/queries": path.join(HARNESS, "fake-queries.mjs"),
    "@": ROOT,
  },
  interopDefault: true,
});

const supabase = await jiti.import(path.join(HARNESS, "fake-supabase.mjs"));
const stripe = await jiti.import(path.join(HARNESS, "fake-stripe.mjs"));
const email = await jiti.import(path.join(HARNESS, "fake-email.mjs"));
const costBasis = await jiti.import(path.join(HARNESS, "fake-cost-basis.mjs"));
const queries = await jiti.import(path.join(HARNESS, "fake-queries.mjs"));

const webhook = await jiti.import(
  path.join(ROOT, "app/api/webhooks/stripe/route.ts"),
);
const checkout = await jiti.import(path.join(ROOT, "app/api/checkout/route.ts"));

/* ------------------------------------------------------------- assertions */

let passed = 0;
const failures = [];
let scenario = "";

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
    return;
  }
  failures.push(`${scenario} — ${label}${detail ? `\n         ${detail}` : ""}`);
  console.log(`  FAIL ${label}${detail ? `  (${detail})` : ""}`);
}

function begin(name) {
  scenario = name;
  console.log(`\n${name}`);
  supabase.resetStore();
  stripe.resetStripe();
  email.resetEmail();
  costBasis.resetCostBasis();
  queries.resetQueries();
}

/* ---------------------------------------------------------------- fixtures */

const TIER = {
  id: "tier-pet-5",
  slug: "pet-scoop",
  name: "Pet scoop",
  blurb: "",
  theme: "pet",
  piece_count: 5,
  price_cents: 2500,
  packed_weight_grams: 90,
  packed_thickness_mm: 30,
  sort_order: 0,
  active: true,
  created_at: "2026-08-01T00:00:00Z",
  pool: [],
  availability: {
    poolSize: 12,
    drawable: 9,
    scoopsAvailable: 3,
    sellable: true,
    blockers: [],
  },
};

const PRODUCT = {
  id: costBasis.MEASURED_PRODUCT_ID,
  slug: "clicker-macaron",
  sku: "BS-001",
  name: "Macaron clicker",
  short_name: "Macaron clicker",
  category: "Clicker keychain",
  theme: "food",
  description: "",
  price: 900,
  art: "macaron",
  tint: "blush",
  gallery: [],
  colours: [],
  attachments: [],
  details: [],
  rating: 5,
  review_count: 1,
  stock_on_hand: 10,
  is_bestseller: false,
  is_new: false,
  is_personalised: false,
  personalisation_mode: null,
  personalisation_label: null,
  weight_grams: 25,
  length_mm: 60,
  width_mm: 60,
  thickness_mm: 22,
  letter_eligible: false,
  active: true,
};

/** Stages a paid-for-but-unconfirmed order, as checkout would have. */
function stageOrder(sessionId, items) {
  const order = {
    id: `order-${sessionId}`,
    user_id: null,
    email: "shopper@example.test",
    status: "pending",
    subtotal: items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0),
    shipping: 1020,
    total: 0,
    shipping_method: "standard",
    gift_note: null,
    shipping_address: {},
    stripe_session_id: sessionId,
    stock_applied: false,
    order_number: null,
    confirmation_email_sent_at: null,
  };
  order.total = order.subtotal + order.shipping;
  supabase.store.tables.orders.push(order);
  for (const item of items) {
    supabase.store.tables.order_items.push({
      id: `item-${supabase.store.tables.order_items.length + 1}`,
      order_id: order.id,
      colour: null,
      attachment_id: null,
      personalisation: null,
      unit_cost_cents: null,
      product_id: null,
      scoop_tier_id: null,
      ...item,
    });
  }
  return order;
}

const PRODUCT_ITEM = {
  product_id: PRODUCT.id,
  product_name: "Macaron clicker",
  variant_label: "Blush",
  art: "macaron",
  tint: "blush",
  unit_price: 900,
  quantity: 2,
  unit_cost_cents: costBasis.MEASURED_COST_CENTS,
};

const SCOOP_ITEM = {
  scoop_tier_id: TIER.id,
  product_name: "Pet scoop",
  variant_label: "5 pieces",
  art: "corgi",
  tint: "butter",
  unit_price: 2500,
  quantity: 1,
  unit_cost_cents: null,
};

function completedEvent(sessionId, extra = {}) {
  return {
    id: `evt_${sessionId}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        amount_total: 5320,
        amount_subtotal: 4300,
        payment_intent: "pi_test",
        customer_details: { email: "shopper@example.test", name: "A Shopper" },
        collected_information: {
          shipping_details: {
            name: "A Shopper",
            address: {
              line1: "1 Test St",
              city: "Sydney",
              state: "NSW",
              postal_code: "2000",
            },
          },
        },
        metadata: { shipping_method: "standard", stock: "", ...extra },
      },
    },
  };
}

async function deliver(event) {
  const request = new Request("https://bamstudio.test/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "t=1,v1=fake" },
    body: JSON.stringify(event),
  });
  const response = await webhook.POST(request);
  // `after()` throws outside a request scope, so the route falls back to firing
  // the confirmation task detached. Yield so it lands before we assert on it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return response;
}

function decrementsFor() {
  return supabase.store.rpc.filter((call) => call.name === "decrement_stock");
}

function itemsOf(orderId) {
  return supabase.store.tables.order_items.filter((i) => i.order_id === orderId);
}

/* ============================================================== scenarios */

/*
 * 1. An ordinary product order, staged. The control: everything this change
 *    touches has to leave the existing path exactly as it was.
 */
{
  begin("1. Ordinary product order (staged path)");
  const order = stageOrder("cs_plain", [PRODUCT_ITEM]);
  const response = await deliver(completedEvent("cs_plain"));

  const row = supabase.store.tables.orders[0];
  check("returns 200", response.status === 200, `got ${response.status}`);
  check("order is confirmed", row.status === "confirmed", row.status);
  check("order is numbered", Boolean(row.order_number), String(row.order_number));
  check("stock claim is taken", row.stock_applied === true);
  check(
    "stock comes off once, for the product",
    decrementsFor().length === 1 &&
      decrementsFor()[0].args.p_product_id === PRODUCT.id &&
      decrementsFor()[0].args.p_quantity === 2,
    JSON.stringify(decrementsFor()),
  );
  check("one confirmation email", email.sent.length === 1);
  check(
    "the email does not mention a scoop",
    email.sent.length === 1 && !email.sent[0].text.includes("Lucky Scoop"),
  );
  check("the confirmation send is stamped", Boolean(row.confirmation_email_sent_at));
  check("no incident recorded", supabase.store.tables.payment_incidents.length === 0);
  check("nothing was added to the order", itemsOf(order.id).length === 1);
}

/*
 * 2. A scoop-only order, staged. THE CENTRAL CASE. Nothing may be decremented:
 *    at this moment nobody knows which products would be.
 */
{
  begin("2. Scoop-only order (staged path)");
  stageOrder("cs_scoop", [SCOOP_ITEM]);
  const response = await deliver(completedEvent("cs_scoop"));

  const row = supabase.store.tables.orders[0];
  check("returns 200", response.status === 200, `got ${response.status}`);
  check("order is confirmed and numbered", row.status === "confirmed" && Boolean(row.order_number));
  check("stock claim is still taken", row.stock_applied === true);
  check(
    "NO stock came off for the scoop",
    decrementsFor().length === 0,
    JSON.stringify(decrementsFor()),
  );
  const line = itemsOf(row.id)[0];
  check("the line carries the tier id", line.scoop_tier_id === TIER.id);
  check("the line carries no product id", line.product_id === null);
  check("the line's name is the tier's", line.product_name === "Pet scoop");
  check("unit_cost_cents is null, not zero", line.unit_cost_cents === null);
  check("one confirmation email", email.sent.length === 1);
  check(
    "the email names the scoop and its promise",
    email.sent[0].text.includes("Pet scoop") &&
      email.sent[0].text.includes("5 pieces"),
  );
  check(
    "the email says the contents are not decided yet",
    email.sent[0].text.includes("isn't decided yet") &&
      email.sent[0].html.includes("About your scoop"),
  );
  check(
    "the email promises no video",
    !/video/i.test(email.sent[0].text) && !/video/i.test(email.sent[0].html),
  );
  check(
    "the email does not call a scoop non-returnable",
    !email.sent[0].text.includes("Personalised pieces"),
  );
}

/*
 * 3. A mixed basket. The product's stock moves; the scoop's does not. This is
 *    the case a filter-based exclusion gets wrong.
 */
{
  begin("3. Mixed basket (product + scoop)");
  stageOrder("cs_mixed", [PRODUCT_ITEM, SCOOP_ITEM]);
  const response = await deliver(completedEvent("cs_mixed"));

  const row = supabase.store.tables.orders[0];
  check("returns 200", response.status === 200, `got ${response.status}`);
  check(
    "exactly one decrement, and it is the product's",
    decrementsFor().length === 1 && decrementsFor()[0].args.p_product_id === PRODUCT.id,
    JSON.stringify(decrementsFor()),
  );
  const lines = itemsOf(row.id);
  check("both lines survive", lines.length === 2);
  check(
    "no line carries both a product and a tier",
    lines.every((l) => !(l.product_id && l.scoop_tier_id)),
  );
  check(
    "the email lists both",
    email.sent[0].text.includes("Macaron clicker") &&
      email.sent[0].text.includes("Pet scoop"),
  );
}

/*
 * 4. The same event delivered twice. Stripe retries; a retry must not
 *    double-decrement, double-number or double-charge anything.
 */
{
  begin("4. Duplicate delivery of the same event");
  stageOrder("cs_dupe", [PRODUCT_ITEM, SCOOP_ITEM]);
  const first = await deliver(completedEvent("cs_dupe"));
  const numberAfterFirst = supabase.store.tables.orders[0].order_number;
  const second = await deliver(completedEvent("cs_dupe"));

  const row = supabase.store.tables.orders[0];
  check("both deliveries return 200", first.status === 200 && second.status === 200);
  check("the order number did not change", row.order_number === numberAfterFirst);
  check(
    "stock still moved exactly once",
    decrementsFor().length === 1,
    JSON.stringify(decrementsFor()),
  );
  check(
    "the scoop still moved no stock",
    !decrementsFor().some((c) => c.args.p_product_id === TIER.id),
  );
  check("only one confirmation email", email.sent.length === 1);
  check("no duplicate lines", itemsOf(row.id).length === 2);
  check(
    "no order number was burned on the duplicate",
    supabase.store.rpc.filter((c) => c.name === "next_order_number").length === 1,
  );
}

/*
 * 5. The rebuild path with a scoop, and the slug collision it exists to
 *    survive. No order was staged — the database was unreachable at checkout —
 *    so the webhook rebuilds the order from the Stripe session. The tier's slug
 *    is deliberately the SAME STRING as a real product's, which is legal:
 *    `scoop_tiers.slug` and `products.slug` are separate unique indexes.
 */
{
  begin("5. Rebuild from Stripe, scoop slug colliding with a product slug");
  // The real product the tier's slug collides with has to exist, or the
  // collision cannot happen and the scenario proves nothing.
  supabase.store.tables.products.push(PRODUCT);
  stripe.stripeState.lineItems = [
    {
      quantity: 2,
      description: "Macaron clicker",
      price: {
        unit_amount: 900,
        product: {
          name: "Macaron clicker",
          description: "Blush",
          metadata: { slug: "clicker-macaron" },
        },
      },
    },
    {
      quantity: 1,
      description: "Pet scoop",
      price: {
        unit_amount: 2500,
        product: {
          name: "Pet scoop",
          description: "5 pieces",
          // The collision: the same slug string as the product above.
          metadata: {
            slug: "clicker-macaron",
            scoop_tier: TIER.id,
            scoop_pieces: "5",
            scoop_theme: "pet",
          },
        },
      },
    },
  ];

  const response = await deliver(
    completedEvent("cs_rebuild", { stock: "clicker-macaron:2" }),
  );

  const row = supabase.store.tables.orders[0];
  check("returns 200", response.status === 200, `got ${response.status}`);
  check("an order was rebuilt", Boolean(row) && row.status === "confirmed");
  const lines = itemsOf(row.id);
  check("both lines were rebuilt", lines.length === 2);

  const scoopLine = lines.find((l) => l.scoop_tier_id);
  check("the scoop line was recognised", Boolean(scoopLine));
  check(
    "the scoop was NOT linked to the colliding product",
    scoopLine?.product_id === null,
    JSON.stringify(scoopLine),
  );
  check("the scoop line carries the tier id", scoopLine?.scoop_tier_id === TIER.id);
  check("the scoop line restates the promise", scoopLine?.variant_label === "5 pieces");
  check("the scoop line has a null cost", scoopLine?.unit_cost_cents === null);
  check(
    "the scoop's artwork matches what checkout would have staged",
    scoopLine?.art === "corgi" && scoopLine?.tint === "butter",
  );
  check(
    "no stock came off for the scoop",
    !decrementsFor().some((c) => c.args.p_product_id === TIER.id),
    JSON.stringify(decrementsFor()),
  );

  const productLine = lines.find((l) => !l.scoop_tier_id);
  check("the product line kept its cost", productLine?.unit_cost_cents === costBasis.MEASURED_COST_CENTS);
  check(
    "the product line was decremented, once",
    decrementsFor().length === 1 && decrementsFor()[0].args.p_quantity === 2,
  );
}

/*
 * 6. A rebuild that cannot be written must NOT return 2xx. This is the rule the
 *    whole file is built around: a 200 tells Stripe to stop retrying, and it
 *    may only ever be spent on work that finished.
 */
{
  begin("6. A failed item write never returns 2xx");
  stripe.stripeState.lineItems = [
    {
      quantity: 1,
      description: "Pet scoop",
      price: {
        unit_amount: 2500,
        product: {
          name: "Pet scoop",
          metadata: {
            slug: "pet-scoop",
            scoop_tier: TIER.id,
            scoop_pieces: "5",
            scoop_theme: "pet",
          },
        },
      },
    },
  ];
  supabase.store.failNextInsert = "order_items";

  const response = await deliver(completedEvent("cs_broken"));
  check("returns 500 so Stripe redelivers", response.status === 500, `got ${response.status}`);
  check("nothing was numbered", !supabase.store.tables.orders[0]?.order_number);
  check("no stock was claimed", supabase.store.tables.orders[0]?.stock_applied !== true);
  check("no confirmation was sent", email.sent.length === 0);
}

/*
 * 7. A piece count that did not survive the Stripe round trip. The promise is
 *    left unstated rather than invented — "5 pieces" on an order that promised
 *    three is worse than saying nothing.
 */
{
  begin("7. Rebuild with an unreadable piece count");
  stripe.stripeState.lineItems = [
    {
      quantity: 1,
      description: "Pet scoop",
      price: {
        unit_amount: 2500,
        product: {
          name: "Pet scoop",
          metadata: { slug: "pet-scoop", scoop_tier: TIER.id, scoop_theme: "pet" },
        },
      },
    },
  ];

  const response = await deliver(completedEvent("cs_nopieces"));
  const line = supabase.store.tables.order_items[0];
  check("returns 200", response.status === 200, `got ${response.status}`);
  check("the tier is still recorded", line.scoop_tier_id === TIER.id);
  check("no piece count was invented", line.variant_label === "");
  check("still no stock movement", decrementsFor().length === 0);
}

/* ------------------------------------------------ the checkout-side gates */

async function postCheckout(body) {
  const request = new Request("https://bamstudio.test/api/checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}`,
    },
    body: JSON.stringify(body),
  });
  const response = await checkout.POST(request);
  return { response, body: await response.json() };
}

/*
 * 8. A tier that stopped being sellable between add-to-cart and checkout — the
 *    bowl emptied while the customer was deciding. RLS cannot catch this: it
 *    knows the tier is published and nothing about how much is on the shelf.
 *    Checkout must refuse BEFORE a Stripe session exists, or the customer is
 *    charged for a bag that cannot be filled.
 */
{
  begin("8. A tier that stopped being sellable between add-to-cart and checkout");
  queries.catalogue.tiers.set("pet-scoop", {
    ...TIER,
    availability: {
      poolSize: 12,
      drawable: 2,
      scoopsAvailable: 0,
      sellable: false,
      blockers: ["pool can fill 0 scoops — 2 of the 5 pieces it promises are in stock"],
    },
  });

  const { response, body } = await postCheckout({
    lines: [],
    scoop_lines: [{ slug: "pet-scoop", quantity: 1 }],
    shipping_method: "standard",
  });

  check("refuses with 409", response.status === 409, `got ${response.status}`);
  check("names the tier", String(body.error).includes("Pet scoop"), body.error);
  check("says nothing was charged", String(body.error).includes("Nothing has been charged"));
  check(
    "no Stripe session was created",
    stripe.stripeState.created.length === 0,
    JSON.stringify(stripe.stripeState.created),
  );
  check("no order was staged", supabase.store.tables.orders.length === 0);
  check(
    "the studio's blockers were not shown to the customer",
    !String(body.error).includes("pool can fill"),
  );
}

/*
 * 9. A sellable tier, checked out. Proves the other half: the price comes off
 *    the tier row, the line is staged with a tier id and no product id, and no
 *    cost is invented.
 */
{
  begin("9. A sellable scoop, checked out");
  queries.catalogue.tiers.set("pet-scoop", TIER);
  queries.catalogue.products.set(PRODUCT.slug, PRODUCT);

  const { response, body } = await postCheckout({
    lines: [
      { product_id: PRODUCT.id, slug: PRODUCT.slug, quantity: 2 },
    ],
    // A price the browser would like to pay. It is not on the wire at all —
    // the schema has no field for it — which is the point being recorded here.
    scoop_lines: [{ slug: "pet-scoop", quantity: 1 }],
    shipping_method: "standard",
  });

  check("accepted", response.status === 200, `got ${response.status}: ${body.error ?? ""}`);
  check("a Stripe session was created", stripe.stripeState.created.length === 1);

  const session = stripe.stripeState.created[0];
  const scoopLine = session.line_items.find(
    (l) => l.price_data.product_data.metadata.scoop_tier,
  );
  check("the scoop reached Stripe as its tier's name", scoopLine?.price_data.product_data.name === "Pet scoop");
  check(
    "priced from the tier row, in cents",
    scoopLine?.price_data.unit_amount === TIER.price_cents,
    String(scoopLine?.price_data.unit_amount),
  );
  check(
    "the tier id rides on the line for the rebuild path",
    scoopLine?.price_data.product_data.metadata.scoop_tier === TIER.id,
  );
  check(
    "the scoop is absent from the stock map",
    !String(session.metadata.stock).includes("pet-scoop"),
    session.metadata.stock,
  );

  const staged = supabase.store.tables.order_items;
  const stagedScoop = staged.find((l) => l.scoop_tier_id);
  check("the scoop was staged with a tier id", stagedScoop?.scoop_tier_id === TIER.id);
  check("...and no product id", stagedScoop?.product_id === null);
  check("...and a null cost", stagedScoop?.unit_cost_cents === null);
  check("...and the tier's name", stagedScoop?.product_name === "Pet scoop");
  check("...and the promise", stagedScoop?.variant_label === "5 pieces");
  check(
    "the costing tables were asked only about the product",
    costBasis.costCalls.every((ids) => !ids.includes(TIER.id)),
    JSON.stringify(costBasis.costCalls),
  );

  // Postage: a scoop is a parcel, always. `letter_eligible` is set false
  // explicitly in lib/scoop-line.ts, so the whole basket quotes as a parcel and
  // the tier's packed weight is in the total.
  // Optional-chained throughout: a mutation that stops the order being staged
  // must be REPORTED by this harness, not crash it. A run that dies half way
  // through has told nobody which assertions would have failed.
  const order = supabase.store.tables.orders[0];
  check("postage was quoted, and is not free", (order?.shipping ?? 0) > 0, String(order?.shipping));
  check(
    "the quote is a parcel service, never a Large Letter",
    String(order?.quoted_service_code).includes("PARCEL"),
    String(order?.quoted_service_code),
  );
  check(
    "the tier's packed weight is inside the quoted weight",
    (order?.quoted_weight_grams ?? 0) >= TIER.packed_weight_grams,
    String(order?.quoted_weight_grams),
  );
}

/*
 * 9b. A basket of nothing but scoops. The path with NO product lines at all —
 *     an empty costing lookup, an empty stock map, and a postage quote built
 *     entirely from tier weights. It is also the basket the old `lines.min(1)`
 *     would have refused outright, so it is what proves that cap moved safely.
 */
{
  begin("9b. A scoop-only basket, checked out");
  queries.catalogue.tiers.set("pet-scoop", TIER);

  const { response, body } = await postCheckout({
    lines: [],
    scoop_lines: [{ slug: "pet-scoop", quantity: 2 }],
    shipping_method: "standard",
  });

  check("accepted", response.status === 200, `got ${response.status}: ${body.error ?? ""}`);
  const order = supabase.store.tables.orders[0];
  check("one line staged", supabase.store.tables.order_items.length === 1);
  check(
    "subtotal is the tier's price times the quantity",
    order?.subtotal === TIER.price_cents * 2,
    String(order?.subtotal),
  );
  check(
    "the stock map is empty",
    stripe.stripeState.created[0]?.metadata.stock === "",
    String(stripe.stripeState.created[0]?.metadata.stock),
  );
  check(
    "the costing tables were not consulted about anything",
    costBasis.costCalls.every((ids) => ids.length === 0),
    JSON.stringify(costBasis.costCalls),
  );
  /*
   * Two scoops at $25 is $50, over the $49 free-standard-postage threshold, so
   * the customer is charged nothing for postage — and the real quote is STILL
   * recorded on the order. That is the invariant `isFreeShipping()` and
   * `quoteBasket()` are kept apart to protect: waiving the charge must not
   * erase what the carrier actually wants, or a postage bill can never be
   * reconciled against the orders that caused it. A scoop is the case where it
   * matters most, since the studio has no product row to re-derive a weight
   * from later.
   */
  check("the promotion waived the charge", order?.shipping === 0, String(order?.shipping));
  check(
    "but the real quote was still recorded",
    (order?.quoted_weight_grams ?? 0) > 0 && Boolean(order?.quoted_service_code),
    `${order?.quoted_weight_grams} g / ${order?.quoted_service_code}`,
  );
  check(
    "two scoops weigh more than one",
    (order?.quoted_weight_grams ?? 0) >= TIER.packed_weight_grams * 2,
    String(order?.quoted_weight_grams),
  );
  check(
    "quoted as a parcel, never a Large Letter",
    String(order?.quoted_service_code).includes("PARCEL"),
    String(order?.quoted_service_code),
  );
}

/*
 * 10. A tier that is not published at all — RLS never returned it. Same 409 the
 *     product branch gives for a retired product, and again with no session.
 */
{
  begin("10. A tier RLS does not publish");
  const { response, body } = await postCheckout({
    lines: [],
    scoop_lines: [{ slug: "draft-scoop", quantity: 1 }],
    shipping_method: "standard",
  });

  check("refuses with 409", response.status === 409, `got ${response.status}`);
  check("names the slug", String(body.error).includes("draft-scoop"));
  check("no Stripe session was created", stripe.stripeState.created.length === 0);
  check("no order was staged", supabase.store.tables.orders.length === 0);
}

/*
 * 11. An empty basket is still an empty basket. The `min(1)` that used to sit
 *     on `lines` moved to a refinement across both arrays when scoops arrived;
 *     this is what proves the refusal survived the move.
 */
{
  begin("11. An empty basket is still refused");
  const { response } = await postCheckout({
    lines: [],
    scoop_lines: [],
    shipping_method: "standard",
  });
  check("refuses with 400", response.status === 400, `got ${response.status}`);
  check("no Stripe session was created", stripe.stripeState.created.length === 0);
}

/* ------------------------------------------------------------------ result */

console.log("\n" + "-".repeat(70));
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} assertion(s) failed, ${passed} passed\n`);
  for (const failure of failures) console.log(`  • ${failure}`);
  console.log();
  process.exit(1);
}
console.log(`OK: all ${passed} assertions passed across 12 scenarios`);

/*
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT COVER, so the next person does not mistake a green run for
 * more than it is:
 *
 *  - Stripe signature verification. That is Stripe's library; `constructEvent`
 *    is faked, so an unsigned payload is accepted here and is not in production.
 *  - Real PostgreSQL. Constraints, RLS and grants are proved by
 *    supabase/verify.sql against a real PostgreSQL 16. The one constraint this
 *    fake enforces is the scoop/product mutual exclusion, because a route that
 *    breached it is precisely what these scenarios hunt for.
 *  - Real Resend delivery, and `after()` on a live Fly machine. Both are in
 *    WORKLOG's "reviewed by reading only" list and still are.
 *  - The delayed-payment, expired-session and paid-while-cancelled branches.
 *    They were in the lost 43-scenario harness and are not rebuilt here: this
 *    change does not touch them. They are the first thing to add back.
 * ───────────────────────────────────────────────────────────────────────────
 */
