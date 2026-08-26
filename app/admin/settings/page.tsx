import { requireStaff } from "@/lib/auth/staff";
import { saveAccessory, saveSettings } from "../actions";
import { getAccessories, getSettings, type Accessory, type Settings } from "../data";
import { AdminForm, SubmitButton } from "../AdminForm";
import { NoRows, PageHead, Panel, Unknown } from "../ui";
import { Field, Pill, inputClass } from "@/components/ui";
import {
  machineAndPowerPerHour,
  machineCostPerHour,
  powerCostPerHour,
} from "@/lib/costing";
import { money } from "@/lib/format";

/**
 * The costing constants — the workbook's Settings sheet.
 *
 * Every panel below is inside ONE form, on purpose. `saveSettings` writes the
 * whole row in a single update and reads every field out of the payload, so a
 * panel that submitted on its own would send nothing for the fields it does not
 * own and quietly write a zero over them. Three panels, one save.
 *
 * The accessories underneath are a different matter: one form per row, because
 * they are separate rows in a separate table and each is priced on its own.
 */
export default async function SettingsPage() {
  await requireStaff("settings");

  const [settings, accessories] = await Promise.all([
    getSettings(),
    getAccessories(),
  ]);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Settings"
        subtitle="What the printer, the power, the filament and the packaging cost. Every unit cost and every suggested price in the studio is worked out from these numbers."
      />

      <AdminForm action={saveSettings}>
        <Panel
          title="Printer & power"
          note="What it costs to have the machine running for an hour."
        >
          <div className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Printer" htmlFor="printer_model" hint="Only for your own reference.">
                <input
                  id="printer_model"
                  name="printer_model"
                  defaultValue={settings.printerModel ?? ""}
                  maxLength={80}
                  placeholder="Bambu Lab A1"
                  className={inputClass}
                />
              </Field>

              <Field
                label="Printer price ($)"
                htmlFor="printer_price"
                hint="What you paid for it, in dollars."
              >
                <input
                  id="printer_price"
                  name="printer_price"
                  inputMode="decimal"
                  defaultValue={dollars(settings.printerPriceCents)}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Expected life (hours)"
                htmlFor="printer_life_hours"
                hint="How many printing hours you expect to get out of it before it is replaced."
              >
                <input
                  id="printer_life_hours"
                  name="printer_life_hours"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={settings.printerLifeHours}
                  className={inputClass}
                />
              </Field>

              <Field label="Power draw (watts)" htmlFor="power_draw_watts">
                <input
                  id="power_draw_watts"
                  name="power_draw_watts"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={settings.powerDrawWatts}
                  className={inputClass}
                />
              </Field>

              <Field
                label="Electricity ($ per kWh)"
                htmlFor="electricity_per_kwh"
                hint="Off your power bill, in dollars — 0.327 for 32.7c."
              >
                <input
                  id="electricity_per_kwh"
                  name="electricity_per_kwh"
                  inputMode="decimal"
                  defaultValue={trim((settings.electricityPerKwhCents / 100).toFixed(6))}
                  className={inputClass}
                />
              </Field>
            </div>

            <PerHour settings={settings} />
          </div>
        </Panel>

        <Panel
          title="Pricing"
          note="What the filament costs and how much of a price is yours to keep."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Filament ($ per kg)"
              htmlFor="filament_per_kg"
              hint="What one 1kg roll costs, in dollars."
            >
              <input
                id="filament_per_kg"
                name="filament_per_kg"
                inputMode="decimal"
                defaultValue={dollars(settings.filamentPerKgCents)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Target margin (%)"
              htmlFor="target_margin"
              hint="70 for 70 per cent. The suggested price is worked back from this."
            >
              <input
                id="target_margin"
                name="target_margin"
                inputMode="decimal"
                defaultValue={percent(settings.targetMargin)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Card fee (%)"
              htmlFor="card_fee_rate"
              hint="What Stripe keeps out of every payment — 1.75 for 1.75 per cent."
            >
              <input
                id="card_fee_rate"
                name="card_fee_rate"
                inputMode="decimal"
                defaultValue={percent(settings.cardFeeRate)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Round prices up to (cents)"
              htmlFor="round_price_to_cents"
              hint="50 rounds every suggested price up to the nearest 50c."
            >
              <input
                id="round_price_to_cents"
                name="round_price_to_cents"
                type="number"
                min={1}
                step={1}
                defaultValue={settings.roundPriceToCents}
                className={inputClass}
              />
            </Field>

            <Field
              label="Default buffer stock"
              htmlFor="default_buffer_stock"
              hint="How many spares a newly added product starts out wanting on the shelf."
            >
              <input
                id="default_buffer_stock"
                name="default_buffer_stock"
                type="number"
                min={0}
                step={1}
                defaultValue={settings.defaultBufferStock}
                className={inputClass}
              />
            </Field>
          </div>

          <p className="mt-4 text-[13px] text-muted">
            The margin and the card fee come off the price together, the way the
            workbook does it: a piece is priced at its cost divided by{" "}
            <span className="tabular-nums">
              1 − {percent(settings.targetMargin)}% − {percent(settings.cardFeeRate)}%
            </span>
            , then rounded up. They cannot add up to 100 per cent — there would
            be no price that satisfied both.
          </p>
        </Panel>

        <Panel
          title="Packaging"
          note="Typed in cents, because these are small numbers and rounding them to dollars moves a $2.50 product."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Packaging per unit (cents)"
              htmlFor="packaging_per_unit_cents"
              hint={`Bag, card and sticker for one piece. ${describeCents(settings.packagingPerUnitCents)}`}
            >
              <input
                id="packaging_per_unit_cents"
                name="packaging_per_unit_cents"
                type="number"
                min={0}
                step="0.0001"
                defaultValue={trim(settings.packagingPerUnitCents.toFixed(4))}
                className={inputClass}
              />
            </Field>

            <Field
              label="Mailer per order (cents)"
              htmlFor="mailer_per_order_cents"
              hint={`The satchel an order goes out in — once per parcel, not per piece. ${describeCents(settings.mailerPerOrderCents)}`}
            >
              <input
                id="mailer_per_order_cents"
                name="mailer_per_order_cents"
                type="number"
                min={0}
                step="0.0001"
                defaultValue={trim(settings.mailerPerOrderCents.toFixed(4))}
                className={inputClass}
              />
            </Field>
          </div>
        </Panel>

        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton size="md">Save settings</SubmitButton>
          <span className="text-[13px] text-muted">
            Saving recalculates every unit cost and every suggested price.
          </span>
        </div>
      </AdminForm>

      <Panel
        title="Accessories"
        note="Keyrings, chains and clasps. Priced in cents each, to four decimal places — a keyring bought at $9.50 per hundred is 9.5 cents, not 10."
        padded={false}
      >
        {accessories.length === 0 ? (
          <NoRows>
            No accessories yet. They are added with the catalogue, then costed
            here.
          </NoRows>
        ) : (
          <ul className="divide-y divide-line">
            {accessories.map((accessory) => (
              <li key={accessory.id} className="px-5 py-4">
                <AccessoryRow accessory={accessory} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * Settings!C12, spelled out.
 *
 * This one number multiplies the print time of every product in the catalogue,
 * so it is shown with its arithmetic rather than as a total — if it looks wrong
 * she can see which of the four inputs above put it there.
 *
 * Each half reads as Unknown rather than as zero when its inputs are blank. A
 * machine rate of $0.00 an hour is not a cheap printer, it is a printer price
 * nobody has typed in yet.
 */
function PerHour({ settings }: { settings: Settings }) {
  const machineKnown =
    settings.printerPriceCents > 0 && settings.printerLifeHours > 0;
  const powerKnown =
    settings.powerDrawWatts > 0 && settings.electricityPerKwhCents > 0;

  const machine = machineCostPerHour(settings);
  const power = powerCostPerHour(settings);
  const total = machineAndPowerPerHour(settings);

  return (
    <div className="card border-line2 bg-cream p-5">
      <div className="text-[12.5px] font-extrabold tracking-[0.06em] text-faint">
        MACHINE + POWER PER HOUR
      </div>

      <dl className="mt-3 flex flex-col gap-2 text-[13.5px]">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <dt className="text-muted">Machine wear</dt>
          <dd className="tabular-nums">
            {machineKnown ? (
              <>
                {money(settings.printerPriceCents)} ÷{" "}
                {settings.printerLifeHours.toLocaleString("en-AU")} hours ={" "}
                <b>{rate(machine)}</b>
              </>
            ) : (
              <Unknown what="Printer price or expected life not filled in" />
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <dt className="text-muted">Power</dt>
          <dd className="tabular-nums">
            {powerKnown ? (
              <>
                {settings.powerDrawWatts} W ÷ 1000 ×{" "}
                {trim(settings.electricityPerKwhCents.toFixed(4))}c per kWh ={" "}
                <b>{rate(power)}</b>
              </>
            ) : (
              <Unknown what="Power draw or electricity price not filled in" />
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-line2 pt-2.5">
          <dt className="font-extrabold">Machine + power per hour</dt>
          <dd className="font-display text-[19px] font-semibold tabular-nums">
            {machineKnown && powerKnown ? (
              <>
                {rate(total)}{" "}
                <span className="text-[13.5px] font-normal text-muted">
                  ({money(total)} an hour)
                </span>
              </>
            ) : (
              <Unknown what="Not known until the four fields above are filled in" />
            )}
          </dd>
        </div>
      </dl>

      <p className="mt-3.5 text-[13px] text-muted">
        This is the number the workbook calls Settings!C12. A product&rsquo;s
        making cost is its print time multiplied by it, plus filament, plus an
        accessory, plus packaging — so a wrong figure here is wrong on every
        piece in the shop at once.
      </p>
    </div>
  );
}

/** One accessory, on its own form. Name is set with the catalogue, not here. */
function AccessoryRow({ accessory }: { accessory: Accessory }) {
  const costed = accessory.costCents > 0;

  return (
    <AdminForm action={saveAccessory}>
      <input type="hidden" name="id" value={accessory.id} />

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-[190px] flex-1 pb-1">
          <div className="font-display text-[15px] font-semibold">
            {accessory.name}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {costed ? (
              <span className="text-[13px] text-muted tabular-nums">
                {trim(accessory.costCents.toFixed(4))}c each ·{" "}
                {money(accessory.costCents * 100)} per hundred
              </span>
            ) : (
              <Unknown what="Not costed yet" />
            )}
            {accessory.costNote ? (
              <Pill tone="warn">{accessory.costNote}</Pill>
            ) : null}
            {accessory.active ? null : <Pill tone="neutral">Not in use</Pill>}
          </div>
        </div>

        <div className="w-[150px]">
          <Field
            label="Cost (cents)"
            htmlFor={`cost-${accessory.id}`}
            hint="Cents each, not dollars."
          >
            <input
              id={`cost-${accessory.id}`}
              name="cost_cents"
              type="number"
              min={0}
              step="0.0001"
              defaultValue={trim(accessory.costCents.toFixed(4))}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="w-[230px]">
          <Field
            label="Note"
            htmlFor={`note-${accessory.id}`}
            hint="Where the price came from."
          >
            <input
              id={`note-${accessory.id}`}
              name="cost_note"
              defaultValue={accessory.costNote ?? ""}
              maxLength={120}
              placeholder="$9.50 per 100, eBay, Aug 2026"
              className={inputClass}
            />
          </Field>
        </div>

        <label
          htmlFor={`active-${accessory.id}`}
          className="flex h-12 shrink-0 cursor-pointer items-center gap-2 text-[13.5px] font-extrabold"
        >
          <input
            id={`active-${accessory.id}`}
            name="active"
            type="checkbox"
            defaultChecked={accessory.active}
            className="h-4 w-4 accent-accent"
          />
          In use
        </label>

        <SubmitButton variant="soft" size="sm">
          Save
        </SubmitButton>
      </div>
    </AdminForm>
  );
}

/* ------------------------------------------------------------- formatting */

/** Drop the trailing zeros a fixed-places number carries. Never touches a whole number. */
function trim(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}

/** Cents → the dollars string the form takes back. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * A stored fraction → the percentage the form takes back.
 *
 * Through toFixed first, because 0.7 * 100 is 70.00000000000001 in binary
 * floating point and that is not what anybody wants to see in a text box.
 */
function percent(fraction: number): string {
  return trim((fraction * 100).toFixed(4));
}

/** Fractional cents per hour, e.g. "10.49c". */
function rate(cents: number): string {
  return `${trim(cents.toFixed(4))}c`;
}

/** A plain-words gloss on a small number of cents, or nothing when it is unset. */
function describeCents(cents: number): string {
  if (cents <= 0) return "Nothing recorded yet.";
  return `${trim(cents.toFixed(4))}c is ${money(cents * 100)} per hundred.`;
}
