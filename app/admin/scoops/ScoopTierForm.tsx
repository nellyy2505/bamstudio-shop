import Link from "next/link";
import { AdminForm, SubmitButton } from "../AdminForm";
import { saveScoopTier } from "../actions";
import { Panel, Unknown } from "../ui";
import { Alert, Field, Pill, inputClass } from "@/components/ui";
import { money, pluralise } from "@/lib/format";
import { SCOOP_THEMES } from "@/lib/types";
import type { PoolCandidate, ScoopTierRow } from "../data";

/**
 * The tier form: everything about a scoop that is hers to set.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A SERVER COMPONENT, unlike ProductForm next door.
 *
 * That one is a client component for one reason — its filament recipe is a list
 * of rows a person adds to and removes from, which is state. Nothing here is.
 * The pool is a fixed set of checkboxes over a catalogue the server already
 * knows, so it stays on the server, and no product name, cost or stock count
 * reaches the browser bundle. `AdminForm` is the only client part, and it takes
 * these fields as children.
 *
 * THE SUGGESTED PRICE SITS BESIDE THE PRICE FIELD AND IS NEVER IN IT.
 *
 * `suggestedTierPrice` answers null unless EVERY product in the pool has been
 * measured, which today is every pool — 0 of 44 products have a cost. That null
 * is the point. It would be easy to average the pieces that have been measured
 * and print that number next to a field she is about to type into; two of twelve
 * measured makes it a guess dressed as arithmetic, and a guess in a price field
 * is the plausible-looking number this project treats as a defect. So the panel
 * says "3 of 12 pieces measured" instead, which is true and is also the nudge.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function ScoopTierForm({
  tier,
  products,
}: {
  /** Null when creating. */
  tier: ScoopTierRow | null;
  /** Every product, as a pool candidate. See `listPoolCandidates`. */
  products: PoolCandidate[];
}) {
  const chosen = new Set((tier?.pool ?? []).map((piece) => piece.productId));
  const pieceCount = tier?.pieceCount ?? 5;

  // Grouped so a forty-four-item list is scannable. The order is the read's —
  // category, then name — so the groups come out in one pass.
  const groups: { category: string; items: PoolCandidate[] }[] = [];
  for (const product of products) {
    const category = product.category || "Uncategorised";
    const last = groups[groups.length - 1];
    if (last && last.category === category) last.items.push(product);
    else groups.push({ category, items: [product] });
  }

  return (
    <AdminForm action={saveScoopTier} className="gap-6">
      {tier ? <input type="hidden" name="id" value={tier.id} /> : null}

      <Panel title="What it is">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="name" hint="What a customer sees. “Pet scoop, five pieces”.">
              <input id="name" name="name" defaultValue={tier?.name ?? ""} className={inputClass} required />
            </Field>
            <Field label="Web address" htmlFor="slug" hint="bamstudio.com/scoop/…">
              <input
                id="slug"
                name="slug"
                defaultValue={tier?.slug ?? ""}
                className={`${inputClass} font-mono`}
                required
              />
            </Field>
            <Field
              label="Theme"
              htmlFor="theme"
              hint="The customer chooses this; the draw only decides which pieces come out of it."
            >
              <select id="theme" name="theme" defaultValue={tier?.theme ?? "mixed"} className={inputClass}>
                {SCOOP_THEMES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Order in the list" htmlFor="sort_order" hint="Lowest first.">
              <input
                id="sort_order"
                name="sort_order"
                type="number"
                defaultValue={tier?.sortOrder ?? 0}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Blurb" htmlFor="blurb" hint="A sentence or two. Up to 600 characters.">
            <textarea
              id="blurb"
              name="blurb"
              rows={3}
              maxLength={600}
              defaultValue={tier?.blurb ?? ""}
              className={`${inputClass} h-auto py-3`}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="What it promises, and what it costs"
        note="The piece count is the promise. Leave the price empty until you have decided — that says “not priced yet”, which is a fact. It is never $0.00."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Pieces in a scoop"
            htmlFor="piece_count"
            hint="Five is where you started. The pool has to hold at least this many products before the tier can be switched on."
          >
            <input
              id="piece_count"
              name="piece_count"
              type="number"
              min="1"
              max="50"
              defaultValue={pieceCount}
              className={inputClass}
              required
            />
          </Field>

          <Field
            label="Price"
            htmlFor="price"
            hint="In dollars. Blank means nobody has priced it yet."
            action={<Suggestion tier={tier} />}
          >
            <input
              id="price"
              name="price"
              inputMode="decimal"
              /* The suggestion is never prefilled here, the same rule the
                 product form follows: a number the studio put in the box is a
                 number that gets saved without being decided on. */
              defaultValue={tier?.priceCents === null || tier === null ? "" : (tier.priceCents / 100).toFixed(2)}
              placeholder="not priced yet"
              className={inputClass}
            />
          </Field>
        </div>

        <CostBasisNote tier={tier} />
      </Panel>

      <Panel
        title="Packed size and weight"
        note="A scoop has no product row to take a weight from, so the tier carries its own — and it has to be the heaviest pack you would send, not the average. The studio wears the difference on every parcel that comes out heavier."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Packed weight (g)"
            htmlFor="packed_weight_grams"
            hint="Blank means nobody has put a test pack on the scales. A tier cannot be switched on without it."
          >
            <input
              id="packed_weight_grams"
              name="packed_weight_grams"
              type="number"
              min="1"
              defaultValue={tier?.packedWeightGrams ?? ""}
              placeholder="not weighed yet"
              className={inputClass}
            />
          </Field>
          <Field
            label="Packed thickness (mm)"
            htmlFor="packed_thickness_mm"
            hint="Australia Post checks it on a quote. A scoop always goes as a parcel, never a Large Letter."
          >
            <input
              id="packed_thickness_mm"
              name="packed_thickness_mm"
              type="number"
              min="1"
              defaultValue={tier?.packedThicknessMm ?? ""}
              placeholder="not measured yet"
              className={inputClass}
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="The pool"
        note="The pieces that may be drawn into this scoop. Tick them one by one — a category filter would let a pet bowl join a clicker scoop the day somebody re-files it."
      >
        {/* The sentinel. An unticked checkbox is absent from the payload, so
            without this a POST that simply omitted every pool field would read
            as "she cleared the pool" and empty a live tier. `saveScoopTier`
            refuses a payload without it. */}
        <input type="hidden" name="pool_submitted" value="1" />

        <div className="mb-4 flex flex-wrap items-center gap-3 text-[13.5px]">
          <Pill tone={chosen.size >= pieceCount ? "good" : "warn"}>
            {pluralise(chosen.size, "product")} in the pool
          </Pill>
          <span className="text-muted">
            {chosen.size >= pieceCount
              ? `Enough to promise ${pluralise(pieceCount, "piece")}.`
              : `A tier promising ${pluralise(pieceCount, "piece")} needs at least that many products in its pool.`}
          </span>
        </div>

        {products.length === 0 ? (
          <p className="text-[14px] text-muted">
            There is nothing in the catalogue to draw from yet.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <fieldset key={group.category}>
                <legend className="mb-2 text-[12px] font-extrabold tracking-[0.06em] text-faint">
                  {group.category.toUpperCase()}
                </legend>
                <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                  {group.items.map((product) => (
                    <PoolChoice
                      key={product.productId}
                      product={product}
                      checked={chosen.has(product.productId)}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        <Alert>
          Small things only — clickers, keyrings, magnets. One tier carries one packed weight, so a
          pool that can produce either a charm or a pet bowl has no honest weight to quote postage
          on.
        </Alert>
      </Panel>

      <Panel title="Where it sells">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="active"
            defaultChecked={tier?.active ?? false}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="text-[14.5px] font-semibold">Listed in the shop</span>
            <span className="block text-[13px] text-muted">
              A tier starts as a draft. It needs a price, a packed weight and a pool big enough to
              fill it before this can be ticked.
            </span>
          </span>
        </label>

        {tier && tier.activationBlockers.length > 0 ? (
          <div className="mt-4">
            <Alert tone="error">
              As saved, this tier cannot be switched on: {tier.activationBlockers.join(", and ")}.
            </Alert>
          </div>
        ) : null}

        {tier && tier.active && !tier.availability.sellable ? (
          <div className="mt-4">
            {/* Switched on but not sellable today. That is a stock fact, not a
                setting — the shopfront simply does not list it until the bowl
                can fill it again, and nothing needs changing here. */}
            <Alert>
              Switched on, but not being offered right now: {tier.availability.blockers.join(", and ")}.
              It comes back on its own as the shelf fills.
            </Alert>
          </div>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{tier ? "Save changes" : "Create this tier"}</SubmitButton>
        <span className="text-[13px] text-muted">
          Saving recalculates what the pool can fill and what the shop offers.
        </span>
      </div>
    </AdminForm>
  );
}

/**
 * What sits beside the price field.
 *
 * Three states, and the middle one is the one that matters: a pool that is only
 * partly measured produces NO number at all. See the note at the top of this
 * file, and `suggestedTierPrice` in lib/scoop.ts.
 */
function Suggestion({ tier }: { tier: ScoopTierRow | null }) {
  if (!tier || tier.availability.poolSize === 0) {
    return <span className="text-[12.5px] text-faint">Suggestion needs a measured pool</span>;
  }

  if (tier.suggestedPriceCents === null) {
    return (
      <span className="text-[12.5px] font-semibold text-warn">
        {tier.costBasis.measured} of {tier.availability.poolSize} pieces measured
      </span>
    );
  }

  return (
    <span className="text-[12.5px] font-semibold text-muted">
      Suggested {money(tier.suggestedPriceCents)}
    </span>
  );
}

/** The cost basis in a sentence, under the two fields it explains. */
function CostBasisNote({ tier }: { tier: ScoopTierRow | null }) {
  if (!tier) {
    return (
      <p className="mt-2 text-[13px] text-muted">
        Once the pool is chosen and every piece in it has been measured, a suggested price appears
        beside the field above.
      </p>
    );
  }

  const { costBasis, availability } = tier;

  if (availability.poolSize === 0) {
    return (
      <p className="mt-2 text-[13px] text-muted">
        Nothing in the pool yet, so there is nothing to work a cost out from.
      </p>
    );
  }

  if (costBasis.averagePieceCents === null) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <Unknown
          what={`${costBasis.unmeasured} of ${availability.poolSize} pieces have never been measured`}
        />
        <p className="text-[13px] text-muted">
          Until every piece in the pool has a print time and its filament grams there is no honest
          average, so there is no suggested price. Averaging only the ones that are measured would
          understate what a scoop costs to fill.{" "}
          <Link
            href="/admin/inventory/measure"
            className="font-bold text-accent hover:text-accent-dark"
          >
            Measure them
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <p className="mt-2 text-[13px] text-muted">
      Every piece in the pool is measured. One piece averages{" "}
      <b>{costBasis.averagePieceCents.toFixed(2)}c</b>, so {pluralise(tier.pieceCount, "piece")}{" "}
      costs about <b>{money(Math.round(costBasis.piecesCents ?? 0))}</b> to fill. The mailer is
      charged once per order and is not in that.
    </p>
  );
}

/**
 * One product in the picker.
 *
 * WHAT IS ON THIS ROW IS WHAT SHE IS ACTUALLY DECIDING ON: what one costs to
 * make, and how many are on the shelf. Nothing else — no description, no
 * gallery, no colours. Forty-four of these render at once, and the measure
 * screen's round-14 defect (1.2 MB of HTML, because every row shipped a whole
 * palette four times over) is what a fat picker becomes.
 */
function PoolChoice({ product, checked }: { product: PoolCandidate; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 hover:bg-cream">
      <input
        type="checkbox"
        name="pool"
        value={product.productId}
        defaultChecked={checked}
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold">
          {product.name}
          {product.active ? null : (
            <span className="ml-1.5 text-[12px] font-normal text-warn">turned off</span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <span className="font-mono text-faint">{product.sku}</span>
          <span className={product.stockOnHand > 0 ? "" : "text-warn"}>
            {product.stockOnHand > 0 ? `${product.stockOnHand} on the shelf` : "none on the shelf"}
          </span>
          {/* Null is "nobody has measured this", never 0c. A cost of nothing
              would make the whole pool look cheap to fill. */}
          {product.unitCostCents === null ? (
            <span className="font-semibold text-warn">not measured</span>
          ) : (
            <span>{money(product.unitCostCents)} each</span>
          )}
        </span>
      </span>
    </label>
  );
}
