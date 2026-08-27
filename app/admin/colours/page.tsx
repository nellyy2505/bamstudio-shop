import { can, requireStaff } from "@/lib/auth/staff";
import { saveColour, setRolls } from "../actions";
import { getColours, type ColourRow } from "../data";
import { AdminForm, SubmitButton } from "../AdminForm";
import { NoRows, PageHead, Panel, Swatch } from "../ui";
import { Field, Pill, cx, inputClass } from "@/components/ui";

/**
 * The palette.
 *
 * Every colour the shop offers, and how many rolls of each are on the shelf.
 *
 * Two things about the shape of this screen are deliberate.
 *
 *   1. Each colour is its own form. Eighteen rows behind one Save button means
 *      a typo in row three is a save nobody can undo, and it means the whole
 *      table has to be re-read to change one hex code.
 *   2. The roll count is a *second*, separate form, because counting stock is
 *      the "inventory" capability and editing the palette is "colours". Two
 *      forms side by side, never one inside the other — a nested <form> is
 *      invalid HTML, and the browser silently drops the inner one, so the
 *      count would look like it saved and never leave the page.
 */
// Without its own title a page falls back to the layout default, so seven
// studio screens all read "Studio · Bam Studio" in the tab and a person with
// three of them open cannot tell which is which.
export const metadata = { title: "Colours · Studio" };

export default async function ColoursPage() {
  const staff = await requireStaff("colours");

  const colours = await getColours();
  // No role currently has one without the other, but the check is here rather
  // than assumed: a form that redirects on submit is worse than no form.
  const mayCount = can(staff.role, "inventory");

  const nextSort =
    colours.length === 0 ? 0 : Math.max(...colours.map((c) => c.sortOrder)) + 1;

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Colours"
        subtitle={
          <>
            The palette the shop offers, in the order it is shown. A colour can
            be turned off but never deleted — once a product prints in it, a
            foreign key holds it in place, which is what stops an old order
            losing the colour it was made in.
          </>
        }
      />

      <Panel
        title="The palette"
        note={
          colours.length === 1
            ? "1 colour"
            : `${colours.length} colours · ${colours.filter((c) => c.active).length} offered in the shop`
        }
        padded={false}
      >
        {colours.length === 0 ? (
          <NoRows>
            No colours yet. Add the first one below and the shop will start
            offering it.
          </NoRows>
        ) : (
          <ul className="divide-y divide-line">
            {colours.map((colour) => (
              <li
                key={colour.id}
                className="grid items-start gap-x-6 gap-y-4 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_230px]"
              >
                <ColourFields colour={colour} />
                <RollCount colour={colour} mayCount={mayCount} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Add a colour"
        note="It starts with no rolls on the shelf. Count them in on the row once it appears above."
      >
        <AdminForm action={saveColour}>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[200px] flex-1">
              <Field label="Name" htmlFor="new-name">
                <input
                  id="new-name"
                  name="name"
                  required
                  maxLength={60}
                  placeholder="Butter Yellow"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="w-[160px]">
              <Field label="Hex" htmlFor="new-hex" hint="Six digits, like #F2C94C">
                <input
                  id="new-hex"
                  name="hex"
                  required
                  pattern="#[0-9A-Fa-f]{6}"
                  placeholder="#F2C94C"
                  className={cx(inputClass, "font-mono uppercase")}
                />
              </Field>
            </div>

            <div className="w-[130px]">
              <Field label="Sort order" htmlFor="new-sort">
                <input
                  id="new-sort"
                  name="sort_order"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={nextSort}
                  className={inputClass}
                />
              </Field>
            </div>

            <Checkbox
              id="new-active"
              name="active"
              label="Offer it in the shop"
              defaultChecked
            />

            <SubmitButton size="md" pendingLabel="Adding…">
              Add colour
            </SubmitButton>
          </div>
        </AdminForm>
      </Panel>
    </div>
  );
}

/** One colour's own form: name, hex, order and whether the shop offers it. */
function ColourFields({ colour }: { colour: ColourRow }) {
  return (
    <AdminForm action={saveColour} className="min-w-0">
      <input type="hidden" name="id" value={colour.id} />

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex flex-col gap-2 pb-2.5">
          <Swatch hex={colour.hex} size={28} />
          <Pill tone={colour.active ? "good" : "neutral"}>
            {colour.active ? "Offered" : "Hidden"}
          </Pill>
        </div>

        <div className="min-w-[170px] flex-1">
          <Field label="Name" htmlFor={`name-${colour.id}`}>
            <input
              id={`name-${colour.id}`}
              name="name"
              defaultValue={colour.name}
              required
              maxLength={60}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="w-[150px]">
          <Field label="Hex" htmlFor={`hex-${colour.id}`}>
            <input
              id={`hex-${colour.id}`}
              name="hex"
              defaultValue={colour.hex}
              required
              pattern="#[0-9A-Fa-f]{6}"
              className={cx(inputClass, "font-mono uppercase")}
            />
          </Field>
        </div>

        <div className="w-[120px]">
          <Field label="Sort order" htmlFor={`sort-${colour.id}`}>
            <input
              id={`sort-${colour.id}`}
              name="sort_order"
              type="number"
              min={0}
              step={1}
              defaultValue={colour.sortOrder}
              className={inputClass}
            />
          </Field>
        </div>

        <Checkbox
          id={`active-${colour.id}`}
          name="active"
          label="Offered"
          defaultChecked={colour.active}
        />

        <SubmitButton variant="soft" size="sm">
          Save
        </SubmitButton>
      </div>
    </AdminForm>
  );
}

/**
 * The roll count — a separate form, and a separate capability.
 *
 * Sits beside the colour form, never inside it.
 */
function RollCount({
  colour,
  mayCount,
}: {
  colour: ColourRow;
  mayCount: boolean;
}) {
  if (!mayCount) {
    return (
      <div className="pt-1 text-[13.5px] text-muted">
        <span className="font-bold tabular-nums text-ink">
          {colour.rollsOnHand}
        </span>{" "}
        {colour.rollsOnHand === 1 ? "roll" : "rolls"} on hand
      </div>
    );
  }

  return (
    <AdminForm action={setRolls} className="min-w-0">
      <input type="hidden" name="colour_id" value={colour.id} />

      <div className="flex items-end gap-3">
        <div className="w-[110px]">
          <Field label="Rolls" htmlFor={`rolls-${colour.id}`}>
            <input
              id={`rolls-${colour.id}`}
              name="rolls_on_hand"
              type="number"
              min={0}
              step={1}
              defaultValue={colour.rollsOnHand}
              className={inputClass}
            />
          </Field>
        </div>
        <SubmitButton variant="soft" size="sm" pendingLabel="Counting…">
          Count
        </SubmitButton>
      </div>
    </AdminForm>
  );
}

/**
 * A checkbox with its label.
 *
 * components/ui has no checkbox, so this is the closest thing to house style
 * rather than a new component: the same 12-unit height as `inputClass`, so it
 * sits on the same baseline as the fields beside it.
 */
function Checkbox({
  id,
  name,
  label,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-12 shrink-0 cursor-pointer items-center gap-2 text-[13.5px] font-extrabold"
    >
      <input
        id={id}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}
