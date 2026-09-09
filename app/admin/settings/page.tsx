import { requireStaff } from "@/lib/auth/staff";
import { saveAccessory, saveSettings } from "../actions";
import { getAccessories, getSettings, type Accessory, type Settings } from "../data";
import { AdminForm, SubmitButton } from "../AdminForm";
import { NoRows, PageHead, Panel, Unknown } from "../ui";
import { Field, Pill, cx, inputClass } from "@/components/ui";
import {
  depreciationSharePerUnit,
  insuranceSharePerUnit,
  machineAndPowerPerHour,
  machineCostPerHour,
  onlinePostageShare,
  overheadPerUnit,
  powerCostPerHour,
  stallShare,
  targetPerPrinterHour,
} from "@/lib/costing";
import { SHIPPING } from "@/lib/config";
import { money } from "@/lib/format";

/**
 * The costing constants - the workbook's Settings sheet.
 *
 * Every panel below is inside ONE form, on purpose. `saveSettings` writes the
 * whole row in a single update and reads every field out of the payload, so a
 * panel that submitted on its own would send nothing for the fields it does not
 * own and quietly write a zero over them. Three panels, one save.
 *
 * The accessories underneath are a different matter: one form per row, because
 * they are separate rows in a separate table and each is priced on its own.
 */
// Without its own title a page falls back to the layout default, so seven
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Settings · Studio" };

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
                hint="Off your power bill, in dollars, 0.327 for 32.7c."
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
              hint="What Stripe keeps out of every payment, 1.75 for 1.75 per cent."
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
              label="Card fee, fixed (cents)"
              htmlFor="card_fee_fixed_cents"
              hint="Stripe AU takes 30c on top of the percentage, on every single sale."
            >
              <input
                id="card_fee_fixed_cents"
                name="card_fee_fixed_cents"
                type="number"
                min={0}
                step="0.0001"
                defaultValue={trim(settings.cardFeeFixedCents.toFixed(4))}
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

          <SuggestedPriceWorking settings={settings} />
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
              hint={`The satchel an order goes out in, once per parcel, not per piece. ${describeCents(settings.mailerPerOrderCents)}`}
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

        <Panel
          title="Waste"
          note="Prints that never make it to a customer. Failed and scrapped plates, plus test and colour-swap prints."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Waste allowance (%)"
              htmlFor="waste_rate"
              hint="12 for 12 per cent. 8 per cent failed plus 4 per cent test prints is where the workbook landed."
            >
              <input
                id="waste_rate"
                name="waste_rate"
                inputMode="decimal"
                defaultValue={percent(settings.wasteRate)}
                className={inputClass}
              />
            </Field>
          </div>

          <p className="mt-4 text-[13px] text-muted">
            This uplifts filament and machine time, and nothing else, because a
            failed print burns both and consumes neither a keyring nor a bag. At{" "}
            {percent(settings.wasteRate)}% you get{" "}
            <b className="tabular-nums">
              {(100 / (1 + settings.wasteRate)).toFixed(1)}
            </b>{" "}
            good pieces for every 100 you start. The prime tower is deliberately
            not in here, the slicer already counts it in the grams you type on a
            product.
          </p>
        </Panel>

        <Panel
          title="Overheads"
          note="What the year costs whether one piece sells or a thousand do, spread across the pieces you expect to sell."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Annual fixed costs ($)"
              htmlFor="annual_fixed_cost"
              hint="Insurance, market permits, domain and apps. $300 is the cheapest $10M public liability cover found in September 2026."
            >
              <input
                id="annual_fixed_cost"
                name="annual_fixed_cost"
                inputMode="decimal"
                defaultValue={dollars(settings.annualFixedCostCents)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Equipment, per year ($)"
              htmlFor="annual_depreciation"
              hint="Things bought once and used for years, divided by the years. Dehumidifier $120 over 5 plus media gear $30 over 3 is $34."
            >
              <input
                id="annual_depreciation"
                name="annual_depreciation"
                inputMode="decimal"
                defaultValue={dollars(settings.annualDepreciationCents)}
                className={inputClass}
              />
            </Field>

            <Field
              label="Units you expect to sell a year"
              htmlFor="expected_units_per_year"
              hint="Both pools above divide by this, so it moves every cost in the shop."
            >
              <input
                id="expected_units_per_year"
                name="expected_units_per_year"
                type="number"
                min={1}
                step={1}
                defaultValue={settings.expectedUnitsPerYear}
                className={inputClass}
              />
            </Field>
          </div>

          <OverheadWorking settings={settings} />

          <p className="mt-3.5 text-[13px] text-muted">
            The printer is deliberately not an item here. It is already paid for
            through machine cost per hour, and listing it again would charge it
            twice. Your own time is not here either, by your decision, which is
            the one cost the shop does not measure anywhere.
          </p>
        </Panel>

        <Panel
          title="Channel costs"
          note="What it costs to get a piece to a customer. Never part of a unit cost, always a share of the price."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Real parcel cost (cents)"
              htmlFor="parcel_cost_cents"
              hint="What posting one parcel actually costs you. 1000 is $10."
            >
              <input
                id="parcel_cost_cents"
                name="parcel_cost_cents"
                type="number"
                min={0}
                step={1}
                defaultValue={settings.parcelCostCents}
                className={inputClass}
              />
            </Field>

            <Field
              label="Stall fee per market day (cents)"
              htmlFor="stall_fee_cents"
              hint="5000 is $50."
            >
              <input
                id="stall_fee_cents"
                name="stall_fee_cents"
                type="number"
                min={0}
                step={1}
                defaultValue={settings.stallFeeCents}
                className={inputClass}
              />
            </Field>

            <Field
              label="Typical takings, one market day (cents)"
              htmlFor="market_day_takings_cents"
              hint="60000 is $600. The stall fee is a share of this, not a cost per piece."
            >
              <input
                id="market_day_takings_cents"
                name="market_day_takings_cents"
                type="number"
                min={1}
                step={1}
                defaultValue={settings.marketDayTakingsCents}
                className={inputClass}
              />
            </Field>
          </div>

          <ChannelWorking settings={settings} />
        </Panel>

        <Panel
          title="The printer-hour bar"
          note="Machine time, not price, is what limits the year. There are only so many hours in it."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Printer hours you can really run a year"
              htmlFor="printer_hours_per_year"
              hint="Not 8,760. What you will actually be there to start and clear."
            >
              <input
                id="printer_hours_per_year"
                name="printer_hours_per_year"
                type="number"
                min={1}
                step={1}
                defaultValue={settings.printerHoursPerYear}
                className={inputClass}
              />
            </Field>

            <Field
              label="Contribution you want from them ($)"
              htmlFor="annual_contribution_target"
              hint="What the printer should earn in a year, after everything the shop counts."
            >
              <input
                id="annual_contribution_target"
                name="annual_contribution_target"
                inputMode="decimal"
                defaultValue={dollars(settings.annualContributionTargetCents)}
                className={inputClass}
              />
            </Field>
          </div>

          <BarWorking settings={settings} />
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
        note="Keyrings, chains and clasps. Priced in cents each, to four decimal places, a keyring bought at $9.50 per hundred is 9.5 cents, not 10."
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
 * so it is shown with its arithmetic rather than as a total - if it looks wrong
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
        accessory, plus packaging, so a wrong figure here is wrong on every
        piece in the shop at once.
      </p>
    </div>
  );
}

/**
 * A boxed panel of derived numbers, the shape `PerHour` established.
 *
 * Every one of these exists for the same reason: the numbers below are not
 * typed in anywhere, they are worked out from the fields above them, and a
 * number nobody can decompose is a number nobody trusts. Each line shows its
 * arithmetic, so when a suggested price looks wrong the input that put it there
 * is on the same screen.
 */
function Working({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card mt-5 border-line2 bg-cream p-5">
      <div className="text-[12.5px] font-extrabold tracking-[0.06em] text-faint">
        {label}
      </div>
      <dl className="mt-3 flex flex-col gap-2 text-[13.5px]">{children}</dl>
    </div>
  );
}

function Line({
  term,
  children,
  total = false,
}: {
  term: React.ReactNode;
  children: React.ReactNode;
  total?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-baseline justify-between gap-3",
        total && "border-t border-line2 pt-2.5",
      )}
    >
      <dt className={total ? "font-extrabold" : "text-muted"}>{term}</dt>
      <dd
        className={cx(
          "tabular-nums",
          total && "font-display text-[19px] font-semibold",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/**
 * The overhead pool, per unit. Workbook Settings!C53.
 *
 * Shown as two lines rather than one total because they answer different
 * questions - one is a bill that arrives whether she prints or not, the other is
 * gear wearing out - and because the sensitivity is the real lesson: this is the
 * one number on the page whose denominator is a guess, and the guess moves it a
 * long way. 1,500 units gives 22c a piece; 500 gives 67c.
 */
function OverheadWorking({ settings }: { settings: Settings }) {
  const insurance = insuranceSharePerUnit(settings);
  const gear = depreciationSharePerUnit(settings);
  const units = settings.expectedUnitsPerYear;

  return (
    <Working label="OVERHEAD PER UNIT">
      <Line term="Insurance, permits, web">
        {money(settings.annualFixedCostCents)} ÷ {units.toLocaleString("en-AU")} ={" "}
        <b>{rate(insurance)}</b>
      </Line>
      <Line term="Equipment wear">
        {money(settings.annualDepreciationCents)} ÷ {units.toLocaleString("en-AU")} ={" "}
        <b>{rate(gear)}</b>
      </Line>
      <Line term="Overhead per unit" total>
        {rate(overheadPerUnit(settings))}{" "}
        <span className="text-[13.5px] font-normal text-muted">
          ({money(overheadPerUnit(settings))} a piece)
        </span>
      </Line>
      <p className="mt-1 text-[13px] text-muted">
        At half the volume this doubles. If {units.toLocaleString("en-AU")} turns
        out to be optimistic, every margin in the shop is worse than it reads
        here, so it is worth revisiting once a real year of sales exists to
        divide by.
      </p>
    </Working>
  );
}

/**
 * The two channel shares, and which one governs the price.
 *
 * The postage figure is the WORST case on purpose: the basket that only just
 * crosses the free-postage line earns free postage and the studio carries the
 * whole parcel. It is not a rare order, it is the one the free-postage line is
 * there to encourage.
 */
function ChannelWorking({ settings }: { settings: Settings }) {
  const postage = onlinePostageShare(settings);
  const stall = stallShare(settings);
  const online = postage >= stall;

  return (
    <Working label="WHAT EACH CHANNEL COSTS">
      <Line term="Online, postage you absorb">
        {money(settings.parcelCostCents)} ÷ {money(SHIPPING.freeThreshold)} ={" "}
        <b>{percent(postage)}%</b>
      </Line>
      <Line term="Market stall, fee against takings">
        {money(settings.stallFeeCents)} ÷ {money(settings.marketDayTakingsCents)} ={" "}
        <b>{percent(stall)}%</b>
      </Line>
      <Line term="Priced against" total>
        {online ? "Online" : "Market stall"}{" "}
        <span className="text-[13.5px] font-normal text-muted">
          ({percent(online ? postage : stall)}%)
        </span>
      </Line>
      <p className="mt-1 text-[13px] text-muted">
        One price for both channels, set by whichever is worse, because two
        prices for one piece is a promise to mislabel something on a market
        table.{" "}
        {online ? (
          <>
            Online is currently the expensive channel, so it is the one every
            suggested price is worked back from. A market day needs{" "}
            <b className="tabular-nums">
              {money(
                stall > 0
                  ? Math.round(settings.stallFeeCents / postage)
                  : 0,
              )}
            </b>{" "}
            in takings to be the cheaper way to sell.
          </>
        ) : (
          <>
            The stall is currently the expensive channel. That is unusual and
            worth checking: either the fee has gone up or a typical day has got
            quieter.
          </>
        )}{" "}
        The $49 and $89 thresholds are not editable here. They are set in the
        code the cart and the checkout both read, so a price and the postage
        actually charged cannot drift apart.
      </p>
    </Working>
  );
}

/**
 * The bar every product is judged against, alongside margin.
 *
 * Set from the business and deliberately NOT from a product's price: when the
 * macaron was cut from $9.00 to $6.49, a bar derived from a product would have
 * quietly lowered the standard for the whole catalogue at the same moment.
 */
function BarWorking({ settings }: { settings: Settings }) {
  const bar = targetPerPrinterHour(settings);

  return (
    <Working label="TARGET $ PER PRINTER-HOUR">
      <Line term="Contribution wanted ÷ hours available" total>
        {money(settings.annualContributionTargetCents)} ÷{" "}
        {settings.printerHoursPerYear.toLocaleString("en-AU")} = {money(bar)}
        <span className="ml-1.5 text-[13.5px] font-normal text-muted">an hour</span>
      </Line>
      <p className="mt-1 text-[13px] text-muted">
        A piece can clear your target margin and still fail this, and that is the
        case worth catching: a cheap thing that prints for two hours earns less
        for the year than a dearer thing that prints in twenty minutes. Both
        numbers are shown on every product and on the repricing screen.
      </p>
    </Working>
  );
}

/**
 * The suggested-price formula, with today's numbers in it.
 *
 * Spelled out because the divisor is the single most consequential number in
 * the studio and it is nowhere near obvious: it is about 0.20, so every extra
 * point of target margin moves a price by roughly five per cent.
 */
function SuggestedPriceWorking({ settings }: { settings: Settings }) {
  const channel = Math.max(onlinePostageShare(settings), stallShare(settings));
  const divisor = 1 - settings.targetMargin - settings.cardFeeRate - channel;

  return (
    <div className="mt-4 flex flex-col gap-2.5 text-[13px] text-muted">
      <p>
        A piece is priced at its cost plus the fixed{" "}
        {trim(settings.cardFeeFixedCents.toFixed(2))}c card fee, divided by
      </p>
      <p className="font-mono text-[13px] tabular-nums text-ink">
        1 − {percent(settings.targetMargin)}%{" "}
        <span className="text-faint">margin</span> − {percent(settings.cardFeeRate)}%{" "}
        <span className="text-faint">card</span> − {percent(channel)}%{" "}
        <span className="text-faint">channel</span> ={" "}
        <b>{divisor.toFixed(4)}</b>
      </p>
      <p>
        then rounded up to the nearest {settings.roundPriceToCents}c. All three
        come off the price together, the way the workbook does it, not
        compounded.{" "}
        {divisor > 0 ? (
          <>
            The divisor being about {divisor.toFixed(2)} is the thing to know:
            one more point of target margin moves every price by roughly{" "}
            {Math.round((0.01 / divisor) * 100)} per cent.
          </>
        ) : (
          <b className="text-warn">
            These add up to 100 per cent or more, so no price satisfies them.
            Lower the margin.
          </b>
        )}
      </p>
      <p>
        The workbook settled on <b>67%</b> and a <b>1.7%</b> card fee, which is
        what Stripe charges in Australia. If the two fields above do not say
        that, the suggestions on every screen are worked back from a target that
        was abandoned as unreachable.
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
