import Link from "next/link";
import { requireStaff } from "@/lib/auth/staff";
import { getBakeryStudio } from "../data";
import { saveBakeryColours, saveBakeryDesign, saveBakeryFillings } from "../actions";
import { AdminForm, SubmitButton } from "../AdminForm";
import { NoRows, PageHead, Panel, Swatch } from "../ui";
import { Field, Pill, inputClass } from "@/components/ui";
import { getLadder, priceFor } from "@/lib/pricing/builder";
import { money } from "@/lib/format";

export const metadata = { title: "Bakery box · Studio" };

/**
 * The bakery box, as the four things that have to be true before it sells.
 *
 * A box, a design, a colour and something to put in it. Any one of them missing
 * and the builder cannot render, so this page leads with which of the four are
 * still empty rather than making somebody work it out from four panels.
 */
export default async function BakeryStudioPage() {
  await requireStaff("catalogue");

  const [studio, ladder] = await Promise.all([
    getBakeryStudio(),
    getLadder("bakery_box"),
  ]);

  const chosenColours = studio.colours.filter((c) => c.chosen).length;
  const chosenFillings = studio.candidates.filter((c) => c.chosen).length;
  const activeDesigns = studio.designs.filter((d) => d.active).length;

  const pricedBoxes = studio.boxes.filter(
    (box) => box.pieceCount !== null && priceFor(ladder, box.pieceCount) !== null,
  );

  const blockers = [
    pricedBoxes.length === 0 ? "no priced box" : null,
    activeDesigns === 0 ? "no design" : null,
    chosenColours === 0 ? "no colour" : null,
    chosenFillings === 0 ? "nothing to put in it" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Bakery box"
        subtitle="A box the customer fills themselves. One price whatever goes in it."
      />

      {blockers.length > 0 ? (
        <div className="card border-warn-soft bg-warn-soft/50 p-5 text-[14px]">
          <b className="text-warn">The builder is not on sale yet.</b> It needs a
          box, a design, a colour and some pieces, and it is missing{" "}
          {blockers.join(", ")}. The page says so to shoppers rather than showing
          a box nobody can fill.
        </div>
      ) : null}

      <Panel
        title="The boxes"
        note="A box is a product in bakery mode. Its price is the rung matching how many pieces it holds."
      >
        {studio.boxes.length === 0 ? (
          <NoRows>
            No boxes yet. Add a product, set{" "}
            <b>Designed by the customer</b> to <b>A bakery box they fill</b>, and
            say how many pieces it holds.
          </NoRows>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {studio.boxes.map((box) => {
              const price = box.pieceCount === null ? null : priceFor(ladder, box.pieceCount);
              return (
                <li
                  key={box.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2.5 last:border-0"
                >
                  <div>
                    <Link
                      href={`/admin/products/${box.id}`}
                      className="font-semibold hover:text-accent"
                    >
                      {box.name}
                    </Link>
                    <div className="text-[13px] text-faint">
                      {box.pieceCount === null
                        ? "no piece count set"
                        : `holds ${box.pieceCount}`}
                    </div>
                  </div>
                  {price === null ? (
                    /* Not "sold out". The shop has simply never set a price for
                       a box this size, and it stays off sale until somebody
                       does rather than being sold at a guessed figure. */
                    <Pill tone="warn">Not priced, so not on sale</Pill>
                  ) : (
                    <span className="font-semibold tabular-nums">{money(price)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-[13px] text-muted">
          Prices live in{" "}
          <Link href="/admin/settings" className="font-bold text-accent">
            Settings, under What a build costs
          </Link>
          . A box size with no price there does not appear in the shop.
        </p>
      </Panel>

      <Panel title="Designs" note="The lid. Every design is offered in every colour.">
        <div className="flex flex-col gap-5">
          {studio.designs.map((design) => (
            <DesignForm key={design.id} design={design} />
          ))}
          <div className="border-t border-line pt-5">
            <DesignForm design={null} />
          </div>
        </div>
      </Panel>

      <Panel
        title="Colours"
        note="Which filament colours boxes are printed in. Tick the ones you actually print."
      >
        <AdminForm action={saveBakeryColours}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {studio.colours.map((colour) => (
              <label
                key={colour.id}
                className="flex cursor-pointer items-center gap-2.5 text-[14px]"
              >
                <input
                  type="checkbox"
                  name="colour"
                  value={colour.id}
                  defaultChecked={colour.chosen}
                  className="h-4 w-4 accent-accent"
                />
                <Swatch hex={colour.hex} />
                <span>{colour.name}</span>
                {colour.active ? null : <Pill tone="neutral">off</Pill>}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <SubmitButton size="md">Save colours</SubmitButton>
            <span className="text-[13px] text-muted">
              A colour turned off in Colours disappears from the builder whether
              or not it is ticked here.
            </span>
          </div>
        </AdminForm>
      </Panel>

      <Panel
        title="What can go in a box"
        note="Tick every piece a customer may choose. Most of these are not sold on their own, which is the Listed in the online shop box on the product."
      >
        <AdminForm action={saveBakeryFillings}>
          <div className="grid gap-2 sm:grid-cols-2">
            {studio.candidates.map((product) => (
              <label
                key={product.id}
                className="flex cursor-pointer items-start gap-2.5 text-[14px]"
              >
                <input
                  type="checkbox"
                  name="filling"
                  value={product.id}
                  defaultChecked={product.chosen}
                  className="mt-1 h-4 w-4 accent-accent"
                />
                <span>
                  <span className="font-semibold">{product.name}</span>
                  <span className="block text-[12.5px] text-faint">
                    {product.sku} · {product.category}
                    {product.active ? "" : " · not in the shop"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <SubmitButton size="md">Save the pool</SubmitButton>
            <span className="text-[13px] text-muted">
              {chosenFillings} ticked. Order here is the order they appear in the
              builder.
            </span>
          </div>
        </AdminForm>
      </Panel>

      <p className="text-[13px] text-muted">
        <b>One price whatever goes in.</b> That means the studio carries the
        difference between a box of four cheap pieces and a box of four dear
        ones, and a customer picking four of the dearest is allowed. Price the
        box against that combination rather than the average one, and check it
        again whenever something expensive joins the pool.
      </p>
    </div>
  );
}

function DesignForm({
  design,
}: {
  design: {
    id: string;
    slug: string;
    name: string;
    blurb: string;
    hasWindow: boolean;
    sortOrder: number;
    active: boolean;
  } | null;
}) {
  return (
    <AdminForm action={saveBakeryDesign}>
      {design ? <input type="hidden" name="id" value={design.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`name-${design?.id ?? "new"}`}>
          <input
            id={`name-${design?.id ?? "new"}`}
            name="name"
            defaultValue={design?.name ?? ""}
            placeholder="Window lid"
            className={inputClass}
          />
        </Field>
        <Field
          label="Short name"
          htmlFor={`slug-${design?.id ?? "new"}`}
          hint="Lowercase, hyphens. It is how an order records which lid to use."
        >
          <input
            id={`slug-${design?.id ?? "new"}`}
            name="slug"
            defaultValue={design?.slug ?? ""}
            placeholder="window"
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <Field label="Blurb" htmlFor={`blurb-${design?.id ?? "new"}`}>
        <input
          id={`blurb-${design?.id ?? "new"}`}
          name="blurb"
          maxLength={300}
          defaultValue={design?.blurb ?? ""}
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-5">
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-extrabold">
          <input
            type="checkbox"
            name="has_window"
            defaultChecked={design?.hasWindow ?? false}
            className="h-4 w-4 accent-accent"
          />
          Has a window
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[13.5px] font-extrabold">
          <input
            type="checkbox"
            name="active"
            defaultChecked={design?.active ?? true}
            className="h-4 w-4 accent-accent"
          />
          Offered
        </label>
        <label className="flex items-center gap-2 text-[13.5px]">
          <span className="font-extrabold">Order</span>
          <input
            name="sort_order"
            type="number"
            defaultValue={design?.sortOrder ?? 0}
            className={`${inputClass} !h-10 !w-20 !px-2.5`}
          />
        </label>
        <SubmitButton variant="soft" size="sm">
          {design ? "Save" : "Add this design"}
        </SubmitButton>
      </div>
    </AdminForm>
  );
}
