"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff, type Capability } from "@/lib/auth/staff";
import { getOrderScoops, MEASURE_COLOUR_SLOTS, unitCostsAtSale } from "./data";
import { activationBlockers, packCost } from "@/lib/scoop";
import { SCOOP_THEMES, type ScoopTheme } from "@/lib/types";
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

/**
 * Print time and filament grams for ONE product, from the measuring screen.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY "catalogue" AND NOT "inventory".
 *
 * The screen this serves hangs off Inventory, and the obvious reading is that
 * measuring is an inventory job. It is not. `setStock` and `setRolls` above
 * record an observation about a shelf: wrong today, right tomorrow, and nothing
 * downstream of them is a claim about money. This writes
 * `products.print_time_hours` and `product_filament` — the two inputs every
 * unit cost, margin and suggested price in the shop is derived from. They are
 * the same two fields `saveProduct` writes, and `saveProduct` is "catalogue".
 * One number typed here moves what the studio believes a piece earns.
 *
 * Today `owner` and `studio` both hold "inventory" and "catalogue", so the two
 * choices are indistinguishable on the live roles — which is exactly why it has
 * to be argued rather than measured. The role that does not exist yet is the
 * one that decides it: a stocktake helper given "inventory" so she can count
 * boxes should not thereby be able to reprice the catalogue. `packing` is
 * irrelevant to the choice — it holds neither, and never sees a cost either
 * way, which is the rule in lib/auth/staff.ts.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Partial entry is a real, honest state. A print time with no grams saves the
 * print time and says out loud that the piece is still unmeasured; it does not
 * invent a zero for the half that was not typed, and the row stays on the
 * screen saying so.
 */
export async function saveMeasurement(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("catalogue", async () => {
    const id = text(form, "id");
    if (!id) return fail("No product given.");

    const printTime = optionalNumber(form, "print_time_hours");
    if (printTime === undefined) {
      return fail("Print time has to be a number of hours, or blank if you have not timed it.");
    }

    const colourIds = form.getAll("filament_colour").map(String);
    const gramsList = form.getAll("filament_grams").map(String);

    /*
     * The screen always submits every slot, blank ones included — a control
     * inside a closed <details> is still part of the form — so a payload with
     * fewer is not this form. This matters because the recipe below is replaced
     * wholesale: without this check a POST that simply omitted the filament
     * fields would read as "this piece uses no colours" and wipe a recipe the
     * screen never showed anybody. A server action is a public HTTP endpoint.
     */
    if (
      colourIds.length !== MEASURE_COLOUR_SLOTS ||
      gramsList.length !== MEASURE_COLOUR_SLOTS
    ) {
      return fail("That form was incomplete. Reload the page and try again.");
    }

    const recipe: { product_id: string; colour_id: string; grams: number }[] = [];
    for (let i = 0; i < MEASURE_COLOUR_SLOTS; i += 1) {
      const colourId = colourIds[i].trim();
      const raw = gramsList[i].trim();

      // An untouched slot. Not an error — most pieces are one colour.
      if (!colourId && raw === "") continue;

      if (!colourId) {
        // The workbook's own check on Filament!B42 — "grams typed with no
        // colour chosen. Should be 0" — as a refusal rather than a number that
        // disappears. saveProduct drops this line silently, which is tolerable
        // on a form with one product on it and not on a screen where somebody
        // is typing forty-four of them in a row.
        return fail("There are grams typed with no colour chosen. Pick the colour, or clear the grams.");
      }
      if (raw === "") {
        return fail("Type the grams next to the colour. A colour with no grams buys no filament.");
      }

      const grams = Number(raw);
      if (!Number.isFinite(grams) || grams <= 0) {
        return fail(
          "Grams has to be a number above zero. Leave the whole line blank if the piece does " +
            "not use that colour — zero grams of a colour is not the same as not using it.",
        );
      }
      if (recipe.some((r) => r.colour_id === colourId)) {
        return fail("The same colour is on two lines. Add the grams together on one of them.");
      }

      recipe.push({ product_id: id, colour_id: colourId, grams });
    }

    const admin = createAdminClient();

    /*
     * Every colour is checked to exist BEFORE anything is written.
     *
     * The recipe is replaced by a delete followed by an insert, and PostgREST
     * gives no transaction across the two. So a colour id that fails the
     * foreign key would delete the old recipe and then fail to write the new
     * one — a product measured last week comes back unmeasured because
     * somebody's form carried a stale id. Failing here costs one query and
     * leaves the row exactly as it was.
     */
    if (recipe.length > 0) {
      const ids = recipe.map((r) => r.colour_id);
      const { data: known, error: colourError } = await admin
        .from("colours")
        .select("id")
        .in("id", ids);

      if (colourError) return fail(friendly(colourError.message));
      if ((known?.length ?? 0) !== ids.length) {
        return fail("One of those colours no longer exists. Reload the page and try again.");
      }
    }

    /*
     * Refuse to touch a piece that already uses more colours than this screen
     * has room for. `product_filament` has no four-colour ceiling; this form
     * does, and replacing the recipe wholesale from four slots would silently
     * delete the fifth. The full product form has no such limit.
     */
    const { data: existing, error: readError } = await admin
      .from("product_filament")
      .select("colour_id")
      .eq("product_id", id);

    if (readError) return fail(friendly(readError.message));
    if ((existing?.length ?? 0) > MEASURE_COLOUR_SLOTS) {
      return fail(
        `This piece already uses more than ${MEASURE_COLOUR_SLOTS} colours, which is more than ` +
          "this screen can show. Open it on the product page so none of them are lost.",
      );
    }

    const { data: updated, error } = await admin
      .from("products")
      .update({ print_time_hours: printTime })
      .eq("id", id)
      .select("id");

    if (error) return fail(friendly(error.message));
    if (!updated || updated.length === 0) return fail("That product no longer exists.");

    // Replaced wholesale rather than diffed, for the reason saveProduct gives:
    // a colour taken off the recipe has to disappear from it, and a diff that
    // only handles additions is how a product stays costed in a colour it no
    // longer uses.
    const { error: clearError } = await admin
      .from("product_filament")
      .delete()
      .eq("product_id", id);
    if (clearError) return fail(friendly(clearError.message));

    if (recipe.length > 0) {
      const { error: insertError } = await admin.from("product_filament").insert(recipe);
      if (insertError) return fail(friendly(insertError.message));
    }

    // The cost, the queue and the buy list all read these two fields.
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/inventory/measure");
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${id}`);
    // Nothing customer-facing changes: print time and grams are cost data and
    // no shop page reads either, so /shop and /product/… are left alone.

    // Say what is still missing rather than a flat "Saved." A half-measured
    // product is a real state and the person needs to know she is not finished
    // with this row — the same reading `missingCostInputs()` gives the screen.
    const stillMissing: string[] = [];
    if (printTime === null) stillMissing.push("no print time");
    if (recipe.length === 0) stillMissing.push("no filament grams");

    if (stillMissing.length > 0) {
      return ok(`Saved, but still not measured: ${stillMissing.join(" and ")}.`);
    }
    return ok("Measured.");
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

    const existing = (Array.isArray(product.photos) ? product.photos : []) as {
      path?: string;
    }[];

    // THE DEFECT THIS CLOSES (defect 6).
    //
    // `path` is a form field. It used to be passed straight to
    // `storage.remove()` on the SERVICE-ROLE client, which bypasses RLS and
    // every storage policy — and the only thing the surrounding code checked
    // was this product's own JSON array, which it merely filtered. So a POST to
    // this action's id with any other object's path deleted that object: every
    // photograph in the bucket was one request away from anyone holding a
    // `catalogue` capability, and staff invitations grant it. This is precisely
    // what lib/supabase/server.ts's own warning about the service-role client
    // forbids — "never in anything a request body can steer".
    //
    // The product's stored photo list is the authority. Not a prefix check on
    // the path: `uploadPhotos` happens to write `<product id>/<random>.<ext>`,
    // but that is a naming convention, and a rule derived from a convention is
    // a rule that stops holding the day the convention changes. A path this
    // product does not list is not this product's photo, whatever it looks
    // like.
    if (!existing.some((p) => p?.path === path)) {
      return fail("That photo is not on this product.");
    }

    const photos = existing.filter((p) => p?.path !== path);

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

/**
 * The statuses `setOrderStatus` will write.
 *
 * `shipped` is deliberately NOT here — see `markShipped` below. `pending` is
 * not here either, so an order can never be pushed back into the unpaid state
 * the Stripe webhook uses as its compare-and-set.
 */
const LADDER_STATUSES = ["confirmed", "printing", "packed", "delivered", "cancelled"] as const;

/** What an order has to be for posting it to be a thing that can happen. */
const POSTABLE_STATUSES = ["confirmed", "printing", "packed"] as const;

/** Revalidate everything a status move is visible on. */
function revalidateOrder(id: string): void {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
  revalidatePath("/admin");
  // Open demand is confirmed/printing/packed, so leaving or re-entering that
  // set changes what the inventory screen says still has to be printed.
  revalidatePath("/admin/inventory");
}

/**
 * Move an order along the everyday ladder: confirmed → printing → packed, plus
 * delivered and cancelled.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IT CANNOT SET `shipped`, AND THAT IS THE POINT.
 *
 * This used to be one form: a six-entry status dropdown and a free-text
 * tracking box, saved by one button. Two defects came out of that shape.
 *
 *  1. Posting a parcel was one mis-picked line of a dropdown away, on the same
 *     control used many times a day for the harmless moves. The single
 *     transition that publishes a new fact to a customer was the cheapest one
 *     to make by accident.
 *  2. Blank tracking meant "leave whatever is there", so a number typed onto
 *     the wrong order could never be taken off it, and a genuinely untracked
 *     parcel could never be recorded once a number had been saved.
 *
 * Dispatch is now `markShipped`, which asks the tracking question outright and
 * refuses to guess. This one keeps the ladder and nothing else. `shipped` is
 * rejected here as well as being absent from the screen's dropdown, because a
 * server action is a public endpoint and the dropdown is not a check.
 *
 * IT ALSO CANNOT PULL AN ORDER BACK OUT OF A RECORDED DISPATCH.
 *
 * `tracking_number` is not cleared by anything on this path, so a `shipped`
 * order dragged back to `printing` here would leave a live article number
 * sitting on a row that /track renders as still being made. Undoing a dispatch
 * has to remove the number in the same write, which is `undoDispatch`. Any
 * backwards move into the workshop is refused while a dispatch is on the row,
 * and the message says which button to use instead.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function setOrderStatus(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const id = text(form, "id");
    const status = text(form, "status");

    if (!id) return fail("No order given.");
    if (!status) return fail("Choose which step this order is at.");
    if (status === "shipped") {
      return fail(
        "Posting a parcel is done in “Post this parcel”, so the tracking " +
          "number is recorded at the same moment. Nothing has been changed.",
      );
    }
    if (!(LADDER_STATUSES as readonly string[]).includes(status)) {
      return fail("That is not a status an order can be in.");
    }

    const admin = createAdminClient();

    const { data: existing } = await admin
      .from("orders")
      .select("status, tracking_number")
      .eq("id", id)
      .maybeSingle();

    if (!existing) return fail("That order no longer exists.");
    const current = existing as { status: string; tracking_number: string | null };

    // An unpaid checkout is not an order and its status is the webhook's
    // compare-and-set. Nothing on this screen may touch it.
    if (current.status === "pending") {
      return fail(
        "This is an unpaid checkout, not an order. Its status belongs to the " +
          "payment, and nothing has been changed.",
      );
    }

    if (
      (POSTABLE_STATUSES as readonly string[]).includes(status) &&
      (current.status === "shipped" || current.tracking_number)
    ) {
      return fail(
        "This order is recorded as posted. Use “Undo this dispatch” to bring " +
          "it back — that removes the tracking number too, which this would " +
          "leave behind on an order the customer is told is still being made.",
      );
    }

    /*
     * Compare-and-set on the status we just read, so a form left open while
     * somebody else moved the order writes nothing rather than overwriting
     * their change with a stale one.
     */
    const { data, error } = await admin
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", current.status)
      .select("id");

    if (error) return fail(friendly(error.message));

    if (!data || data.length === 0) {
      return fail(
        "This order changed while the screen was open, so nothing has been " +
          "saved. Reload and look again.",
      );
    }

    revalidateOrder(id);
    return ok("Updated.");
  });
}

/**
 * How a tracking number typed by a person is normalised before it is stored.
 *
 * Trim, and collapse any run of whitespace to one space — MyPost Business
 * displays article ids in groups and they get pasted that way. Nothing else is
 * changed: the case is left as typed, because this string is shown to the
 * customer verbatim on /track and is what they will paste into Australia
 * Post's own site.
 */
function normaliseTracking(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Does this look like an article id rather than a slip of the mouse?
 *
 * Deliberately loose. Australia Post article and consignment numbers vary in
 * length and shape, and rejecting a real one is worse than storing an odd one
 * — the customer only ever sees it as text. So this rejects the mistakes that
 * are actually made: a pasted tracking *URL* (`:` and `/`), an email address
 * (`@`), and a stray keystroke with no digits in it at all.
 */
function looksLikeTracking(value: string): boolean {
  if (value.length < 6 || value.length > 40) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/.test(value)) return false;
  return /[0-9]/.test(value);
}

/**
 * Record a dispatch: the parcel has left, and this is how the customer can
 * follow it.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE ACTION, NOT TWO.
 *
 * "Advance the status" and "record the tracking number" are the same event and
 * are saved by the same submit. Splitting them leaves a real window in which
 * /track tells a customer their order has shipped and offers them nothing to
 * follow — and if the second half is never done (an interruption, a phone
 * call), the order rests forever in a state indistinguishable from a parcel
 * that was genuinely posted without tracking. One write, or none.
 *
 * It is nevertheless a *different* action from `setOrderStatus`, for the
 * reasons in that function's comment.
 *
 * THE TRACKING QUESTION IS NOT OPTIONAL AND HAS NO DEFAULT ANSWER.
 *
 * Free standard post really does go as an untracked Large Letter here, so
 * "no number" is a correct outcome for a real parcel — but it is a different
 * fact from "posted, number not written down", and neither may be inferred
 * from an empty box. `tracking_mode` therefore has to arrive as an explicit
 * `tracked` or `untracked`, and the two halves are cross-checked:
 *
 *   - `tracked` with an empty box is refused. A blank tracking number is not a
 *     tracking number, and "" or a placeholder must never reach the column.
 *   - `untracked` with something typed in the box is refused rather than
 *     silently dropping what was typed, which is how a number gets lost.
 *
 * `untracked` writes SQL NULL — explicitly, so a number recorded in error is
 * actually removed rather than left behind by an absent key.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Capability is "orders", which Packing staff hold. Nothing here reads or
 * writes a cost, a margin or a price.
 */
export async function markShipped(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const id = text(form, "id");
    if (!id) return fail("No order given.");

    const admin = createAdminClient();

    /*
     * ──────────── A SCOOP CANNOT BE POSTED BEFORE IT IS RECORDED ────────────
     *
     * 0007_lucky_scoop.sql leaves this to the application on purpose, and says
     * why: it is a rule about a status TRANSITION, so it needs both the old
     * status and the new one, and a trigger enforcing it would also block every
     * hand repair the studio has to be able to make from the Supabase table
     * editor.
     *
     * What is at stake is not tidiness. A scoop is sold before its contents are
     * decided, so recording the pack is the only moment its stock comes off and
     * the only moment its cost is stamped. A parcel posted before that leaves
     * the shelf counts overstated for ever, the margin on that order unknowable,
     * and the pieces themselves unrecorded — and by then the bag is sealed and
     * in the post, so nobody can go back and look.
     *
     * SCOPED TO ORDERS THAT ARE NOT ALREADY POSTED. This form is also how a
     * wrong tracking number is corrected, and refusing to fix the number on a
     * parcel that has already gone helps nobody — the transition this rule is
     * about has already happened.
     *
     * A FAILED READ REFUSES. "We could not check" is not "there is nothing to
     * check", and this is the guard, not the panel.
     */
    const { data: before, error: beforeError } = await admin
      .from("orders")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (beforeError) {
      return fail(
        "This order could not be read, so it is not safe to mark it posted. " +
          "Nothing has been changed — reload and try again.",
      );
    }

    if (before && before.status !== "shipped") {
      const scoops = await getOrderScoops(id);
      if (scoops.unreadable) {
        return fail(
          "The Lucky Scoops on this order could not be read, so it is not " +
            "safe to mark it posted. Nothing has been changed — reload and try again.",
        );
      }
      if (scoops.outstanding.length > 0) {
        return fail(
          `Record what went in first: ${scoops.outstanding.join(", ")}. A scoop is ` +
            "sold before anyone knows what is in it, so packing it is the only " +
            "moment its stock comes off and its cost is worked out. Nothing has been posted.",
        );
      }
    }

    const mode = text(form, "tracking_mode");
    const typed = normaliseTracking(text(form, "tracking_number"));

    if (mode !== "tracked" && mode !== "untracked") {
      return fail(
        "Say whether this parcel went with tracking or without it. Nothing " +
          "has been posted, because a blank answer is not an answer.",
      );
    }

    if (mode === "tracked" && !typed) {
      return fail(
        "Choose “posted without tracking” if there is no number. An empty " +
          "box is not a tracking number and nothing has been saved.",
      );
    }

    if (mode === "untracked" && typed) {
      return fail(
        "You have typed a tracking number but chosen “posted without " +
          "tracking”. Pick one — nothing has been saved, so the number is " +
          "still in the box.",
      );
    }

    if (mode === "tracked" && !looksLikeTracking(typed)) {
      return fail(
        "That does not look like an article number. Paste just the number " +
          "from the label — not the whole tracking web address.",
      );
    }

    const trackingNumber = mode === "tracked" ? typed : null;

    /*
     * Two parcels never share an article id, so the same number on two orders
     * means one of them is the wrong order — the exact mistake this screen has
     * to be hard to make. Refused rather than warned, and the other order is
     * named so it can be found and put right.
     */
    if (trackingNumber) {
      // `limit(1)`, not `maybeSingle()`: two rows already sharing a number is
      // precisely the state this guard exists for, and maybeSingle() answers
      // that with a PGRST116 *error* and a null row — which would read as "no
      // clash" and wave the write straight through.
      const { data: clashes } = await admin
        .from("orders")
        .select("id, order_number")
        .eq("tracking_number", trackingNumber)
        .neq("id", id)
        .limit(1);

      const clash = (clashes ?? [])[0] as { order_number: string | null } | undefined;
      if (clash) {
        return fail(
          `That tracking number is already on ${clash.order_number ?? "another order"}. ` +
            "One of the two is the wrong parcel, so nothing has been saved.",
        );
      }
    }

    /*
     * Compare-and-set on the postable statuses. A cancelled order must not be
     * posted, a delivered one has already arrived, and re-posting an order
     * that is already `shipped` is a correction — which is allowed, and is why
     * `shipped` is in this list too. A form left open on a screen while
     * somebody else cancelled the order writes nothing at all.
     */
    const { data, error } = await admin
      .from("orders")
      .update({
        status: "shipped",
        tracking_number: trackingNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", [...POSTABLE_STATUSES, "shipped"])
      .select("order_number");

    if (error) return fail(friendly(error.message));

    if (!data || data.length === 0) {
      return fail(
        "This order is not in a state that can be posted — it has probably " +
          "been cancelled or already marked delivered since this screen " +
          "loaded. Nothing has been changed; reload and look again.",
      );
    }

    /*
     * ───────────────────────── THE DISPATCH EMAIL HOOK ─────────────────────
     *
     * This is where a "your parcel is on its way" email would be scheduled,
     * with `after()` from "next/server", gated on `isEmailConfigured()` from
     * lib/email.ts and sent through `sendEmail` — copy
     * `queueOrderConfirmation` in app/api/webhooks/stripe/route.ts, which is
     * the pattern and the only mail scheduler this project has. `after()` is
     * supported in a Server Function, so it belongs right here.
     *
     * IT IS NOT WIRED, ON PURPOSE, AND THE REASON IS NOT LAZINESS.
     *
     * Six files currently state as fact that the shop never sends one, and
     * sending it without changing all six falsifies them — two are legal
     * documents, which is the round-10 defect exactly:
     *
     *   app/legal/terms/page.tsx          (~L179–180)  ← legal
     *   app/legal/privacy/page.tsx        (~L279, 291) ← legal
     *   app/api/webhooks/stripe/route.ts  (~L853, 920) — the confirmation
     *                                     email itself says we send no
     *                                     dispatch email
     *   app/order/confirmed/page.tsx      (~L285, 356)
     *   app/faq/page.tsx                  (~L99–105)
     *   app/account/settings/EmailPreferences.tsx (~L191) — and this one is a
     *                                     customer-facing promise that
     *                                     tracking email is "never" sent
     *
     * So the mail and the six retractions have to ship in one change, by
     * somebody who owns those files. Until they do, the panel on the order
     * screen says plainly that no email goes out and points at /track — which
     * is true today and needs no gate to stay true.
     * ──────────────────────────────────────────────────────────────────────
     */

    revalidateOrder(id);

    return ok(
      trackingNumber
        ? `Posted. The customer can follow ${trackingNumber} on /track and in their account.`
        : "Posted, with no tracking. The customer's tracking page now says it is on its way.",
    );
  });
}

/**
 * Undo a dispatch: the parcel did not go after all, or it went on the wrong
 * order.
 *
 * Every status move on this screen is reversible through the ladder, and this
 * is the one that is not — `setOrderStatus` cannot write `shipped`, so it
 * cannot take an order out of it either. Marking the wrong order shipped is
 * the mistake this whole screen is shaped around, so undoing it is one button
 * and no typing.
 *
 * It returns the order to `packed`, which is where a parcel that is boxed but
 * not posted actually is, and clears the tracking number to NULL. There is no
 * audit table in this project, so the number is genuinely gone — the button
 * says so, because the label is usually still on the bench.
 */
export async function undoDispatch(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const id = text(form, "id");
    if (!id) return fail("No order given.");

    const admin = createAdminClient();

    // Scoped to `shipped`: this must never be able to pull a delivered order
    // backwards, and it must not resurrect a cancelled one.
    const { data, error } = await admin
      .from("orders")
      .update({
        status: "packed",
        tracking_number: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "shipped")
      .select("id");

    if (error) return fail(friendly(error.message));

    if (!data || data.length === 0) {
      return fail(
        "This order is not marked as posted, so there is nothing to undo. " +
          "Nothing has been changed.",
      );
    }

    revalidateOrder(id);
    return ok(
      "Put back to packed, and the tracking number has been removed. The " +
        "customer's tracking page no longer says it has been posted.",
    );
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
      // Only what the order line needs. The costing inputs (print time,
      // accessory, filament) and the stock count are no longer read here:
      // `unitCostsAtSale` loads the first three, and the stock movement happens
      // inside `decrement_stock` rather than as a read-modify-write up here.
      .select("id, name, price, art, tint")
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
    //
    // `unitCostsAtSale` is now the one implementation, shared with the website
    // paths (app/api/checkout and the Stripe webhook), which until this round
    // stamped no cost at all. A hand-rolled copy used to live here; two
    // definitions of what a piece costs is how a market sale and a web sale
    // start reporting different margins for the same object.
    const unitCostCents = (await unitCostsAtSale([product.id])).get(product.id) ?? null;

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

    // THE DEFECT THIS CLOSES (defect 4): this used to return here and leave the
    // order row behind. That orphan is `status: 'delivered'` with a real total
    // and no lines, and getReports() sums exactly those statuses — so a failed
    // line insert added revenue the shop never took, against nothing sold, for
    // ever. The webhook's staged path (savePendingOrder in
    // app/api/checkout/route.ts) already deletes on this failure and says why;
    // this is the same rule, and the order is ours, unnumbered, and one
    // statement old, so removing it is safe.
    if (lineError) {
      const { error: cleanupError } = await admin
        .from("orders")
        .delete()
        .eq("id", order.id);
      if (cleanupError) {
        // Worth its own sentence: the sale was not recorded AND a row with a
        // total and no lines is still sitting in the table skewing reports.
        console.error(
          `[admin] Could not remove the empty order ${order.id} after its ` +
            "line failed; it will count as revenue until it is deleted:",
          cleanupError.message,
        );
        return fail(
          "That sale could not be recorded, and an empty order was left behind. " +
            `Delete order ${order.id} before trusting the reports.`,
        );
      }
      return fail(friendly(lineError.message));
    }

    // Give it an order number the way a website order gets one, so a sale at a
    // market can be looked up by the same reference everything else uses.
    //
    // The error used to be discarded, so a failed allocation was
    // indistinguishable from a successful one and the sale simply had no
    // reference. The sale itself is real and recorded either way — deleting it
    // over a missing number would throw away the thing that actually happened —
    // so this reports the gap instead of hiding it or undoing the sale.
    const { data: numbered, error: numberError } = await admin.rpc("next_order_number");
    let numberNote = "";
    if (numberError || !numbered) {
      console.error("[admin] Could not allocate an order number:", numberError?.message);
      numberNote = " It has no order number yet — allocate one before it is posted.";
    } else {
      const { error: writeError } = await admin
        .from("orders")
        .update({ order_number: numbered })
        .eq("id", order.id);
      if (writeError) {
        console.error("[admin] Could not store the order number:", writeError.message);
        numberNote = " It has no order number yet — allocate one before it is posted.";
      }
    }

    // THE DEFECT THIS CLOSES (defect 3): this used to read `stock_on_hand` at
    // the top of the action and write back `Math.max(0, read - quantity)`,
    // which silently discards any webhook decrement that lands in between —
    // the classic read-modify-write. The subtraction now happens inside
    // `decrement_stock`, under a row lock, in one statement, and it answers
    // with how many units the buffer did not have. The shop prints to order, so
    // an oversell is reported rather than refused.
    const { data: shortfall, error: stockError } = await admin.rpc("decrement_stock", {
      p_product_id: product.id,
      p_quantity: quantity,
    });
    let stockNote = "";
    if (stockError) {
      console.error("[admin] Could not move stock for a counter sale:", stockError.message);
      stockNote = " The stock count did not move — check it on the inventory page.";
    } else if (Number(shortfall ?? 0) > 0) {
      stockNote = ` That was ${Number(shortfall)} more than the buffer had — print it first.`;
    }

    revalidatePath("/admin/orders");
    revalidatePath("/admin/reports");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin");

    return ok(`Recorded ${quantity} × ${product.name}.${numberNote}${stockNote}`);
  });
}

/**
 * Mark a refund owed as issued.
 *
 * The webhook records a `payment_incidents` row when a cancelled order is paid
 * anyway; the studio overview shows every unresolved one. Refunding is done by
 * hand in Stripe — this only records that it has been, so the overview stops
 * asking. Nothing here can move money.
 */
export async function resolveRefundIncident(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return guard("orders", async () => {
    const staff = await requireStaff("orders");
    const id = text(form, "id");
    if (!id) return fail("No incident given.");

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payment_incidents")
      .update({
        resolved_at: new Date().toISOString(),
        resolved_by: staff.userId,
        resolution_note: text(form, "note") || "Refunded by hand in Stripe.",
      })
      .eq("id", id)
      // Scoped to the open state so a second submission cannot rewrite when it
      // was settled, and so `.select()` below can tell "done" from "already
      // done" rather than reporting both as success.
      .is("resolved_at", null)
      .select("id");

    if (error) return fail(friendly(error.message));
    if (!data || data.length === 0) return ok("That one was already marked refunded.");

    revalidatePath("/admin");
    return ok("Marked as refunded.");
  });
}

/* ------------------------------------------------------------ lucky scoop */

/**
 * Create or edit a Lucky Scoop tier, pool and all.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY "catalogue" AND NOT "inventory" OR "orders".
 *
 * This action writes a PRICE, a piece count and a packed weight. Those are the
 * three numbers a tier is sold on: the first is what a customer is charged, the
 * second is what they are promised, and the third is what Australia Post prices
 * the parcel on — the studio wears the difference when it is set too low. They
 * are the same kind of fact as `products.price` and `products.weight_grams`,
 * which `saveProduct` writes under "catalogue", and `saveMeasurement` chose
 * "catalogue" over "inventory" for exactly this reason: counting a shelf is an
 * observation, authoring what something costs and sells for is not.
 *
 * The pool is in here rather than in an action of its own for the same reason.
 * Adding a $9 pet bowl to a $12 scoop's pool changes what that scoop earns just
 * as surely as retyping its price does; a pool edit is a pricing decision
 * wearing a checkbox. Recording what went in a parcel is a different authority
 * again — see `recordScoopPack`, which is "orders" and which Packing holds.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function saveScoopTier(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("catalogue", async () => {
    const id = text(form, "id");
    const admin = createAdminClient();

    const name = text(form, "name");
    const slug = text(form, "slug");
    if (!name) return fail("A tier needs a name — “Pet scoop, five pieces”.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return fail("The web address can only use lowercase letters, numbers and hyphens.");
    }

    const theme = text(form, "theme");
    if (!SCOOP_THEMES.some((option) => option.value === theme)) {
      return fail("Choose which theme this scoop draws from.");
    }

    const pieceCount = Number.parseInt(text(form, "piece_count"), 10);
    if (!Number.isFinite(pieceCount) || pieceCount < 1 || pieceCount > 50) {
      return fail("How many pieces does this scoop promise? A whole number between 1 and 50.");
    }

    /*
     * A blank price stays NULL all the way to the column, and 0 is refused.
     *
     * `optionalNumber` is not used here because the field is typed in dollars,
     * so it has to go through `dollarsToCents`. The two failure modes are
     * separated on purpose: "that is not a number" and "zero is not a price"
     * are different mistakes and the second one is the dangerous one — the
     * database refuses a 0, and if it ever stopped refusing it, a zero would
     * render on the shopfront as a free scoop.
     */
    const rawPrice = text(form, "price");
    let priceCents: number | null = null;
    if (rawPrice !== "") {
      priceCents = dollarsToCents(rawPrice);
      if (priceCents === null) return fail("The price has to be a number, like 12.50.");
      if (priceCents === 0) {
        return fail(
          "A scoop cannot be priced at nothing — $0.00 reads as free. Leave the " +
            "price empty until you have decided, which says “not priced yet”.",
        );
      }
    }

    const weight = optionalNumber(form, "packed_weight_grams");
    if (weight === undefined || (weight !== null && weight <= 0)) {
      return fail(
        "Packed weight has to be a number of grams above zero, or blank if you " +
          "have not put a test pack on the scales yet.",
      );
    }
    const thickness = optionalNumber(form, "packed_thickness_mm");
    if (thickness === undefined || (thickness !== null && thickness <= 0)) {
      return fail("Packed thickness has to be a number of millimetres above zero, or blank.");
    }

    /*
     * The pool arrives as one checkbox per product, and an unticked checkbox is
     * simply absent from the payload — so "she cleared the pool" and "this POST
     * is not from that form" look identical. The sentinel is what tells them
     * apart, the same defence `saveMeasurement` makes by counting its slots: a
     * server action is a public HTTP endpoint, and without this a hand-made
     * request could empty a live tier's pool by omitting a field.
     */
    if (text(form, "pool_submitted") !== "1") {
      return fail("That form was incomplete. Reload the page and try again.");
    }
    const pool = [...new Set(form.getAll("pool").map(String).filter(Boolean))];

    const active = bool(form, "active");

    /*
     * The three activation rules, asked in her words BEFORE the write.
     *
     * 0007 enforces all three — two as a CHECK on the row, the third as a
     * constraint trigger over the pool — but a constraint speaks Postgres. It
     * would reach this screen as "new row for relation "scoop_tiers" violates
     * check constraint "scoop_tiers_activation_check"", which tells the person
     * running the shop nothing about what to do next.
     */
    if (active) {
      const blockers = activationBlockers(
        { pieceCount, priceCents, packedWeightGrams: weight },
        pool.length,
      );
      if (blockers.length > 0) {
        return fail(
          `This tier cannot be switched on yet — ${blockers.join(", and ")}. ` +
            "Nothing has been saved, so untick “listed in the shop” to keep it as a draft.",
        );
      }
    }

    /*
     * Every product in the pool is checked to exist BEFORE anything is written,
     * for the reason `saveMeasurement` checks its colours: the pool is written
     * as an insert and a delete with no transaction across them, so an id that
     * failed its foreign key would leave the pool half-changed.
     */
    if (pool.length > 0) {
      const { data: known, error: knownError } = await admin
        .from("products")
        .select("id")
        .in("id", pool);
      if (knownError) return fail(friendly(knownError.message));
      if ((known?.length ?? 0) !== pool.length) {
        return fail("One of those products no longer exists. Reload the page and try again.");
      }
    }

    const fields = {
      slug,
      name,
      blurb: text(form, "blurb"),
      theme: theme as ScoopTheme,
      piece_count: pieceCount,
      price_cents: priceCents,
      packed_weight_grams: weight === null ? null : Math.round(weight),
      packed_thickness_mm: thickness === null ? null : Math.round(thickness),
      sort_order: intOr(form, "sort_order", 0),
      active,
    };

    let tierId = id;

    if (!tierId) {
      // A new tier is inserted INACTIVE whatever was ticked, because its pool
      // does not exist yet and the pool guard would refuse the row. The `active`
      // field is written a few statements below, once the pool is in place.
      const { data, error } = await admin
        .from("scoop_tiers")
        .insert({ ...fields, active: false })
        .select("id")
        .single();
      if (error) return fail(friendly(error.message));
      tierId = data.id as string;
    }

    /*
     * THE POOL IS DIFFED, NOT REPLACED, AND THE ORDER OF THE TWO HALVES MATTERS.
     *
     * `saveProduct` replaces a filament recipe wholesale and says why. That
     * cannot be done here: `scoop_tier_products_pool_guard` fires on DELETE, and
     * a wholesale replace deletes every row first — which on an active tier is a
     * pool of zero at the moment the trigger looks, so it would refuse an edit
     * that ends up perfectly legal. The guard deliberately does NOT fire on
     * insert, so adding first and removing second means it only ever sees the
     * final set, which `activationBlockers` above has already checked.
     *
     * The delete is scoped to the exact ids being removed rather than "not in
     * the new set", so it cannot take a row somebody else added between the read
     * that drew the form and this write.
     */
    const { data: current, error: currentError } = await admin
      .from("scoop_tier_products")
      .select("product_id")
      .eq("tier_id", tierId);
    if (currentError) return fail(friendly(currentError.message));

    const before = new Set((current ?? []).map((row) => row.product_id as string));
    const added = pool.filter((productId) => !before.has(productId));
    const removed = [...before].filter((productId) => !pool.includes(productId));

    const writePool = async (): Promise<string | null> => {
      if (added.length > 0) {
        const { error } = await admin
          .from("scoop_tier_products")
          .insert(added.map((productId) => ({ tier_id: tierId, product_id: productId })));
        if (error) return friendly(error.message);
      }
      if (removed.length > 0) {
        const { error } = await admin
          .from("scoop_tier_products")
          .delete()
          .eq("tier_id", tierId)
          .in("product_id", removed);
        if (error) return friendly(error.message);
      }
      return null;
    };

    const writeTier = async (): Promise<string | null> => {
      const { data, error } = await admin
        .from("scoop_tiers")
        .update(fields)
        .eq("id", tierId)
        .select("id");
      if (error) return friendly(error.message);
      if (!data || data.length === 0) return "That tier no longer exists.";
      return null;
    };

    /*
     * Which half goes first depends on which way the tier is moving.
     *
     * Switching ON: the pool has to be there before the row says `active`, or
     * the trigger on `scoop_tiers` refuses the update. Switching OFF or staying
     * off: the row has to be inactive before the pool shrinks, or the trigger on
     * `scoop_tier_products` refuses the delete. Both orders are legal for the
     * ordinary case where nothing about `active` or the pool's size changed.
     */
    const failure = active
      ? ((await writePool()) ?? (await writeTier()))
      : ((await writeTier()) ?? (await writePool()));
    if (failure) return fail(failure);

    revalidatePath("/admin/scoops");
    revalidatePath(`/admin/scoops/${tierId}`);
    // The shopfront lists the sellable tiers and shows each pool, so both change
    // when any of this does.
    revalidatePath("/scoop");
    revalidatePath(`/scoop/${slug}`);

    if (!active) {
      const blockers = activationBlockers(
        { pieceCount, priceCents, packedWeightGrams: weight },
        pool.length,
      );
      const saved = id ? "Saved" : "Tier created";
      return ok(
        blockers.length > 0
          ? `${saved}, as a draft. Before it can be switched on: ${blockers.join(", and ")}.`
          : `${saved}, as a draft. It is ready to switch on whenever you are.`,
      );
    }

    return ok(id ? "Saved. It is live in the shop." : "Tier created and live in the shop.");
  });
}

/**
 * Record what actually went into one packed scoop.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY "orders" AND NOT "catalogue" OR "inventory".
 *
 * This is the same authority `recordSale` has, and for the same reason: it
 * RECORDS what physically happened to an order. It stamps a cost, but it does
 * not author one — the figure comes from `unitCostsAtSale`, the same helper the
 * checkout and the webhook use, and nothing here can change what a piece costs.
 * It moves stock, but as a consequence of a parcel being packed rather than as
 * a count of a shelf.
 *
 * "orders" is also the capability Packing holds, and packing a scoop is
 * literally the job that role exists for. Guarding this with "catalogue" or
 * "inventory" would lock the packing helper out of the one screen she is there
 * to use — while `lib/auth/staff.ts`'s promise, that Packing never sees a cost
 * or a margin, is kept where it is actually kept: the panel does not RENDER a
 * cost to a role without "reports". The action reading one on the server is not
 * the same thing as showing it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * PRESSING SAVE TWICE MUST NOT TAKE THE SAME PIECES OFF THE SHELF TWICE.
 * `scoop_packs.stock_applied` is the claim flag 0007 provides for exactly this,
 * and it is used the way `orders.stock_applied` is used in the Stripe webhook:
 * a compare-and-set taken BEFORE any decrement, and handed back only while
 * nothing has landed yet. Once the claim is spent this action will not touch
 * the pieces or the stock again — a second press saves the video link and says
 * so.
 */
export async function recordScoopPack(_prev: FormState, form: FormData): Promise<FormState> {
  return guard("orders", async () => {
    const staff = await requireStaff("orders");
    const admin = createAdminClient();

    const orderItemId = text(form, "order_item_id");
    if (!orderItemId) return fail("No scoop given.");

    const packIndex = Number.parseInt(text(form, "pack_index"), 10);
    if (!Number.isFinite(packIndex) || packIndex < 1) return fail("Which scoop is this?");

    // The order id comes off the line, never off the form. It decides what gets
    // revalidated, and a request body is not allowed to steer that.
    const { data: lineRow, error: lineError } = await admin
      .from("order_items")
      .select(
        "id, order_id, quantity, scoop_tier_id, orders(status), scoop_tiers(piece_count)",
      )
      .eq("id", orderItemId)
      .maybeSingle();

    if (lineError) return fail(friendly(lineError.message));
    if (!lineRow) return fail("That order line no longer exists.");
    if (!lineRow.scoop_tier_id) {
      return fail("That line is not a Lucky Scoop, so there is nothing to pack.");
    }

    /*
     * Not for a cancelled order, and not for an unpaid checkout.
     *
     * Recording a pack takes real pieces off the shelf. On a cancelled order —
     * including the one the studio is told not to post because the payment
     * cleared against it and is owed back — nothing is going in a bag, so the
     * decrement would be pure drift in the stock count. `pending` is not an
     * order at all; it is a checkout somebody abandoned.
     */
    const orderRow = Array.isArray(lineRow.orders) ? lineRow.orders[0] : lineRow.orders;
    const orderStatus = (orderRow?.status as string) ?? "";
    if (orderStatus === "cancelled") {
      return fail(
        "This order is cancelled, so nothing should be packed for it. Recording " +
          "a scoop would take the pieces off the shelf for a parcel that is not going out.",
      );
    }
    if (orderStatus === "pending") {
      return fail("This is an unpaid checkout, not an order. There is nothing to pack.");
    }

    const quantity = Math.max(1, Number(lineRow.quantity ?? 1));
    if (packIndex > quantity) {
      return fail(`This line is ${quantity} scoop${quantity === 1 ? "" : "s"}, so there is no scoop ${packIndex}.`);
    }

    const tier = Array.isArray(lineRow.scoop_tiers) ? lineRow.scoop_tiers[0] : lineRow.scoop_tiers;
    const orderId = lineRow.order_id as string;

    const videoUrl = text(form, "video_url") || null;
    if (videoUrl && videoUrl.length > 500) {
      return fail("That video link is too long to store. Paste the short share link instead.");
    }
    const note = text(form, "note") || null;
    if (note && note.length > 2000) return fail("That note is longer than this field can hold.");

    const { data: existing, error: existingError } = await admin
      .from("scoop_packs")
      .select("id, stock_applied")
      .eq("order_item_id", orderItemId)
      .eq("pack_index", packIndex)
      .maybeSingle();
    if (existingError) return fail(friendly(existingError.message));

    /*
     * Already recorded: the video link and the note are still hers to change —
     * she films after the parcel is packed — but the pieces and the stock are
     * settled. Undoing a stock movement needs a compensating one, which nothing
     * in this shop has, so this refuses to pretend rather than quietly writing a
     * new piece list over a claim that has already been spent.
     */
    if (existing?.stock_applied) {
      const { error } = await admin
        .from("scoop_packs")
        .update({ video_url: videoUrl, note })
        .eq("id", existing.id as string);
      if (error) return fail(friendly(error.message));

      revalidatePath(`/admin/orders/${orderId}`);
      return ok(
        "This scoop was already recorded and its stock has come off, so the " +
          "pieces were left alone. The video link and the note are saved.",
      );
    }

    /*
     * The pieces, as parallel arrays — the shape the measuring screen uses. The
     * lengths are checked against each other rather than against a fixed count:
     * a pool is however big she made it, and the panel renders one row per pool
     * product plus a slot for something that was not in the pool at all.
     */
    const productIds = form.getAll("piece_product").map(String);
    const quantities = form.getAll("piece_quantity").map(String);
    if (productIds.length !== quantities.length) {
      return fail("That form was incomplete. Reload the page and try again.");
    }

    const pieces = new Map<string, number>();
    for (let i = 0; i < productIds.length; i += 1) {
      const productId = productIds[i].trim();
      const raw = quantities[i].trim();
      if (!productId) {
        // A quantity typed against the "something else" slot with no product
        // chosen. Refused rather than dropped: this is the one row where the
        // number and the product are typed separately.
        if (raw !== "" && Number(raw) > 0) {
          return fail("There is a number typed with no product chosen. Pick the piece, or clear the number.");
        }
        continue;
      }
      if (raw === "") continue;

      const count = Number(raw);
      if (!Number.isInteger(count) || count < 0) {
        return fail("How many of each piece went in has to be a whole number.");
      }
      if (count === 0) continue;
      // Two of the same charm is one row with a quantity of 2 (0007), so the
      // same product listed twice adds up rather than colliding on the key.
      pieces.set(productId, (pieces.get(productId) ?? 0) + count);
    }

    if (pieces.size === 0) {
      return fail(
        "Nothing has been recorded — put a number against at least one piece. " +
          "This is what takes the stock off and what makes the margin real.",
      );
    }

    const ids = [...pieces.keys()];
    const { data: known, error: knownError } = await admin
      .from("products")
      .select("id")
      .in("id", ids);
    if (knownError) return fail(friendly(knownError.message));
    if ((known?.length ?? 0) !== ids.length) {
      return fail("One of those products no longer exists. Reload the page and try again.");
    }

    /*
     * The cost of each piece AT THIS MOMENT, stamped onto the row. Null for a
     * piece nobody has measured, which makes the whole scoop's cost unknown
     * rather than cheap — `packCost` refuses a partial sum for the same reason
     * the reports refuse one.
     *
     * A piece that is not in the tier's pool is NOT refused. The migration says
     * why: a pool is a policy that is edited over time, and what went into a
     * parcel last week is a fact. The panel shows it back with a note.
     */
    const costs = await unitCostsAtSale(ids);

    let packId = existing?.id as string | undefined;
    if (!packId) {
      const { data: created, error } = await admin
        .from("scoop_packs")
        .insert({
          order_item_id: orderItemId,
          pack_index: packIndex,
          // Copied from the tier rather than joined to it, so editing the tier
          // next month cannot change what this customer was promised.
          piece_count: Number(tier?.piece_count ?? 0) || 1,
          packed_by: staff.userId,
        })
        .select("id")
        .single();

      if (error) {
        // 23505 on (order_item_id, pack_index) is the double-press this table's
        // unique constraint exists to catch. Take up the row the other press
        // made rather than reporting a failure for work that succeeded.
        if (error.code !== "23505") return fail(friendly(error.message));
        const { data: raced } = await admin
          .from("scoop_packs")
          .select("id, stock_applied")
          .eq("order_item_id", orderItemId)
          .eq("pack_index", packIndex)
          .maybeSingle();
        if (!raced) return fail(friendly(error.message));
        if (raced.stock_applied) {
          return ok("This scoop had already been recorded, so nothing was changed.");
        }
        packId = raced.id as string;
      } else {
        packId = created.id as string;
      }
    }

    // Replaced wholesale: this only ever runs before the claim is taken, so
    // there is no stock movement to keep in step with it, and a piece taken off
    // the list has to actually disappear.
    const { error: clearError } = await admin
      .from("scoop_pack_items")
      .delete()
      .eq("pack_id", packId);
    if (clearError) return fail(friendly(clearError.message));

    const { error: itemsError } = await admin.from("scoop_pack_items").insert(
      [...pieces].map(([productId, count]) => ({
        pack_id: packId,
        product_id: productId,
        quantity: count,
        unit_cost_cents: costs.get(productId) ?? null,
      })),
    );
    if (itemsError) return fail(friendly(itemsError.message));

    /*
     * THE CLAIM. Compare-and-set on `stock_applied`, taken before a single unit
     * moves, exactly as `claimStock` does in the Stripe webhook. Two presses
     * race here and one of them updates no rows — that one decrements nothing.
     */
    const { data: claimed, error: claimError } = await admin
      .from("scoop_packs")
      .update({
        stock_applied: true,
        video_url: videoUrl,
        note,
        packed_at: new Date().toISOString(),
        packed_by: staff.userId,
      })
      .eq("id", packId)
      .eq("stock_applied", false)
      .select("id");

    if (claimError) return fail(friendly(claimError.message));
    if (!claimed || claimed.length === 0) {
      revalidatePath(`/admin/orders/${orderId}`);
      return ok("This scoop had already been recorded, so no stock was taken twice.");
    }

    let applied = 0;
    let oversoldUnits = 0;
    for (const [productId, count] of pieces) {
      const { data: shortfall, error } = await admin.rpc("decrement_stock", {
        p_product_id: productId,
        p_quantity: count,
      });

      if (error) {
        console.error(
          `[admin] Stock decrement failed for scoop pack ${packId}, product ` +
            `${productId} (${applied} piece(s) already applied):`,
          error.message,
        );
        if (applied === 0) {
          // Nothing has landed, so the claim can go back and the whole movement
          // can be attempted again cleanly. Once one decrement has gone through,
          // releasing would let a retry double-count it — the webhook's rule.
          await admin
            .from("scoop_packs")
            .update({ stock_applied: false })
            .eq("id", packId)
            .eq("stock_applied", true);
          return fail(
            "The stock did not move, so nothing has been recorded as packed. " +
              "Try again in a moment.",
          );
        }
        revalidatePath(`/admin/orders/${orderId}`);
        revalidatePath("/admin/inventory");
        return fail(
          `The pieces are recorded, but the stock count only moved for ${applied} of ` +
            `${pieces.size}. Correct the rest on the inventory page.`,
        );
      }

      applied += 1;
      // An oversell is not an error in this shop (0005) — it is a print-this-
      // first signal. For a scoop it is also the sentence that says the bowl was
      // emptier than the screen thought, which is worth knowing before the next
      // one is sold.
      oversoldUnits += Math.max(0, Number(shortfall ?? 0));
    }

    /*
     * The line's cost each, from what actually went in.
     *
     * Only written when EVERY scoop on the line has been recorded and every
     * piece in every one of them has a measured cost. A line of two scoops has
     * one `unit_cost_cents`, so the figure is the two packs' total divided by
     * the two — exact arithmetic on real numbers, not an average standing in for
     * a gap. Anything short of that leaves the column alone rather than writing
     * a total that understates itself.
     */
    const { data: allPacks } = await admin
      .from("scoop_packs")
      .select("id, scoop_pack_items(product_id, quantity, unit_cost_cents)")
      .eq("order_item_id", orderItemId);

    if ((allPacks?.length ?? 0) === quantity) {
      let total = 0;
      let allMeasured = true;
      for (const pack of allPacks ?? []) {
        const cost = packCost(
          ((pack.scoop_pack_items ?? []) as Record<string, unknown>[]).map((item) => ({
            productId: item.product_id as string,
            quantity: Number(item.quantity ?? 0),
            unitCostCents:
              item.unit_cost_cents === null || item.unit_cost_cents === undefined
                ? null
                : Number(item.unit_cost_cents),
          })),
        );
        if (cost === null) {
          allMeasured = false;
          break;
        }
        total += cost;
      }

      if (allMeasured) {
        await admin
          .from("order_items")
          .update({ unit_cost_cents: Math.round(total / quantity) })
          .eq("id", orderItemId);
      }
    }

    revalidatePath(`/admin/orders/${orderId}`);
    revalidatePath("/admin/orders");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/scoops");
    revalidatePath("/admin/reports");

    const oversoldNote =
      oversoldUnits > 0
        ? ` ${oversoldUnits} of them went past what the shelf said was there — print those first.`
        : "";

    /*
     * What this scoop cost is either known or it is not, and the message says
     * which. A piece nobody has measured makes the whole pack's cost unknown
     * rather than cheap (`packCost` refuses a partial sum), and telling her it
     * is "costed" when one piece is missing is the plausible-looking claim this
     * project treats as a defect.
     */
    const unmeasured = ids.filter((productId) => costs.get(productId) === null).length;

    return ok(
      unmeasured > 0
        ? `Recorded, and the stock is off the shelf. What it cost is still unknown — ` +
            `${unmeasured} of the pieces that went in ${unmeasured === 1 ? "has" : "have"} ` +
            `never been measured.${oversoldNote}`
        : `Recorded. The stock is off the shelf and this scoop is costed.${oversoldNote}`,
    );
  });
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
  if (lower.includes("scoop_tiers_slug_key")) return "Another scoop tier already uses that web address.";
  if (lower.includes("scoop_tiers_activation_check")) {
    return (
      "A tier cannot be listed in the shop without a price and a packed weight. " +
      "Fill both in, or keep it as a draft."
    );
  }
  // `scoop_tier_pool_is_big_enough` raises its own sentence, naming the tier and
  // both numbers, and carries a hint. Passing it through says more than any
  // replacement would.
  if (lower.includes("violates foreign key") && lower.includes("colour")) {
    return "That colour is used by a product, so it cannot be deleted. Turn it off instead.";
  }
  return message;
}
