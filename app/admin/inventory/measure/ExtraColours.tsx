"use client";

import { Fragment, createContext, useContext, useState, type ReactNode } from "react";
import { cx, inputClass } from "@/components/ui";

/**
 * Colour slots two to four of a measuring row, rendered only when wanted.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS CLOSES, measured on the deployed page with 44 products and
 * 18 colours in the palette:
 *
 *     htmlBytes   1,207,013     1.2 MB of HTML for one screen
 *     selects     176           four per row: the main colour plus three more
 *     options     3,344
 *     forms       44
 *     nodes       4,744
 *
 * Chrome's renderer timed out trying to screenshot it (`Page.captureScreenshot`
 * gave up after 30 s), and it grew with the catalogue — the same page at 200
 * products is about 5 MB. The screen whose whole purpose is to make measuring
 * forty-four pieces fast was the heaviest document in the shop.
 *
 * Nearly all of that was colour <option>s. Every row server-rendered four full
 * palettes — 4 × 19 options — and three of those four sat inside a <details>
 * that almost nobody opens, because almost every piece is one colour. 3,344
 * option elements were shipped so that a handful of multi-colour pieces could
 * be edited without a click.
 *
 * So the extra three slots start as six hidden inputs instead: same names, same
 * values, same payload, none of the palette. The palette itself is handed to
 * the browser ONCE (see `ColourPalette` below) rather than forty-four times,
 * and this component builds the selects out of it on the spot when a row is
 * actually opened.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IS PROTECTED HERE, and must survive any later edit:
 *
 *  1. `saveMeasurement` refuses a payload that does not carry exactly
 *     MEASURE_COLOUR_SLOTS `filament_colour` and `filament_grams` values — a
 *     POST missing them would otherwise read as "this piece uses no colours"
 *     and wipe a recipe. A closed <details> satisfied that because its controls
 *     are still part of the form. Hidden inputs satisfy it the same way, and
 *     they carry the piece's CURRENT colours and grams, so saving a row without
 *     opening it writes the recipe back unchanged rather than deleting it.
 *
 *  2. The screen still works with no JavaScript at all. The toggle is a real
 *     link to `?colours=<product id>`, which server-renders that one row with
 *     its slots open; the click handler below only stops the navigation once
 *     React has hydrated. A piece that already uses more than one colour is
 *     rendered open by the server with no toggle at all, so the common no-JS
 *     job — correcting a multi-colour piece — needs no round trip either.
 *
 *  3. Nothing here reads app/admin/data.ts. It is a client component; the
 *     palette arrives as a prop from the page.
 */

/** The three fields of the palette this screen needs. Deliberately not
 *  `ColourRow`: hex, sort order and rolls on hand would be forty-four rows of
 *  payload buying nothing, and importing the type would tie a client component
 *  to a server-only module. */
export type PaletteColour = { id: string; name: string; active: boolean };

const PaletteContext = createContext<PaletteColour[]>([]);

/**
 * The palette, serialised into the page once for the whole list.
 *
 * A prop on each row would put eighteen colours into the payload forty-four
 * times over, which is the same mistake as the one above wearing a different
 * hat. Context is how one array reaches every row without being copied.
 */
export function ColourPalette({
  palette,
  children,
}: {
  palette: PaletteColour[];
  children: ReactNode;
}) {
  return <PaletteContext.Provider value={palette}>{children}</PaletteContext.Provider>;
}

export type ExtraSlot = { colourId: string; grams: number } | null;

export function ExtraColours({
  slots,
  product,
  keep,
  pinned,
  startOpen,
  openHref,
  closeHref,
}: {
  /** Slots two upwards, in order. One entry per remaining colour slot. */
  slots: ExtraSlot[];
  /** Product name, for the field labels. */
  product: string;
  /** Colours this piece uses that are switched off — see `usable` on the page. */
  keep: string[];
  /** The piece already uses more than one colour: always open, no toggle. */
  pinned: boolean;
  /** Server's opinion of the starting state, from `?colours=` in the URL. */
  startOpen: boolean;
  openHref: string;
  closeHref: string;
}) {
  const palette = useContext(PaletteContext);
  const [open, setOpen] = useState(startOpen || pinned);
  // Once the real fields exist they stay mounted, so shutting the row again
  // does not throw away grams somebody has just typed. A closed <details> kept
  // its inputs too, and that is the behaviour being matched.
  const [built, setBuilt] = useState(startOpen);

  // A colour that has been turned off still has to be offered if this piece
  // uses it, or saving would quietly drop it. Same rule as the product form.
  const usable = palette.filter((colour) => colour.active || keep.includes(colour.id));

  const fields = (
    <div className={cx("mt-3 flex-col gap-2.5", open ? "flex" : "hidden")}>
      {slots.map((slot, i) => (
        <div key={i} className="grid gap-2.5 sm:grid-cols-[minmax(150px,1fr)_92px] sm:items-center">
          <select
            name="filament_colour"
            defaultValue={slot?.colourId ?? ""}
            aria-label={`Colour ${i + 2} for ${product}`}
            className={cx(inputClass, "!h-10 min-w-0")}
          >
            <option value="">None</option>
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
            defaultValue={slot ? String(slot.grams) : ""}
            placeholder="grams"
            aria-label={`Grams of colour ${i + 2} for ${product}`}
            className={cx(inputClass, "!h-10")}
          />
        </div>
      ))}
    </div>
  );

  // A multi-colour piece: the extra colours are the row, not a disclosure.
  if (pinned) return fields;

  return (
    <div>
      <a
        href={open ? closeHref : openHref}
        aria-expanded={open}
        onClick={(event) => {
          // Only once React is running. Before that this is an ordinary link,
          // the server renders that one row open, and the whole screen still
          // works — which is the point of it being a link and not a button.
          // Following it costs a round trip and anything typed into another row
          // that has not been saved yet, so with React up it never navigates.
          event.preventDefault();
          if (!open) setBuilt(true);
          setOpen(!open);
        }}
        className="inline-block w-fit text-[13px] font-bold text-accent hover:text-accent-dark"
      >
        {open ? "Hide the extra colours" : `More than one colour? Add up to ${slots.length} more`}
      </a>

      {built ? (
        fields
      ) : (
        // The payload `saveMeasurement` insists on, without the palette: the
        // slots this piece already has, unchanged, ready to be written back.
        slots.map((slot, i) => (
          <Fragment key={i}>
            <input type="hidden" name="filament_colour" value={slot?.colourId ?? ""} />
            <input type="hidden" name="filament_grams" value={slot ? String(slot.grams) : ""} />
          </Fragment>
        ))
      )}
    </div>
  );
}
