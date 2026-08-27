import { createAdminClient } from "@/lib/supabase/server";
import { unitCost, type CostSettings } from "@/lib/costing";

/**
 * The studio's cost basis: the costing constants, the accessory prices, and
 * what a piece costs to make **right now**.
 *
 * WHY THIS IS IN lib/ AND NOT IN app/admin/. `unitCostsAtSale()` below used to
 * live in `app/admin/data.ts`, and two customer-facing API routes —
 * `/api/checkout` and `/api/webhooks/stripe` — imported it from there. Both
 * stamp `order_items.unit_cost_cents` as a sale is recorded, so they genuinely
 * need the studio's one definition of what a piece cost; what they do not need
 * is a dependency on the staff area. A checkout route reaching into
 * `app/admin/` puts the back office on the import graph of the hottest path in
 * the shop, and makes "what may the admin screens see" a question about a
 * public endpoint. The definition moved down to where both sides can reach it;
 * `app/admin/data.ts` now imports and re-exports it, so there is still exactly
 * one copy.
 *
 * WHY NOT `app/admin/actions.ts`. Every export from a `"use server"` file
 * becomes a callable HTTP endpoint with a generated id that anybody who has
 * loaded the shop can find in the client bundle. A costing function that reads
 * with the service-role key must not be one.
 *
 * Everything here reads through `createAdminClient()` — the service-role key,
 * bypassing RLS — because the costing tables are deliberately unreadable with
 * the key that ships to browsers. Nothing here takes a user id, a role or any
 * other authority from an argument; callers decide who is allowed to ask.
 */

/*
 * A hand-rolled stand-in for `import "server-only"`, which is deliberately not
 * a dependency of this project. Throwing is the point: answering `false`, or
 * quietly returning nothing, would let a client component import this module
 * and fail at runtime somewhere far away from the mistake.
 *
 * Deliberately its own copy rather than one imported from `app/admin/data.ts`
 * — importing a guard from the module this one exists to stop depending on
 * would put the dependency straight back. `lib/auth/staff.ts` carries the same
 * six lines for the same reason. It guards a module boundary, so it belongs to
 * the module.
 */
function assertServer(fn: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${fn}() was called in the browser. Everything in lib/cost-basis.ts ` +
        "reads with the service-role key and must never reach a client bundle.",
    );
  }
}

/**
 * Reshape a PostgREST row into something indexable.
 *
 * The Supabase client is untyped in this project (no generated Database type),
 * so a `select()` it cannot infer a row shape for falls back to
 * `GenericStringError`. Every field is read through an explicit
 * Number()/String()/Boolean() below, so a column that is renamed or dropped
 * shows up as a null or a zero rather than as a type error the compiler was
 * never in a position to catch.
 */
function asRow(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/* ------------------------------------------------------------- settings */

export type Settings = CostSettings & {
  printerModel: string | null;
  defaultBufferStock: number;
  mailerPerOrderCents: number;
};

/**
 * The costing constants.
 *
 * Postgres returns `numeric` as a *string* through PostgREST, to avoid the
 * precision loss of a float. Every one of these goes through Number() for that
 * reason — read `target_margin` straight and you get "0.700", and
 * `1 - "0.700" - 0.016` is NaN, which then propagates silently into every price
 * on the screen.
 */
export async function getSettings(): Promise<Settings> {
  assertServer("getSettings");

  const admin = createAdminClient();
  const { data } = await admin.from("shop_settings").select("*").maybeSingle();

  return toSettings(data);
}

/**
 * The same constants, but null when the singleton row is genuinely absent.
 *
 * `getSettings()` substitutes zeros so a screen can still render, which is
 * right for a screen and wrong for a *cost*: with no settings row, filament,
 * machine time and packaging are all zero and a piece looks free to make.
 * `unitCostsAtSale()` below stamps a permanent column on a real sale, so it has
 * to tell "not configured" from "configured as zero" and write null rather than
 * a flattering number.
 */
async function getSettingsRow(): Promise<Settings | null> {
  assertServer("getSettingsRow");

  const admin = createAdminClient();
  const { data } = await admin.from("shop_settings").select("*").maybeSingle();

  return data ? toSettings(data) : null;
}

function toSettings(data: unknown): Settings {
  const row = asRow(data ?? {});
  const num = (key: string, fallback = 0) => {
    const value = Number(row[key]);
    return Number.isFinite(value) ? value : fallback;
  };

  return {
    printerModel: (row.printer_model as string | null) ?? null,
    printerPriceCents: num("printer_price_cents"),
    printerLifeHours: num("printer_life_hours", 1),
    powerDrawWatts: num("power_draw_watts"),
    electricityPerKwhCents: num("electricity_per_kwh_cents"),
    filamentPerKgCents: num("filament_per_kg_cents"),
    targetMargin: num("target_margin"),
    cardFeeRate: num("card_fee_rate"),
    roundPriceToCents: num("round_price_to_cents", 1),
    packagingPerUnitCents: num("packaging_per_unit_cents"),
    defaultBufferStock: num("default_buffer_stock", 5),
    mailerPerOrderCents: num("mailer_per_order_cents"),
  };
}

/* ---------------------------------------------------------- accessories */

export type Accessory = {
  id: string;
  name: string;
  costCents: number;
  costNote: string | null;
  active: boolean;
  sortOrder: number;
};

export async function getAccessories(): Promise<Accessory[]> {
  assertServer("getAccessories");

  const admin = createAdminClient();
  const { data } = await admin
    .from("accessories")
    .select("id, name, cost_cents, cost_note, active, sort_order")
    .order("sort_order", { ascending: true });

  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    costCents: Number(row.cost_cents ?? 0),
    costNote: (row.cost_note as string | null) ?? null,
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

/* -------------------------------------------------------- cost at sale */

/**
 * What each of these products costs to make **right now**, in whole cents, for
 * stamping onto `order_items.unit_cost_cents` as a sale is recorded.
 *
 * WHY THIS EXISTS. `unit_cost_cents` was written in exactly one place — the
 * market-stall form in `recordSale` — so every website sale landed with a null
 * cost and /admin/reports had nothing to subtract for the online channel. The
 * reports page is honest about it (it counts the lines carrying no cost and
 * says the profit understates what was spent), but "honest about a hole" is not
 * the same as measurable: the shop's main channel contributed revenue and no
 * cost at all.
 *
 * WHY IT IS STAMPED AND NOT DERIVED. The column is a record of what the piece
 * cost *when it sold*. Working it out at read time would rewrite every
 * historical margin the next time filament, electricity or a keyring changed
 * price — which is the exact failure the comment on that column in
 * 0003_admin.sql exists to prevent.
 *
 * Null for any product that has never been measured — no print time, or no
 * filament recipe — because `unitCost` marks that breakdown `unknown` and its
 * total is packaging alone. A 13c "cost" is a 97% margin on a piece nobody has
 * timed. Null is the honest answer and the reports already know how to say so.
 *
 * One settings read, one accessories read and one recipe read for the whole
 * basket, not one per line.
 */
export async function unitCostsAtSale(
  productIds: string[],
): Promise<Map<string, number | null>> {
  assertServer("unitCostsAtSale");

  const costs = new Map<string, number | null>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return costs;

  // Every id answers something, so a caller can write what it gets back
  // without deciding what an absent key means.
  for (const id of ids) costs.set(id, null);

  const admin = createAdminClient();
  const [settings, accessories, products, filament] = await Promise.all([
    getSettingsRow(),
    getAccessories(),
    admin
      .from("products")
      .select("id, print_time_hours, accessory_id")
      .in("id", ids),
    admin.from("product_filament").select("product_id, grams").in("product_id", ids),
  ]);

  // No costing constants at all: nothing here can be worked out, and every
  // line keeps its null.
  if (!settings) return costs;

  const grams = new Map<string, number>();
  for (const row of filament.data ?? []) {
    const id = row.product_id as string;
    grams.set(id, (grams.get(id) ?? 0) + Number(row.grams ?? 0));
  }

  for (const row of products.data ?? []) {
    const id = row.id as string;
    const printTime = row.print_time_hours;
    const accessory =
      accessories.find((a) => a.id === (row.accessory_id as string | null)) ?? null;

    const cost = unitCost(settings, {
      // Null must survive as null: `Number(null)` is 0, and a print time of
      // zero claims the piece prints instantly.
      printHours: printTime === null || printTime === undefined ? null : Number(printTime),
      // A product with no filament rows has not been measured; it has not been
      // measured as weighing nothing.
      grams: grams.has(id) ? (grams.get(id) as number) : null,
      accessoryCents: accessory?.costCents ?? 0,
    });

    // The column is integer cents. Everything upstream is fractional on
    // purpose (a keyring is 9.5c), so the single rounding happens here.
    costs.set(id, cost.unknown ? null : Math.round(cost.total));
  }

  return costs;
}
