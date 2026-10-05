"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth/staff";
import { checkEntry } from "@/lib/listings";

export type ImportResult = { ok: boolean; message: string; created?: boolean };

const PHOTO_BUCKET = "product-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Apply ONE listing from a listings file: its text fields and its photos.
 *
 * Called once per product by the import screen, so each request carries one
 * product's photos and stays well under the server-action body limit. Fields
 * absent from the entry are left alone; a listing file can never blank a column
 * by omission. A product is only CREATED when the entry carries everything a
 * new row needs (slug, name, price, weight, category); otherwise an unknown
 * SKU is refused, so a typo cannot quietly add a product.
 */
export async function importListing(form: FormData): Promise<ImportResult> {
  // First, before reading anything: this is a public endpoint like every action.
  await requireStaff("catalogue");

  try {
    const raw = form.get("entry");
    if (typeof raw !== "string") return { ok: false, message: "No listing given." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, message: "The listing was not valid JSON." };
    }
    const checked = checkEntry(parsed);
    if ("error" in checked) return { ok: false, message: checked.error };
    const entry = checked.entry;

    const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    for (const file of files) {
      if (!PHOTO_TYPES.includes(file.type)) {
        return { ok: false, message: `${file.name} is not a JPEG, PNG, WebP or AVIF.` };
      }
      if (file.size > MAX_PHOTO_BYTES) {
        return { ok: false, message: `${file.name} is over 5 MB.` };
      }
    }

    const admin = createAdminClient();
    const { data: existing, error: readError } = await admin
      .from("products")
      .select("id, slug, name, photos")
      .eq("sku", entry.sku)
      .maybeSingle();
    if (readError) return { ok: false, message: readError.message };

    const patch: Record<string, unknown> = {};
    if (entry.name !== undefined) patch.name = entry.name;
    if (entry.short_name !== undefined) patch.short_name = entry.short_name;
    if (entry.description !== undefined) patch.description = entry.description;
    if (entry.details !== undefined) patch.details = entry.details;
    if (entry.category !== undefined) patch.category = entry.category;
    if (entry.theme !== undefined) patch.theme = entry.theme;
    if (entry.price !== undefined) patch.price = Math.round(entry.price * 100);
    if (entry.weight_grams !== undefined) patch.weight_grams = entry.weight_grams;
    if (entry.active !== undefined) patch.active = entry.active;
    if (entry.is_new !== undefined) patch.is_new = entry.is_new;
    if (entry.is_bestseller !== undefined) patch.is_bestseller = entry.is_bestseller;

    let id: string;
    let slug: string;
    let name: string;
    let photos: { path: string; alt: string }[];
    let created = false;

    if (existing) {
      id = existing.id as string;
      slug = existing.slug as string;
      name = (entry.name ?? existing.name) as string;
      photos = (Array.isArray(existing.photos) ? existing.photos : []) as { path: string; alt: string }[];
      if (Object.keys(patch).length > 0) {
        const { error } = await admin.from("products").update(patch).eq("id", id);
        if (error) return { ok: false, message: friendly(error.message) };
      }
    } else {
      if (!entry.slug || !entry.name || entry.price === undefined || !entry.weight_grams || !entry.category) {
        return {
          ok: false,
          message: `${entry.sku} is not in the catalogue. To add it, give slug, name, price, weight_grams and category.`,
        };
      }
      const { data, error } = await admin
        .from("products")
        .insert({
          sku: entry.sku,
          slug: entry.slug,
          short_name: entry.short_name ?? entry.name,
          theme: entry.theme ?? "",
          description: entry.description ?? "",
          art: "macaron",
          tint: "cream",
          // New products stay hidden until someone ticks them on, unless the
          // file says otherwise: a half-checked import should not go live.
          active: entry.active ?? false,
          ...patch,
        })
        .select("id, slug")
        .single();
      if (error) return { ok: false, message: friendly(error.message) };
      id = data.id as string;
      slug = data.slug as string;
      name = entry.name;
      photos = [];
      created = true;
    }

    // Photos: upload, then write the list in one update.
    if (files.length > 0) {
      const added: { path: string; alt: string }[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const extension = file.type.split("/")[1].replace("jpeg", "jpg");
        const path = `${id}/${randomBytes(8).toString("hex")}.${extension}`;
        const { error } = await admin.storage
          .from(PHOTO_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (error) {
          // Tidy what this call already uploaded, then stop.
          if (added.length) await admin.storage.from(PHOTO_BUCKET).remove(added.map((a) => a.path));
          return { ok: false, message: `Photo upload failed: ${error.message}` };
        }
        added.push({ path, alt: entry.photo_alt?.[i]?.trim() || `${name}, photo ${i + 1}` });
      }

      const replace = entry.replace_photos === true;
      const next = replace ? added : [...photos, ...added];
      const { error } = await admin.from("products").update({ photos: next }).eq("id", id);
      if (error) {
        await admin.storage.from(PHOTO_BUCKET).remove(added.map((a) => a.path));
        return { ok: false, message: friendly(error.message) };
      }
      if (replace && photos.length > 0) {
        // The rows no longer point at these, so removing them breaks nothing.
        await admin.storage.from(PHOTO_BUCKET).remove(photos.map((p) => p.path));
      }
    }

    revalidatePath("/");
    revalidatePath("/shop");
    revalidatePath(`/product/${slug}`);
    revalidatePath("/admin/products");
    revalidatePath(`/admin/products/${id}`);

    const bits = [
      Object.keys(patch).length ? "details updated" : null,
      files.length ? `${files.length} photo${files.length === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    return {
      ok: true,
      created,
      message: `${created ? "Created" : "Updated"}${bits.length ? `: ${bits.join(", ")}` : ""}.`,
    };
  } catch (error) {
    console.error("[admin import]", error);
    return { ok: false, message: error instanceof Error ? error.message : "Something went wrong." };
  }
}

function friendly(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("products_sku_key")) return "Another product already uses that SKU.";
  if (lower.includes("products_slug_key")) return "Another product already uses that web address (slug).";
  return message;
}
