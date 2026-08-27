import { AdminForm, SubmitButton } from "../../AdminForm";
import { recordScoopPack } from "../../actions";
import { Panel, Unknown } from "../../ui";
import { Alert, Field, Pill, inputClass } from "@/components/ui";
import { formatDate, money, pluralise } from "@/lib/format";
import type {
  OrderScoopLine,
  OrderScoops,
  PoolCandidate,
  ScoopPackRow,
} from "../../data";

/**
 * Where a scoop stops being random.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS PANEL IS THE ONE THAT SETTLES THE MONEY.
 *
 * Every other line on this order was costed before it sold: the piece has a
 * recipe, `unitCostsAtSale()` reads it, and `order_items.unit_cost_cents` is
 * stamped at checkout. A scoop is sold FIRST and decided AFTERWARDS — at the
 * moment money changed hands nobody knew what was going in the bag — so there
 * was nothing to cost it from and nothing to take off the shelf.
 *
 * Both of those happen here. Recording a pack decrements the stock of every
 * piece that went in and stamps what each one cost at that moment, which is
 * what makes the margin on a scoop measured rather than assumed. It is also why
 * the order cannot be marked posted until this is done: once the bag is sealed
 * and in the post, nobody can go back and look.
 *
 * SAFE TO PRESS TWICE. `scoop_packs.stock_applied` is a claim flag, taken by a
 * compare-and-set before a single unit moves — the same shape
 * `orders.stock_applied` uses in the Stripe webhook. A second press does not
 * re-record and does not decrement again; it saves the video link and says so.
 *
 * WHAT PACKING SEES. `showCosts` is the order page's own gate, held by roles
 * with "reports". A packing helper records what went in and moves the stock —
 * the action is guarded by "orders", which she holds — and never sees a cost.
 * The shelf counts are shown to everyone, because they are what the job needs.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function ScoopPackPanel({
  scoops,
  showCosts,
  catalogue,
  orderStatus,
}: {
  scoops: OrderScoops;
  showCosts: boolean;
  /** The whole catalogue, for the "something else went in" slot. */
  catalogue: PoolCandidate[];
  /**
   * The order's own status. Recording a pack takes real pieces off the shelf,
   * so a cancelled order — or an abandoned checkout — has nothing to pack, and
   * `recordScoopPack` refuses both. What was already packed still shows: a
   * cancelled order can be one that was packed and then called off, and what
   * went in it is still a fact.
   */
  orderStatus: string;
}) {
  if (scoops.unreadable) {
    return (
      <Panel title="What went in the scoop">
        <Alert tone="error">
          The Lucky Scoops on this order could not be read just now, so nothing about them can be
          shown or recorded — and the order cannot be marked posted until it can. Reload the page.
        </Alert>
      </Panel>
    );
  }

  // Nothing drawn on an order with no scoops on it. A panel saying "no scoops
  // here" is a claim this page would then have to keep true.
  if (scoops.lines.length === 0) return null;

  const packable = orderStatus !== "cancelled" && orderStatus !== "pending";

  return (
    <div className="flex flex-col gap-5">
      {scoops.lines.map((line) => (
        <ScoopLinePanel
          key={line.orderItemId}
          line={line}
          showCosts={showCosts}
          catalogue={catalogue}
          packable={packable}
        />
      ))}
    </div>
  );
}

function ScoopLinePanel({
  line,
  showCosts,
  catalogue,
  packable,
}: {
  line: OrderScoopLine;
  showCosts: boolean;
  catalogue: PoolCandidate[];
  packable: boolean;
}) {
  const drawable = line.pool.filter((piece) => piece.active && piece.stockOnHand > 0).length;

  return (
    <Panel
      title={
        line.quantity > 1
          ? `${line.tierName} — ${pluralise(line.quantity, "scoop")}`
          : line.tierName
      }
      note={`${pluralise(line.pieceCount, "piece")} promised, drawn from ${pluralise(
        line.pool.length,
        "product",
      )} — ${drawable} of them with something on the shelf.`}
      padded={false}
    >
      <div className="divide-y divide-line">
        {line.packs.map((pack) => (
          <div key={pack.packIndex} className="p-5">
            {line.packs.length > 1 ? (
              <h3 className="mb-3 text-[13px] font-extrabold tracking-[0.04em] text-faint">
                SCOOP {pack.packIndex} OF {line.packs.length}
              </h3>
            ) : null}

            {pack.recordedPieces > 0 ? (
              <Recorded pack={pack} line={line} showCosts={showCosts} packable={packable} />
            ) : packable ? (
              <RecordForm pack={pack} line={line} showCosts={showCosts} catalogue={catalogue} />
            ) : (
              <p className="text-[14px] text-muted">
                Nothing was packed for this scoop, and this order is not one that can be
                packed — nothing is going in a bag, so no pieces come off the shelf for it.
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** A scoop that has been packed: what went in it, and what it cost. */
function Recorded({
  pack,
  line,
  showCosts,
  packable,
}: {
  pack: ScoopPackRow;
  line: OrderScoopLine;
  showCosts: boolean;
  packable: boolean;
}) {
  const short = pack.recordedPieces < pack.pieceCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <Pill tone="good">Packed</Pill>
        <span className="text-[13px] text-muted">
          {pluralise(pack.recordedPieces, "piece")} recorded
          {short ? ` — the tier promised ${pack.pieceCount}` : ""}
          {pack.packedAt ? ` · ${formatDate(pack.packedAt)}` : ""}
        </span>
        {pack.stockApplied ? null : (
          // Only reachable if a row was edited by hand: the action always takes
          // the claim in the same save that writes the pieces.
          <Pill tone="warn">stock has not come off</Pill>
        )}
      </div>

      <ul className="flex flex-col gap-1.5 text-[14px]">
        {pack.items.map((item) => (
          <li key={item.productId} className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="font-semibold">{item.name}</span>{" "}
              <span className="font-mono text-[12.5px] text-faint">{item.sku}</span>
              {item.quantity > 1 ? (
                <span className="ml-1.5 text-[13px] text-muted">× {item.quantity}</span>
              ) : null}
              {item.offPool ? (
                /* Not a rule violation. A pool is a policy that gets edited; what
                   went in a parcel is a fact. Noted so she can see it, never
                   refused — 0007 says so in as many words. */
                <span className="ml-2 text-[12.5px] text-muted">not in the pool now</span>
              ) : null}
            </span>
            {showCosts ? (
              <span className="tabular-nums">
                {item.unitCostCents === null ? (
                  <Unknown what="Not measured" />
                ) : (
                  `${money(item.unitCostCents)} each`
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {showCosts ? (
        <div className="flex items-baseline justify-between border-t border-line pt-3 text-[14px]">
          <span className="font-extrabold">What this scoop cost to fill</span>
          {pack.costCents === null ? (
            // Never a partial sum. Adding up the pieces that happen to be
            // measured understates the scoop by whatever the rest cost, and the
            // margin computed from it is wrong in the flattering direction.
            <Unknown what="A piece in it has never been measured" />
          ) : (
            <span className="font-display text-[17px] font-semibold tabular-nums">
              {money(pack.costCents)}
            </span>
          )}
        </div>
      ) : null}

      {packable ? (
        <div className="border-t border-line pt-4">
          <AdminForm action={recordScoopPack}>
          <input type="hidden" name="order_item_id" value={line.orderItemId} />
          <input type="hidden" name="pack_index" value={pack.packIndex} />

          <Field
            label="Video of the draw"
            htmlFor={`video_${pack.id}`}
            hint="Optional, and nothing on the shop promises one. Paste the link when you have filmed it."
          >
            <input
              id={`video_${pack.id}`}
              name="video_url"
              type="text"
              defaultValue={pack.videoUrl ?? ""}
              placeholder="not filmed yet"
              className={inputClass}
            />
          </Field>

          <Field label="Note" htmlFor={`note_${pack.id}`} hint="Anything worth remembering about this one.">
            <input
              id={`note_${pack.id}`}
              name="note"
              type="text"
              defaultValue={pack.note ?? ""}
              className={inputClass}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="soft" size="sm" pendingLabel="Saving…">
              Save the video and note
            </SubmitButton>
            <span className="text-[13px] text-muted">
              The pieces and the stock are settled. Only these two can still change.
            </span>
          </div>
        </AdminForm>
      </div>
      ) : null}
    </div>
  );
}

/**
 * Recording one scoop.
 *
 * The pool is the list, with the shelf count beside each piece, because that is
 * what she is looking at while the bag is open. Every product carries a hidden
 * id next to its own quantity box, so the two arrays the action reads line up
 * however many boxes were left empty.
 */
function RecordForm({
  pack,
  line,
  showCosts,
  catalogue,
}: {
  pack: ScoopPackRow;
  line: OrderScoopLine;
  showCosts: boolean;
  catalogue: PoolCandidate[];
}) {
  const poolIds = new Set(line.pool.map((piece) => piece.productId));
  // The "something else" list deliberately excludes the pool, which is already
  // above it — a second copy of twelve products is twelve rows of payload buying
  // nothing.
  const others = catalogue.filter((product) => !poolIds.has(product.productId));

  return (
    <AdminForm action={recordScoopPack}>
      <input type="hidden" name="order_item_id" value={line.orderItemId} />
      <input type="hidden" name="pack_index" value={pack.packIndex} />

      {line.pool.length === 0 ? (
        <Alert tone="error">
          This tier has no pool, so there is nothing listed to draw from. Record what actually went
          in using the box at the bottom.
        </Alert>
      ) : null}

      <fieldset>
        <legend className="mb-1 text-[13.5px] font-extrabold">
          How many of each piece went in?
        </legend>
        <p className="mb-3 text-[13px] text-muted">
          Leave a piece blank if none of it went in. Two of the same charm is one line with a 2.
          Saving takes these off the shelf.
        </p>

        <div className="flex flex-col gap-1.5">
          {line.pool.map((piece) => (
            <div
              key={piece.productId}
              className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">
                  {piece.name}
                  {piece.active ? null : (
                    <span className="ml-1.5 text-[12px] font-normal text-warn">turned off</span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  <span className="font-mono text-faint">{piece.sku}</span>
                  <span className={piece.stockOnHand > 0 ? "" : "text-warn"}>
                    {piece.stockOnHand > 0
                      ? `${piece.stockOnHand} on the shelf`
                      : "none on the shelf"}
                  </span>
                  {showCosts ? (
                    piece.unitCostCents === null ? (
                      <span className="font-semibold text-warn">not measured</span>
                    ) : (
                      <span>{money(piece.unitCostCents)} each</span>
                    )
                  ) : null}
                </span>
              </span>

              <input type="hidden" name="piece_product" value={piece.productId} />
              <input
                name="piece_quantity"
                type="number"
                min="0"
                step="1"
                placeholder="0"
                aria-label={`How many ${piece.name} went in`}
                className={`${inputClass} !h-10`}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {others.length > 0 ? (
        <fieldset className="border-t border-line pt-4">
          <legend className="mb-1 text-[13.5px] font-extrabold">Something else went in</legend>
          <p className="mb-3 text-[13px] text-muted">
            A charm broke, or the last one had already gone. Record what she actually posted — the
            pool is a policy, this is a fact.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
            <select
              name="piece_product"
              defaultValue=""
              aria-label="Another piece that went in"
              className={`${inputClass} !h-10 min-w-0`}
            >
              <option value="">Nothing else</option>
              {others.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.name} — {product.sku}
                </option>
              ))}
            </select>
            <input
              name="piece_quantity"
              type="number"
              min="0"
              step="1"
              placeholder="0"
              aria-label="How many of that other piece went in"
              className={`${inputClass} !h-10`}
            />
          </div>
        </fieldset>
      ) : null}

      <div className="border-t border-line pt-4">
        <Field
          label="Video of the draw"
          htmlFor={`video_new_${line.orderItemId}_${pack.packIndex}`}
          hint="Optional. It can be added later, and the parcel can go out without it."
        >
          <input
            id={`video_new_${line.orderItemId}_${pack.packIndex}`}
            name="video_url"
            type="text"
            placeholder="not filmed yet"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record what went in</SubmitButton>
        <span className="text-[13px] text-muted">
          Takes the stock off and works out what this scoop cost. Pressing it twice is safe.
        </span>
      </div>
    </AdminForm>
  );
}
