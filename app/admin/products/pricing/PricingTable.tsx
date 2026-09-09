"use client";

import { useMemo, useState } from "react";
import { costAtPrice, perPrinterHour, type PriceTerms } from "@/lib/costing";
import { money } from "@/lib/format";
import { Icon, Pill, cx, inputClass } from "@/components/ui";
import type { RepricingRow } from "../../data";

/**
 * The grid where 38 products stop being $9.00.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A CLIENT COMPONENT, WHEN ALMOST NOTHING ELSE IN THE STUDIO IS.
 *
 * Because the point of the screen is the answer arriving before the save does.
 * Typing 6.49 and seeing 61.8% and $2.97 an hour appear next to it is the whole
 * job: a suggested price is a starting point, and every price in this catalogue
 * is a decision to depart from it. A server round trip per keystroke would make
 * that unusable, and saving first and reading the consequence afterwards is how
 * you set 38 prices and then discover a third of them missed the bar.
 *
 * It recomputes with `costAtPrice` and `perPrinterHour` imported from
 * lib/costing - the same functions the server used to draw the initial numbers,
 * not a copy of the formula. A second implementation of the margin arithmetic
 * living in a client component is the kind of drift nobody notices until the
 * studio and the workbook disagree about a price.
 *
 * What it does NOT receive is the settings row. `PriceTerms` is three scalars:
 * the card rate, the fixed card fee and the postage share. The printer price,
 * the filament price and the overhead pools stay on the server, because a
 * component that needs three numbers should be handed three numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function PricingTable({
  rows,
  terms,
  targetMargin,
  barPerHour,
}: {
  rows: RepricingRow[];
  terms: PriceTerms;
  targetMargin: number;
  barPerHour: number;
}) {
  /*
   * Keyed by product id, holding what is in the box as a STRING.
   *
   * As a string, deliberately, and seeded from the current price. Storing cents
   * and formatting on the way out fights the person typing: "6." is not a
   * number, "6.5" and "6.50" are the same number but not the same thing to type
   * next, and a controlled input that reformats mid-entry moves the caret. The
   * string is what she typed; it becomes cents once, in `dollarsToCents` on the
   * server, and once here for the preview.
   */
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.id, dollars(row.price)])),
  );

  const changed = useMemo(
    () =>
      rows.filter((row) => {
        const typed = parse(draft[row.id]);
        return typed !== null && typed !== row.price;
      }).length,
    [rows, draft],
  );

  const fillSuggested = () => {
    setDraft((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (row.suggested !== null) next[row.id] = dollars(row.suggested);
      }
      return next;
    });
  };

  const reset = () =>
    setDraft(Object.fromEntries(rows.map((row) => [row.id, dollars(row.price)])));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={fillSuggested}
          className={`${inputClass} !w-auto cursor-pointer px-4 font-display text-[13.5px] font-semibold`}
        >
          Fill every row with its suggestion
        </button>
        <button
          type="button"
          onClick={reset}
          className={`${inputClass} !w-auto cursor-pointer px-4 font-display text-[13.5px] font-semibold`}
        >
          Start again
        </button>
        <span
          className="text-[13.5px] text-muted"
          /* aria-live so the count is announced rather than only seen; a person
             working down a grid of 44 rows should not have to hunt for it. */
          aria-live="polite"
        >
          {changed === 0
            ? "No changes yet."
            : `${changed} price${changed === 1 ? "" : "s"} changed, not saved yet.`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] font-extrabold tracking-[0.04em] text-faint">
              <th className="px-4 py-3">SKU</th>
              <th className="px-3 py-3">Product</th>
              <th className="px-3 py-3 text-right">Costs</th>
              <th className="px-3 py-3 text-right">Now</th>
              <th className="px-3 py-3 text-right">Suggested</th>
              <th className="px-3 py-3 text-right">New price</th>
              <th className="px-3 py-3 text-right">Margin</th>
              <th className="px-4 py-3 text-right">$ / hour</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                value={draft[row.id] ?? ""}
                onChange={(next) => setDraft((c) => ({ ...c, [row.id]: next }))}
                onUseSuggested={
                  row.suggested === null
                    ? undefined
                    : () =>
                        setDraft((c) => ({
                          ...c,
                          [row.id]: dollars(row.suggested as number),
                        }))
                }
                terms={terms}
                targetMargin={targetMargin}
                barPerHour={barPerHour}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({
  row,
  value,
  onChange,
  onUseSuggested,
  terms,
  targetMargin,
  barPerHour,
}: {
  row: RepricingRow;
  value: string;
  onChange: (next: string) => void;
  onUseSuggested?: () => void;
  terms: PriceTerms;
  targetMargin: number;
  barPerHour: number;
}) {
  const typed = parse(value);
  const dirty = typed !== null && typed !== row.price;

  /*
   * The preview. Null whenever it cannot be worked out, and the three reasons
   * are kept apart on purpose: an unmeasured piece has no cost, an empty box has
   * no price, and neither is a margin of nothing.
   */
  const outcome =
    row.unitCostCents === null || typed === null || typed <= 0
      ? null
      : costAtPrice(terms, typed, row.unitCostCents);
  const margin = outcome?.margin ?? null;
  const hourly = outcome ? perPrinterHour(outcome.profit, row.printTimeHours) : null;

  const underMargin = margin !== null && margin < targetMargin;
  const underBar = hourly !== null && hourly < barPerHour;

  return (
    <tr className={cx("align-middle", dirty ? "bg-accent-soft/40" : "hover:bg-cream/50")}>
      <td className="px-4 py-2.5 font-mono text-[12.5px] font-semibold">{row.sku}</td>

      <td className="max-w-[240px] px-3 py-2.5">
        <div className="truncate font-semibold" title={row.name}>
          {row.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
          {row.category}
          {row.active ? null : <Pill tone="neutral">Hidden</Pill>}
        </div>
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums">
        {row.unitCostCents === null ? (
          /* Not `money(0)`. A piece nobody has timed does not cost nothing, and
             the missing input is the actionable part, so it is what is shown. */
          <span
            className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-warn"
            title={`No ${row.missing.join(" and ")} recorded`}
          >
            <Icon name="help" size={14} />
            no {row.missing[0]}
          </span>
        ) : (
          money(row.unitCostCents)
        )}
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
        {money(row.price)}
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums">
        {row.suggested === null ? (
          <span className="text-faint">-</span>
        ) : (
          <button
            type="button"
            onClick={onUseSuggested}
            title="Use this price"
            className="font-semibold text-accent underline decoration-dotted underline-offset-2 hover:text-accent-dark"
          >
            {money(row.suggested)}
          </button>
        )}
      </td>

      <td className="px-3 py-2.5 text-right">
        {/* The SKU rides along so a validation message can name the row rather
            than a uuid. `was_` is what makes an unchanged row a no-op. */}
        <input type="hidden" name={`sku_${row.id}`} value={row.sku} />
        <input type="hidden" name={`was_${row.id}`} value={dollars(row.price)} />
        <input
          name={`price_${row.id}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          aria-label={`Price for ${row.name}`}
          className={`${inputClass} !h-10 w-[92px] !px-2.5 text-right tabular-nums`}
        />
      </td>

      <td className="px-3 py-2.5 text-right tabular-nums">
        {margin === null ? (
          <span className="text-faint">-</span>
        ) : (
          <span className={underMargin ? "font-semibold text-warn" : ""}>
            {Math.round(margin * 100)}%
          </span>
        )}
      </td>

      <td className="px-4 py-2.5 text-right tabular-nums">
        {hourly === null ? (
          <span className="text-faint" title="No print time recorded">
            -
          </span>
        ) : (
          <span className={underBar ? "font-semibold text-warn" : ""}>
            {money(hourly)}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------- formatting */

/** Cents to the dollars string that goes in the box. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * What is in the box, as cents, or null when it is not a price yet.
 *
 * Mirrors `dollarsToCents` in actions.ts, including the `Math.round`: 8.05 * 100
 * is 804.9999999999999 in binary floating point and truncating gives $8.04. The
 * preview and the save must agree to the cent or the number she decided on is
 * not the number that lands.
 */
function parse(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
