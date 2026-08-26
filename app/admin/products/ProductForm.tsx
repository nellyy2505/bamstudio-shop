"use client";

import { useState } from "react";
import { AdminForm, SubmitButton } from "../AdminForm";
import { saveProduct } from "../actions";
import { Button, Field, Icon, cx, inputClass } from "@/components/ui";
import type { Accessory, ColourRow, ProductDetail } from "../data";

/**
 * The product form.
 *
 * A client component for one reason only: the filament recipe is a list of rows
 * a person adds to and removes from, and that is state. Everything else here is
 * a plain input inside a plain form — the values come in as props from the
 * server and go back out through `saveProduct`, which re-validates all of them.
 *
 * Nothing on this page is trusted. The form can be edited in a browser's
 * developer tools; the action treats every field as if it had been.
 */
export function ProductForm({
  product,
  colours,
  accessories,
  defaultBuffer,
}: {
  product: ProductDetail | null;
  colours: ColourRow[];
  accessories: Accessory[];
  defaultBuffer: number;
}) {
  const [recipe, setRecipe] = useState<{ colourId: string; grams: string }[]>(
    product?.filament.map((f) => ({ colourId: f.colourId, grams: String(f.grams) })) ?? [],
  );

  const usable = colours.filter((c) => c.active || recipe.some((r) => r.colourId === c.id));

  return (
    <AdminForm action={saveProduct} className="gap-6">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      <Panel title="What it is">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="name" hint="What a customer sees.">
            <input id="name" name="name" defaultValue={product?.name ?? ""} className={inputClass} required />
          </Field>
          <Field label="Short name" htmlFor="short_name" hint="For tight spaces, like the cart.">
            <input id="short_name" name="short_name" defaultValue={product?.shortName ?? ""} className={inputClass} />
          </Field>
          <Field label="SKU" htmlFor="sku" hint="How your spreadsheet finds it. CLK-014, KEY-H02.">
            <input id="sku" name="sku" defaultValue={product?.sku ?? ""} className={`${inputClass} font-mono`} required />
          </Field>
          <Field label="Web address" htmlFor="slug" hint="bamstudio.com/product/…">
            <input id="slug" name="slug" defaultValue={product?.slug ?? ""} className={`${inputClass} font-mono`} required />
          </Field>
          <Field label="Category" htmlFor="category">
            <input id="category" name="category" defaultValue={product?.category ?? ""} className={inputClass} list="admin-categories" />
          </Field>
          <Field label="Theme" htmlFor="theme">
            <input id="theme" name="theme" defaultValue={product?.theme ?? ""} className={inputClass} />
          </Field>
        </div>

        <Field label="Description" htmlFor="description" hint="A sentence or two. This is the shop's own words about the piece.">
          <textarea
            id="description"
            name="description"
            defaultValue={product?.description ?? ""}
            rows={4}
            className={`${inputClass} h-auto py-3`}
          />
        </Field>
      </Panel>

      <Panel
        title="What it costs to make"
        note="These two are what every price in the studio is worked out from. Leave one blank and the piece has no cost — which is honest, not broken."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Print time"
            htmlFor="print_time_hours"
            hint="Hours, as the slicer reports it. 0.75 is 45 minutes. Blank means not timed yet."
          >
            <input
              id="print_time_hours"
              name="print_time_hours"
              type="number"
              step="0.001"
              min="0"
              defaultValue={product?.printTimeHours ?? ""}
              className={inputClass}
              placeholder="not timed yet"
            />
          </Field>
          <Field label="Accessory" htmlFor="accessory_id" hint="The keyring, clasp or clicker that goes on it.">
            <select id="accessory_id" name="accessory_id" defaultValue={product?.accessoryId ?? ""} className={inputClass}>
              <option value="">None</option>
              {accessories.map((accessory) => (
                <option key={accessory.id} value={accessory.id}>
                  {accessory.name}
                  {accessory.costCents > 0 ? ` — ${accessory.costCents}c` : " — not costed yet"}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="mt-2">
          <legend className="mb-2 text-[13.5px] font-extrabold">Filament, colour by colour</legend>
          <p className="mb-3 text-[13px] text-muted">
            Grams of each colour one piece uses. This is what the buy list adds up, so a colour
            missing here is filament nobody orders.
          </p>

          <div className="flex flex-col gap-2">
            {recipe.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  name="filament_colour"
                  value={line.colourId}
                  onChange={(event) => {
                    const next = [...recipe];
                    next[index] = { ...next[index], colourId: event.target.value };
                    setRecipe(next);
                  }}
                  /* min-w-0 matters: a flex item will not shrink below its
                     content width without it, and inputClass carries w-full,
                     which fights flex-1 for the basis. Together they collapsed
                     the colour name to an unreadable sliver. */
                  className={`${inputClass} !w-auto min-w-0 flex-1`}
                >
                  <option value="">Choose a colour</option>
                  {usable.map((colour) => (
                    <option key={colour.id} value={colour.id}>
                      {colour.name}
                      {colour.active ? "" : " (turned off)"}
                    </option>
                  ))}
                </select>
                <input
                  name="filament_grams"
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.grams}
                  onChange={(event) => {
                    const next = [...recipe];
                    next[index] = { ...next[index], grams: event.target.value };
                    setRecipe(next);
                  }}
                  className={`${inputClass} !w-24 shrink-0`}
                  placeholder="grams"
                  aria-label="Grams"
                />
                <button
                  type="button"
                  onClick={() => setRecipe(recipe.filter((_, i) => i !== index))}
                  aria-label="Remove this colour"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line2 text-muted hover:border-ink hover:text-ink"
                >
                  <Icon name="minus" size={17} />
                </button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="soft"
            size="sm"
            className="mt-3"
            onClick={() => setRecipe([...recipe, { colourId: "", grams: "" }])}
          >
            <Icon name="plus" size={16} />
            Add a colour
          </Button>

          {recipe.length > 0 ? (
            <p className="mt-3 text-[13px] font-semibold">
              Total: {recipe.reduce((sum, r) => sum + (Number(r.grams) || 0), 0).toFixed(2)} g
            </p>
          ) : null}
        </fieldset>
      </Panel>

      <Panel title="Price and stock">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Price" htmlFor="price" hint="In dollars, GST included.">
            <input
              id="price"
              name="price"
              defaultValue={product ? (product.price / 100).toFixed(2) : ""}
              className={inputClass}
              inputMode="decimal"
              required
            />
          </Field>
          <Field label="On the shelf" htmlFor="stock_on_hand">
            <input id="stock_on_hand" name="stock_on_hand" type="number" min="0" defaultValue={product?.stockOnHand ?? 0} className={inputClass} />
          </Field>
          <Field label="Buffer" htmlFor="buffer_stock" hint="How many you like to have spare.">
            <input id="buffer_stock" name="buffer_stock" type="number" min="0" defaultValue={product?.bufferStock ?? defaultBuffer} className={inputClass} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Packed size and weight"
        note="Australia Post prices a parcel on its weight. These are for the piece in its mailer, not the piece on its own."
      >
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Weight (g)" htmlFor="weight_grams">
            <input id="weight_grams" name="weight_grams" type="number" min="1" defaultValue={product?.weightGrams ?? 60} className={inputClass} required />
          </Field>
          <Field label="Length (mm)" htmlFor="length_mm">
            <input id="length_mm" name="length_mm" type="number" min="1" defaultValue={product?.lengthMm ?? 100} className={inputClass} />
          </Field>
          <Field label="Width (mm)" htmlFor="width_mm">
            <input id="width_mm" name="width_mm" type="number" min="1" defaultValue={product?.widthMm ?? 80} className={inputClass} />
          </Field>
          <Field label="Thickness (mm)" htmlFor="thickness_mm">
            <input id="thickness_mm" name="thickness_mm" type="number" min="1" defaultValue={product?.thicknessMm ?? 20} className={inputClass} />
          </Field>
        </div>
      </Panel>

      <Panel title="Where it sells">
        <div className="flex flex-col gap-3">
          <Check name="active" label="Listed in the online shop" defaultChecked={product?.active ?? true} />
          <Check
            name="on_market_stall"
            label="Goes to market stalls"
            hint="The stall has less table space than the website, so this is usually a smaller list."
            defaultChecked={product?.onMarketStall ?? false}
          />
          <Check name="is_bestseller" label="Show as a bestseller" defaultChecked={product?.isBestseller ?? false} />
          <Check name="is_new" label="Show as new" defaultChecked={product?.isNew ?? false} />
        </div>
      </Panel>

      {!product ? (
        <input type="hidden" name="art" value="macaron" />
      ) : (
        <>
          <input type="hidden" name="art" value={product.art} />
          <input type="hidden" name="tint" value={product.tint} />
        </>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton>{product ? "Save changes" : "Create product"}</SubmitButton>
        <span className="text-[13px] text-muted">
          Saving recalculates the cost, the queue and the buy list.
        </span>
      </div>
    </AdminForm>
  );
}

/**
 * A panel, duplicated from app/admin/ui.tsx rather than imported.
 *
 * ui.tsx is a server component file; importing it into this "use client" module
 * would drag it — and everything it imports — into the browser bundle. Two
 * small copies of a bordered box is the cheaper mistake.
 */
function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[17px]">{title}</h2>
        {note ? <p className="mt-0.5 text-[13px] text-muted">{note}</p> : null}
      </div>
      <div className="flex flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

function Check({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3")}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
      />
      <span>
        <span className="text-[14.5px] font-semibold">{label}</span>
        {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
