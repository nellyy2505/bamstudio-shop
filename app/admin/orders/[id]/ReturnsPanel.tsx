import { AdminForm, SubmitButton } from "../../AdminForm";
import { recordReturn } from "../../actions";
import { Panel } from "../../ui";
import { Field, Pill, inputClass } from "@/components/ui";
import { formatDate, money, pluralise } from "@/lib/format";
import {
  RETURN_REASONS,
  RETURN_REASON_LABEL,
  type OrderLine,
  type OrderReturn,
} from "../../data";

/**
 * What came back, and the form for recording the next one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES NOT DO: refund anybody.
 *
 * The money moves in Stripe, by hand, as it always has. This records what was
 * refunded so the shop knows, so the reason can be counted, and so the piece
 * can go back on the shelf if it is fit to sell. A studio that could issue
 * payments from two places is a studio that will one day pay twice.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The restock question is asked PER LINE, which is the answer to "does a return
 * put stock back": it depends. One parcel can hold a keychain that is perfectly
 * fine and a charm that snapped, and a single answer for both would either
 * throw away a good piece or put a broken one in front of the next customer.
 * The checkbox starts unticked, so the safe answer is the one you get by not
 * deciding.
 */
export function ReturnsPanel({
  orderId,
  lines,
  returns,
  returnedByLine,
  canRecord,
}: {
  orderId: string;
  lines: OrderLine[];
  returns: OrderReturn[];
  /** How many of each line have already come back, keyed by order line id. */
  returnedByLine: Map<string, number>;
  /**
   * Whether this role may record a return, and therefore see the money.
   *
   * The panel still renders without it: somebody packing needs to know a piece
   * came back faulty before putting another one in a parcel, and that is what
   * the list above gives them. What they do not get is the refund figures or
   * the form, because deciding how much money goes back to a customer is not a
   * packing job. Same line this page already draws around a line's making cost.
   */
  canRecord: boolean;
}) {
  const returnable = lines.filter(
    (line) => line.quantity - (returnedByLine.get(line.id) ?? 0) > 0,
  );

  const totalRefunded = returns.reduce((sum, entry) => sum + entry.refundAmountCents, 0);

  return (
    <Panel
      title="Returns"
      note={
        returns.length === 0
          ? "Nothing has come back from this order."
          : canRecord
            ? `${pluralise(returns.length, "return")}, ${money(totalRefunded)} refunded in total.`
            : pluralise(returns.length, "return")
      }
    >
      <div className="flex flex-col gap-5">
        {returns.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {returns.map((entry) => (
              <li key={entry.id} className="card border-line2 bg-cream p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[14.5px]">
                      {RETURN_REASON_LABEL[entry.reason] ?? entry.reason}
                    </b>
                    <span className="text-[13px] text-muted">
                      {formatDate(entry.createdAt)}
                    </span>
                  </div>
                  {canRecord ? (
                    <span className="text-[14px] font-semibold tabular-nums">
                      {entry.refundAmountCents > 0
                        ? `${money(entry.refundAmountCents)} refunded`
                        : "No refund"}
                    </span>
                  ) : null}
                </div>

                <ul className="mt-2 flex flex-col gap-1 text-[13.5px]">
                  {entry.lines.map((line) => (
                    <li key={line.id} className="flex flex-wrap items-center gap-2">
                      <span className="tabular-nums">{line.quantity} ×</span>
                      <span>{line.productName}</span>
                      {line.restocked ? (
                        <Pill tone="good">Back on the shelf</Pill>
                      ) : (
                        <Pill tone="neutral">Written off</Pill>
                      )}
                    </li>
                  ))}
                </ul>

                {entry.note ? (
                  <p className="mt-2 text-[13.5px] text-muted">{entry.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {!canRecord ? null : returnable.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            Every piece on this order has already been returned, so there is
            nothing left to record.
          </p>
        ) : (
          <AdminForm action={recordReturn}>
            <input type="hidden" name="order_id" value={orderId} />

            <fieldset>
              <legend className="mb-2 text-[13.5px] font-extrabold">
                What came back
              </legend>
              <div className="flex flex-col gap-2.5">
                {returnable.map((line) => {
                  const already = returnedByLine.get(line.id) ?? 0;
                  const remaining = line.quantity - already;

                  return (
                    <div
                      key={line.id}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-2.5 last:border-0"
                    >
                      <div className="min-w-[180px] flex-1">
                        <div className="text-[14px] font-semibold">{line.productName}</div>
                        <div className="text-[12.5px] text-faint">
                          {remaining} of {line.quantity} still returnable
                          {already > 0 ? `, ${already} already back` : ""}
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-[13px]">
                        <span className="font-extrabold">Qty</span>
                        <input
                          name={`qty_${line.id}`}
                          type="number"
                          min={0}
                          max={remaining}
                          defaultValue={0}
                          aria-label={`How many ${line.productName} came back`}
                          className={`${inputClass} !h-10 !w-20 !px-2.5 text-right tabular-nums`}
                        />
                      </label>

                      {/* Unticked by default. There is no safe guess, so the
                          answer you get by not deciding is the one that cannot
                          put a faulty piece in front of the next customer. */}
                      <label className="flex cursor-pointer items-center gap-2 text-[13.5px]">
                        <input
                          name={`restock_${line.id}`}
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                        />
                        Fit to sell again
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Why" htmlFor="reason">
                <select id="reason" name="reason" defaultValue="" className={inputClass}>
                  <option value="" disabled>
                    Choose a reason
                  </option>
                  {RETURN_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {RETURN_REASON_LABEL[reason]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Refunded ($)"
                htmlFor="refund_amount"
                hint="What you actually sent back in Stripe. 0 if none did."
              >
                <input
                  id="refund_amount"
                  name="refund_amount"
                  inputMode="decimal"
                  defaultValue="0.00"
                  className={inputClass}
                />
              </Field>
            </div>

            <Field
              label="Note"
              htmlFor="note"
              hint="Their words, or yours. The reason above is what gets counted; this is what it actually was."
            >
              <input
                id="note"
                name="note"
                maxLength={300}
                placeholder="Chain snapped at the clasp after a week"
                className={inputClass}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-4">
              <SubmitButton size="md">Record this return</SubmitButton>
              <span className="text-[13px] text-muted">
                This records the refund, it does not send it. Refund in Stripe as
                usual.
              </span>
            </div>
          </AdminForm>
        )}
      </div>
    </Panel>
  );
}
