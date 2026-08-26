"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff, type Capability } from "@/lib/auth/staff";
import { siteUrl } from "@/lib/stripe";
import {
  hashToken,
  isInvitableRole,
  resolveJoin,
} from "@/app/(admin-join)/admin/join/invitation";

/**
 * Every write the staff area makes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * EVERY ACTION CALLS requireStaff() AS ITS FIRST STATEMENT.
 *
 * There is exactly ONE exception, `acceptInvitation` at the bottom of this
 * file, and it is exempt because requiring staff there would be circular: it is
 * the action that MAKES somebody staff, so the only people who can legitimately
 * reach it are signed-in accounts that are not staff yet. It does not go
 * unguarded — it does its own equivalent check against the invitation row, and
 * the long comment above it explains exactly what stands in for the capability.
 * Do not add a second exception without the same treatment.
 *
 * A server action is an HTTP endpoint. Next.js gives it a generated id and
 * routes to it directly — it is NOT wrapped by app/admin/layout.tsx, and it does
 * not care which page imported it. Anyone who has ever loaded the shop can find
 * that id in the client bundle and POST to it. "Only the admin page calls this"
 * is not a check, it is a hope.
 *
 * So the pattern below is uniform and boring on purpose: the capability comes
 * first, before the form data is even read.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every action returns a FormState rather than throwing. A thrown error in a
 * server action reaches the user as a blank page with a digest — useless to
 * her, and it loses whatever she had typed.
 */

export type FormState = { ok: boolean; message: string } | null;

const ok = (message: string): FormState => ({ ok: true, message });
const fail = (message: string): FormState => ({ ok: false, message });

/* ---------------------------------------------------------------- helpers */

/** Trimmed string, or "" — never undefined, never a File. */
function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function bool(form: FormData, key: string): boolean {
  // An unchecked checkbox is simply absent from the payload.
  return form.get(key) !== null;
}

/**
 * A number, or null when the field was left blank.
 *
 * Blank must survive as null all the way to the column. "" |> Number() is 0,
 * and a print time of 0 is a claim that the piece prints instantly, which then
 * prices it at the cost of its packaging. This is the single most dangerous
 * coercion in the whole studio.
 */
function optionalNumber(form: FormData, key: string): number | null | undefined {
  const raw = text(form, key);
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined; // signals invalid
  return value;
}

/** A whole number ≥ 0, defaulting when blank or unparseable. */
function intOr(form: FormData, key: string, fallback: number): number {
  const value = Number.parseInt(text(form, key), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Dollars typed by a person → integer cents.
 *
 * `Math.round(Number("12.10") * 100)` is 1210, but the round matters: 8.05 * 100
 * is 804.9999999999999 in binary floating point, and truncating gives $8.04.
 */
function dollarsToCents(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Wraps an action body so a thrown error becomes a message, not a blank page. */
async function guard(
  capability: Capability,
  body: () => Promise<FormState>,
): Promise<FormState> {
  // Outside the try on purpose: requireStaff() redirects by throwing a Next.js
  // control-flow signal, and catching it here would swallow the redirect and
  // show "something went wrong" to someone who simply is not staff.
  await requireStaff(capability);

  try {
    return await body();
  } catch (error) {
    console.error("[admin]", error);
    return fail(
      error instanceof Error ? error.message : "Something went wrong. Nothing was saved.",
    );
  }
}

/* --------------------------------------------------------------- products */

export async function saveProduct(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("catalogue", async () => {
    const id = text(form, "id");
    const admin = createAdminClient();

    const name = text(form, "name");
    const sku = text(form, "sku");
    const slug = text(form, "slug");
    if (!name) return fail("A product needs a name.");
    if (!sku) return fail("A product needs a SKU — it is how the spreadsheet finds it.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return fail("The web address can only use lowercase letters, numbers and hyphens.");
    }

    const price = dollarsToCents(text(form, "price"));
    if (price === null) return fail("The price has to be a number, like 12.50.");

    const printTime = optionalNumber(form, "print_time_hours");
    if (printTime === undefined) return fail("Print time has to be a number of hours, or blank.");

    const weight = Number(text(form, "weight_grams"));
    if (!Number.isFinite(weight) || weight <= 0) {
      return fail("Packed weight has to be more than zero — Australia Post prices on it.");
    }

    const accessoryId = text(form, "accessory_id") || null;

    const fields = {
      sku,
      slug,
      name,
      short_name: text(form, "short_name") || name,
      category: text(form, "category"),
      theme: text(form, "theme"),
      description: text(form, "description"),
      price,
      print_time_hours: printTime,
      accessory_id: accessoryId,
      buffer_stock: intOr(form, "buffer_stock", 5),
      stock_on_hand: intOr(form, "stock_on_hand", 0),
      weight_grams: Math.round(weight),
      length_mm: intOr(form, "length_mm", 100),
      width_mm: intOr(form, "width_mm", 80),
      thickness_mm: intOr(form, "thickness_mm", 20),
      active: bool(form, "active"),
      on_market_stall: bool(form, "on_market_stall"),
      is_bestseller: bool(form, "is_bestseller"),
      is_new: bool(form, "is_new"),
    };

    let productId = id;

    if (id) {
      const { error } = await admin.from("products").update(fields).eq("id", id);
      if (error) return fail(friendly(error.message));
    } else {
      // A new product needs the columns 0001 made non-null with no default.
      const { data, error } = await admin
        .from("products")
        .insert({ ...fields, art: text(form, "art") || "macaron", tint: text(form, "tint") || "cream" })
        .select("id")
        .single();
      if (error) return fail(friendly(error.message));
      productId = data.id as string;
    }

    // ---- the filament recipe -------------------------------------------
    //
    // Sent as parallel colour_id[]/grams[] arrays from the form. Replaced
    // wholesale rather than diffed: a colour removed from the form has to
    // disappear from the recipe, and a diff that only handles adds is how a
    // product ends up costed in a colour it no longer uses.
    const colourIds = form.getAll("filament_colour").map(String);
    const gramsList = form.getAll("filament_grams").map(String);

    const recipe: { product_id: string; colour_id: string; grams: number }[] = [];
    for (let i = 0; i < colourIds.length; i += 1) {
      const colourId = colourIds[i];
      const grams = Number(gramsList[i] ?? "");
      if (!colourId) continue;
      if (!Number.isFinite(grams) || grams <= 0) continue;
      // Last one wins if a colour is listed twice — the composite primary key
      // would otherwise reject the whole insert.
      const existing = recipe.findIndex((r) => r.colour_id === colourId);
      if (existing >= 0) recipe[existing].grams = grams;
      else recipe.push({ product_id: productId, colour_id: colourId, grams });
    }

    await admin.from("product_filament").delete().eq("product_id", productId);
    if (recipe.length > 0) {
      const { error } = await admin.from("product_filament").insert(recipe);
      if (error) return fail(friendly(error.message));
    }

    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${productId}`);
    revalidatePath("/admin/inventory");
    // The shop reads these too.
    revalidatePath("/shop");
    revalidatePath(`/product/${slug}`);

    return ok(id ? "Saved." : "Product created.");
  });
}

/** Stock count from the inventory screen — one product, one number. */
export async function setStock(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("inventory", async () => {
    const id = text(form, "id");
    if (!id) return fail("No product given.");

    const admin = createAdminClient();
    const { error } = await admin
      .from("products")
      .update({ stock_on_hand: intOr(form, "stock_on_hand", 0) })
      .eq("id", id);

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/inventory");
    revalidatePath("/admin/products");
    return ok("Counted.");
  });
}

/* ---------------------------------------------------------------- photos */

/*
 * NOT exported. Every export from a "use server" file has to be an async
 * function — Next.js turns each one into an HTTP endpoint, and a string
 * constant cannot be one. Exporting this compiled and linted perfectly and
 * broke `next build`, taking every other export in the file down with it:
 * Turbopack reported actions.ts as having no exports at all, so eleven pages
 * failed on one stray keyword. Nothing outside this file needs the name.
 */
const PHOTO_BUCKET = "product-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Upload photographs for a product.
 *
 * Files are checked here, on the server, not only by the `accept` attribute on
 * the input — that attribute is a convenience for the file picker and a browser
 * is not obliged to honour it. The bucket has the same limits set on it as a
 * second line, because this is a publicly readable bucket and a staff area that
 * will store any bytes at any size is a file host.
 */
export async function uploadPhotos(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("catalogue", async () => {
    const productId = text(form, "id");
    if (!productId) return fail("No product given.");

    const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return fail("No photo was chosen.");

    const admin = createAdminClient();
    const { data: product } = await admin
      .from("products")
      .select("photos, slug, name")
      .eq("id", productId)
      .maybeSingle();

    if (!product) return fail("That product no longer exists.");

    const existing = Array.isArray(product.photos) ? product.photos : [];
    const added: { path: string; alt: string }[] = [];

    for (const file of files) {
      if (!PHOTO_TYPES.includes(file.type)) {
        return fail(`${file.name} is a ${file.type || "file"} — use a JPEG, PNG, WebP or AVIF.`);
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return fail(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`);
      }

      const extension = file.type.split("/")[1].replace("jpeg", "jpg");
      // Random name, not the uploaded one: a filename is attacker-controlled
      // text, and it is about to become part of a public URL.
      const path = `${productId}/${randomBytes(8).toString("hex")}.${extension}`;

      const { error } = await admin.storage
        .from(PHOTO_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (error) {
        return fail(
          error.message.toLowerCase().includes("not found")
            ? "The product-photos bucket does not exist yet — run supabase/storage.sql in the SQL editor."
            : friendly(error.message),
        );
      }

      added.push({ path, alt: `${product.name} — photograph` });
    }

    const { error } = await admin
      .from("products")
      .update({ photos: [...existing, ...added] })
      .eq("id", productId);

    if (error) return fail(friendly(error.message));

    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/product/${product.slug}`);
    return ok(added.length === 1 ? "Photo added." : `${added.length} photos added.`);
  });
}

export async function removePhoto(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("catalogue", async () => {
    const productId = text(form, "id");
    const path = text(form, "path");
    if (!productId || !path) return fail("No photo given.");

    const admin = createAdminClient();
    const { data: product } = await admin
      .from("products")
      .select("photos, slug")
      .eq("id", productId)
      .maybeSingle();

    if (!product) return fail("That product no longer exists.");

    const photos = (Array.isArray(product.photos) ? product.photos : []).filter(
      (p: { path?: string }) => p?.path !== path,
    );

    // The row first, then the object. If the storage delete fails the photo is
    // already gone from the page, which is what was asked for; an orphaned file
    // in a bucket is a tidiness problem, while a row pointing at a file that no
    // longer exists is a broken image on the shop.
    const { error } = await admin.from("products").update({ photos }).eq("id", productId);
    if (error) return fail(friendly(error.message));

    await admin.storage.from(PHOTO_BUCKET).remove([path]);

    revalidatePath(`/admin/products/${productId}`);
    revalidatePath(`/product/${product.slug}`);
    return ok("Photo removed.");
  });
}

/* --------------------------------------------------------------- colours */

export async function saveColour(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("colours", async () => {
    const id = text(form, "id");
    const name = text(form, "name");
    const hex = text(form, "hex").toUpperCase();

    if (!name) return fail("A colour needs a name.");
    if (!/^#[0-9A-F]{6}$/.test(hex)) {
      return fail("The colour has to be a six-digit hex code, like #F2C94C.");
    }

    const admin = createAdminClient();
    const fields = {
      name,
      hex,
      active: bool(form, "active"),
      sort_order: intOr(form, "sort_order", 0),
    };

    if (id) {
      const { error } = await admin.from("colours").update(fields).eq("id", id);
      if (error) return fail(friendly(error.message));
    } else {
      const { data, error } = await admin.from("colours").insert(fields).select("id").single();
      if (error) return fail(friendly(error.message));
      // A colour with no stock row would read as "0 rolls" anyway, but only by
      // accident of a left join. Make it explicit.
      await admin.from("filament_stock").insert({ colour_id: data.id, rolls_on_hand: 0 });
    }

    revalidatePath("/admin/colours");
    revalidatePath("/admin/inventory");
    return ok(id ? "Saved." : "Colour added.");
  });
}

/** How many rolls of a colour are on the shelf. */
export async function setRolls(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("inventory", async () => {
    const colourId = text(form, "colour_id");
    if (!colourId) return fail("No colour given.");

    const rolls = Number(text(form, "rolls_on_hand"));
    if (!Number.isFinite(rolls) || rolls < 0) return fail("Rolls has to be zero or more.");

    const admin = createAdminClient();
    const { error } = await admin
      .from("filament_stock")
      .upsert(
        { colour_id: colourId, rolls_on_hand: rolls, updated_at: new Date().toISOString() },
        { onConflict: "colour_id" },
      );

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/colours");
    revalidatePath("/admin/inventory");
    return ok("Counted.");
  });
}

/* ----------------------------------------------------------- accessories */

export async function saveAccessory(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("settings", async () => {
    const id = text(form, "id");
    if (!id) return fail("No accessory given.");

    const cents = Number(text(form, "cost_cents"));
    if (!Number.isFinite(cents) || cents < 0) {
      return fail("The cost has to be a number of cents, like 9.5.");
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("accessories")
      .update({
        cost_cents: cents,
        cost_note: text(form, "cost_note") || null,
        active: bool(form, "active"),
      })
      .eq("id", id);

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/settings");
    revalidatePath("/admin/products");
    return ok("Saved.");
  });
}

/* -------------------------------------------------------------- settings */

export async function saveSettings(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("settings", async () => {
    const margin = Number(text(form, "target_margin")) / 100;
    const cardFee = Number(text(form, "card_fee_rate")) / 100;

    if (!Number.isFinite(margin) || margin < 0 || margin >= 1) {
      return fail("The target margin has to be between 0 and 100 per cent.");
    }
    if (!Number.isFinite(cardFee) || cardFee < 0 || cardFee >= 1) {
      return fail("The card fee has to be between 0 and 100 per cent.");
    }
    if (margin + cardFee >= 1) {
      return fail(
        "The margin and the card fee add up to 100 per cent or more, so there is no price " +
          "that satisfies both. Lower the margin.",
      );
    }

    const life = intOr(form, "printer_life_hours", 0);
    if (life <= 0) return fail("Expected printer life has to be more than zero hours.");

    const printerPrice = dollarsToCents(text(form, "printer_price"));
    const filamentPrice = dollarsToCents(text(form, "filament_per_kg"));
    const electricity = Number(text(form, "electricity_per_kwh"));
    if (printerPrice === null) return fail("The printer price has to be a number.");
    if (filamentPrice === null) return fail("The filament price has to be a number.");
    if (!Number.isFinite(electricity) || electricity < 0) {
      return fail("The electricity price has to be a number, like 0.327.");
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from("shop_settings")
      .update({
        printer_model: text(form, "printer_model") || null,
        printer_price_cents: printerPrice,
        printer_life_hours: life,
        power_draw_watts: intOr(form, "power_draw_watts", 0),
        // Stored in cents per kWh to four places, typed in dollars.
        electricity_per_kwh_cents: Math.round(electricity * 100 * 10000) / 10000,
        filament_per_kg_cents: filamentPrice,
        target_margin: margin,
        card_fee_rate: cardFee,
        round_price_to_cents: Math.max(1, intOr(form, "round_price_to_cents", 50)),
        default_buffer_stock: intOr(form, "default_buffer_stock", 5),
        packaging_per_unit_cents: Number(text(form, "packaging_per_unit_cents")) || 0,
        mailer_per_order_cents: Number(text(form, "mailer_per_order_cents")) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", true);

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/settings");
    revalidatePath("/admin/products");
    revalidatePath("/admin/inventory");
    return ok("Saved. Every unit cost has been recalculated.");
  });
}

/* ---------------------------------------------------------------- orders */

const ORDER_STATUSES = [
  "confirmed",
  "printing",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

export async function setOrderStatus(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const id = text(form, "id");
    const status = text(form, "status");

    if (!id) return fail("No order given.");
    if (!(ORDER_STATUSES as readonly string[]).includes(status)) {
      return fail("That is not a status an order can be in.");
    }

    const admin = createAdminClient();
    const update: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    };

    const tracking = text(form, "tracking_number");
    if (tracking) update.tracking_number = tracking;

    // `pending` is not in the list above, so an order can never be pushed back
    // into the unpaid state a webhook uses as its compare-and-set.
    const { error } = await admin
      .from("orders")
      .update(update)
      .eq("id", id)
      .neq("status", "pending");

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/orders");
    revalidatePath(`/admin/orders/${id}`);
    revalidatePath("/admin");
    revalidatePath("/admin/inventory");
    return ok("Updated.");
  });
}

/**
 * A sale that did not come through the website — a market stall, TikTok, a
 * friend at work.
 *
 * It goes in the same table as a website order because every report reads that
 * table, and a sale kept somewhere else is a sale every number is quietly wrong
 * about. Stock comes off here, in the same way the Stripe webhook does it for
 * an online order.
 */
export async function recordSale(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const staff = await requireStaff("orders");
    const admin = createAdminClient();

    const productId = text(form, "product_id");
    const quantity = intOr(form, "quantity", 0);
    const channel = text(form, "channel");

    if (!productId) return fail("Choose which product was sold.");
    if (quantity < 1) return fail("How many were sold?");
    if (!["market_stall", "tiktok", "shopee", "other"].includes(channel)) {
      return fail("Choose where it was sold. The website records its own sales.");
    }

    const { data: product } = await admin
      .from("products")
      .select("id, name, price, art, tint, stock_on_hand, print_time_hours, accessory_id")
      .eq("id", productId)
      .maybeSingle();

    if (!product) return fail("That product no longer exists.");

    const unitPrice = text(form, "unit_price")
      ? dollarsToCents(text(form, "unit_price"))
      : Number(product.price);
    if (unitPrice === null) return fail("The price has to be a number, like 12.50.");

    // The cost at the time of sale, worked out the same way the product screen
    // shows it. Null when the product has never been measured — an honest gap
    // that the reports then say out loud, rather than a zero that silently
    // becomes 100% margin.
    const unitCostCents = await costAtSale(admin, product);

    const subtotal = unitPrice * quantity;

    const { data: order, error } = await admin
      .from("orders")
      .insert({
        email: text(form, "email") || "counter-sale@bamstudio.local",
        status: "delivered", // handed over in person; there is nothing to post
        channel,
        subtotal,
        shipping: 0,
        total: subtotal,
        shipping_method: "in_person",
        shipping_address: { note: "Sold in person", channel },
        recorded_by: staff.userId,
        stock_applied: true,
      })
      .select("id")
      .single();

    if (error) return fail(friendly(error.message));

    const { error: lineError } = await admin.from("order_items").insert({
      order_id: order.id,
      product_id: product.id,
      product_name: product.name,
      art: product.art,
      tint: product.tint,
      unit_price: unitPrice,
      quantity,
      unit_cost_cents: unitCostCents,
    });

    if (lineError) return fail(friendly(lineError.message));

    // Give it an order number the way a website order gets one, so a sale at a
    // market can be looked up by the same reference everything else uses.
    const { data: numbered } = await admin.rpc("next_order_number");
    if (numbered) await admin.from("orders").update({ order_number: numbered }).eq("id", order.id);

    await admin
      .from("products")
      .update({ stock_on_hand: Math.max(0, Number(product.stock_on_hand ?? 0) - quantity) })
      .eq("id", product.id);

    revalidatePath("/admin/orders");
    revalidatePath("/admin/reports");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin");

    return ok(`Recorded ${quantity} × ${product.name}.`);
  });
}

/** Unit cost at this moment, for stamping onto a line. Null if unmeasurable. */
async function costAtSale(
  admin: ReturnType<typeof createAdminClient>,
  product: { id: string; print_time_hours: unknown; accessory_id: unknown },
): Promise<number | null> {
  const [{ data: settingsRow }, { data: filament }, { data: accessory }] = await Promise.all([
    admin.from("shop_settings").select("*").maybeSingle(),
    admin.from("product_filament").select("grams").eq("product_id", product.id),
    product.accessory_id
      ? admin.from("accessories").select("cost_cents").eq("id", product.accessory_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!settingsRow) return null;
  if (product.print_time_hours === null || product.print_time_hours === undefined) return null;
  if (!filament || filament.length === 0) return null;

  const s = settingsRow as Record<string, unknown>;
  const n = (key: string) => Number(s[key] ?? 0);

  const grams = filament.reduce((sum, r) => sum + Number(r.grams ?? 0), 0);
  const perHour =
    n("printer_price_cents") / Math.max(1, n("printer_life_hours")) +
    (n("power_draw_watts") / 1000) * n("electricity_per_kwh_cents");

  const total =
    (grams * n("filament_per_kg_cents")) / 1000 +
    Number(product.print_time_hours) * perHour +
    Number((accessory as { cost_cents?: number } | null)?.cost_cents ?? 0) +
    n("packaging_per_unit_cents");

  // The column is integer cents. Rounding happens once, here, at the boundary.
  return Math.round(total);
}

/* --------------------------------------------------------- studio access */

/**
 * Invite someone into the studio.
 *
 * THERE IS NO WAY TO REGISTER AS STAFF. The shop's sign-up form creates
 * customers and nothing else; `staff` is not writable with any key a browser
 * holds; and the only path into it is this action, which requires the "access"
 * capability, which only the owner has.
 *
 * The link goes to /admin/join, which is the page that turns the invitation
 * into a staff row — see `acceptInvitation` below. That route deliberately
 * sits outside app/admin/, because app/admin/layout.tsx requires staff and an
 * invited person is not staff yet.
 *
 * The token is generated here, hashed, and only the hash is stored. A database
 * dump therefore contains no usable invitation — the same reason a password
 * table holds hashes. The plaintext is returned to the caller exactly once, to
 * be copied into a message; if she loses it, she revokes and re-invites.
 */
export async function inviteStaff(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("access", async () => {
    const staff = await requireStaff("access");
    const email = text(form, "email").toLowerCase();
    const role = text(form, "role");

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That does not look like an email address.");
    // "owner" is deliberately not invitable. There is one owner, placed by hand
    // in the SQL editor; an invitation that grants the ability to invite is a
    // loop with no floor. The list lives in one place, next to the check that
    // /admin/join makes again before it writes the staff row.
    if (!isInvitableRole(role)) {
      return fail("Choose Studio or Packing. The owner role is not something that can be handed out.");
    }

    const token = randomBytes(32).toString("base64url");
    // Hashed by the module that reads it back, so the write and the read can
    // never drift onto two different algorithms. See the note on hashToken().
    const tokenHash = hashToken(token);
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const admin = createAdminClient();
    const { error } = await admin.from("staff_invitations").insert({
      email,
      role,
      token_hash: tokenHash,
      expires_at: expires.toISOString(),
      created_by: staff.userId,
    });

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/access");

    // The one and only time the plaintext exists outside the invitee's hands.
    return ok(`INVITE_LINK:${siteUrl()}/admin/join?token=${token}`);
  });
}

export async function revokeInvitation(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("access", async () => {
    const id = text(form, "id");
    if (!id) return fail("No invitation given.");

    const admin = createAdminClient();
    const { error } = await admin
      .from("staff_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .is("accepted_at", null);

    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/access");
    return ok("Revoked.");
  });
}

/** Take someone's studio access away. The owner's own row cannot be removed. */
export async function removeStaff(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("access", async () => {
    const me = await requireStaff("access");
    const userId = text(form, "user_id");

    if (!userId) return fail("No account given.");
    if (userId === me.userId) {
      return fail(
        "That is your own account. Removing it would lock you out of the studio with no way " +
          "back in except the SQL editor.",
      );
    }

    const admin = createAdminClient();
    const { error } = await admin.from("staff").delete().eq("user_id", userId).neq("role", "owner");
    if (error) return fail(friendly(error.message));

    revalidatePath("/admin/access");
    return ok("Access removed.");
  });
}

/**
 * Accept an invitation and become staff.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE ACTION IN THIS FILE THAT DOES NOT CALL guard(), AND WHY.
 *
 * `guard()` starts with `requireStaff()`. Requiring staff here is circular:
 * this is the action that MAKES somebody staff. Everyone who legitimately
 * reaches it is a signed-in account with no row in `public.staff` — that is
 * what being invited means — so `requireStaff()` would redirect every single
 * one of them to /login and no invitation could ever be accepted. It is the one
 * admin action a non-staff signed-in person is supposed to reach.
 *
 * What stands in for the capability check, all of it in `resolveJoin()`:
 *
 *   • The caller must be signed in. `getUser()` reads the session cookie; if
 *     there is nobody, nothing happens.
 *   • The token must hash to a row in `staff_invitations`. The plaintext is
 *     never stored, so an unknown or a guessed token simply matches nothing.
 *   • The signed-in email must equal the invited email. This is the real gate:
 *     it is not enough to hold the link, you have to be the person it was made
 *     for.
 *   • The invitation must be live — not accepted, not revoked, not expired.
 *
 * That is a narrower gate than any capability in this file. It grants exactly
 * what one row, written earlier by the owner, says it grants.
 *
 * DEFECT THIS CLOSES: `inviteStaff` has handed out links to /admin/join since
 * the day it was written and that route did not exist. Every invitation 404d,
 * so Studio and Packing access could not be given to anybody — the owner was
 * the only person who could ever be in the studio, because hers is the one row
 * placed by hand in the SQL editor.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function acceptInvitation(_prev: FormState, form: FormData): Promise<FormState> {
  let failure: FormState;

  try {
    // Returns null when the person is now staff, or a message saying why not.
    failure = await joinWithInvitation(text(form, "token"));
  } catch (error) {
    console.error("[admin]", error);
    return fail("Something went wrong. You have not been given access.");
  }

  if (failure) return failure;

  // The owner's invitation table now says "accepted".
  revalidatePath("/admin/access");

  // Outside the try on purpose, for the same reason `guard()` keeps
  // requireStaff() outside its own: redirect() signals by throwing a Next.js
  // control-flow value, and catching it would turn a successful join into
  // "something went wrong" on a person who is already staff.
  redirect("/admin");
}

/**
 * The write half of accepting. Null means it worked.
 *
 * Split out so the redirect above can sit outside the try/catch. Not exported —
 * every export from a "use server" file becomes an HTTP endpoint, and this one
 * has no business being one.
 */
async function joinWithInvitation(token: string): Promise<FormState> {
  const state = await resolveJoin(token);

  // The page has already shown each of these; the action says them again
  // because a form can be submitted long after the page was rendered, and the
  // invitation can have been revoked, used or run out in between.
  switch (state.kind) {
    case "signed_out":
      return fail(
        "You are not signed in any more. Sign in with the address the invitation was sent " +
          "to, then open the link again.",
      );
    case "invalid":
      return fail("This invitation link is not valid.");
    case "accepted":
      return fail("This invitation has already been used. Ask the owner for a fresh one.");
    case "revoked":
      return fail("This invitation was revoked. Ask the owner for a fresh one.");
    case "expired":
      return fail("This invitation has expired. Ask the owner for a fresh one.");
    case "wrong_person":
      return fail(
        "This invitation was made for a different email address, so it cannot be accepted " +
          "from this account.",
      );
    case "refused_role":
      return fail(
        "This invitation asks for access that cannot be handed out through a link. Nothing " +
          "has been changed.",
      );
    case "already_staff":
      return fail("You already have studio access — there is nothing to accept.");
    case "ready":
      break;
  }

  /*
   * The role is read off the invitation row and asserted a second time here,
   * before anything is written.
   *
   * It never comes from the URL, the form or any other thing a request body can
   * steer — the form carries a token and nothing else. `staff.role` accepts
   * 'owner'; `staff_invitations.role` does not, and neither does this. A row
   * that somehow said 'owner' would be refused rather than minting a second
   * owner who could then invite more owners.
   */
  if (!isInvitableRole(state.role)) {
    return fail("That invitation does not grant a role that can be handed out.");
  }

  const admin = createAdminClient();

  /*
   * Claim the invitation FIRST, with a compare-and-set.
   *
   * `.is("accepted_at", null)` is what makes an invitation single-use: two tabs,
   * or two people who were forwarded the same link and share an inbox, race
   * here and exactly one of them updates a row. No rows back means somebody
   * already used it.
   */
  const { data: claimed, error: claimError } = await admin
    .from("staff_invitations")
    .update({ accepted_at: new Date().toISOString(), accepted_by: state.userId })
    .eq("id", state.invitationId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");

  /*
   * Database errors are logged and NOT shown, which is the opposite of what
   * every other action in this file does.
   *
   * `friendly()` passes Postgres's own words through to the screen, and that is
   * right for the owner — she can act on "another product already uses that
   * SKU". The person reading this page is not staff and may not even be the
   * invitee; constraint names and column names are not theirs to see.
   */
  if (claimError) {
    console.error("[admin] claiming invitation", claimError.message);
    return fail("We could not take up your invitation just now. Please try again in a moment.");
  }
  if (!claimed || claimed.length === 0) {
    return fail("This invitation has already been used. Ask the owner for a fresh one.");
  }

  // insert, never upsert. An upsert keyed on user_id would OVERWRITE an
  // existing role — the owner clicking an old Packing link would demote
  // herself out of the access page and there would be no way back except the
  // SQL editor. A duplicate key here means they are already staff, which is
  // handled below rather than papered over.
  const { error: staffError } = await admin.from("staff").insert({
    user_id: state.userId,
    role: state.role,
    invited_by: state.invitedBy,
  });

  if (staffError) {
    // Hand the invitation back. It was claimed a moment ago and the access it
    // was claimed for did not happen, so burning it would leave the person with
    // no way in and the owner with an invitation that reads "accepted" by
    // somebody who is not in the studio. Scoped to this user's own claim so it
    // can never clear somebody else's acceptance.
    await admin
      .from("staff_invitations")
      .update({ accepted_at: null, accepted_by: null })
      .eq("id", state.invitationId)
      .eq("accepted_by", state.userId);

    if (staffError.code === "23505") {
      return fail("You already have studio access — there is nothing to accept.");
    }
    console.error("[admin] writing staff row", staffError.message);
    return fail(
      "We could not add you to the studio just now. Nothing has changed, and your " +
        "invitation still works — please try again in a moment.",
    );
  }

  return null;
}

/* ----------------------------------------------------------------- errors */

/**
 * Postgres speaks to developers. This screen is read by the person who runs the
 * shop, so the three errors she will actually hit get a sentence she can act on
 * and everything else is passed through rather than replaced with "an error
 * occurred", which tells nobody anything.
 */
function friendly(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("products_sku_key")) return "Another product already uses that SKU.";
  if (lower.includes("products_slug_key")) return "Another product already uses that web address.";
  if (lower.includes("colours_name_key")) return "There is already a colour with that name.";
  if (lower.includes("staff_invitations_token_hash_key")) return "Try again — that was a one-in-a-billion collision.";
  if (lower.includes("violates foreign key") && lower.includes("colour")) {
    return "That colour is used by a product, so it cannot be deleted. Turn it off instead.";
  }
  return message;
}
