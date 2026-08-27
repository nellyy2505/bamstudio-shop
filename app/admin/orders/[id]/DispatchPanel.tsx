import { Alert, Field, Pill, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../../AdminForm";
import { markShipped, undoDispatch } from "../../actions";
import { Panel, Unknown } from "../../ui";
import type { OrderDetail } from "../../data";

/**
 * Recording a dispatch — the one moment an order picks up a tracking number.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN PANEL AND ITS OWN BUTTON.
 *
 * Everything else on this screen is a running commentary on work happening in
 * the studio: printing, packed, delivered. Those are cheap to say, cheap to
 * take back, and said many times a day. Posting a parcel is not one of those.
 * It is a one-way event in the physical world, it is the only transition that
 * publishes a new fact to the customer, and it is the only one where a second
 * piece of information — the article number — exists at that instant and at no
 * other. It had been the cheapest thing on the page to do by accident: one
 * mis-picked line of the status dropdown, on the control used for everything.
 *
 * So dispatch has its own panel, its own verb, and its own action. The status
 * dropdown next door no longer offers `shipped` at all, and `setOrderStatus`
 * refuses it even if the request is hand-made — a server action is a public
 * endpoint and a dropdown is not a check.
 *
 * NOTHING HERE SHOWS A COST OR A MARGIN. The "orders" capability is held by
 * Packing staff, and this panel is squarely aimed at them.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The recipient, for the one line that says which parcel this button posts. */
function recipientName(order: OrderDetail): string | null {
  const address = order.shippingAddress;
  const part = (key: string): string => {
    const value = address[key];
    return typeof value === "string" ? value.trim() : "";
  };
  const name = [part("first_name"), part("last_name")].filter(Boolean).join(" ");
  return name || null;
}

/**
 * What the customer was *sold*, read from `orders.quoted_service_code`.
 *
 * This is the honest starting point for the tracking question: a basket quoted
 * as a Large Letter was never going to get a number, and one quoted as a parcel
 * was. When the column is null — an order from before postage was quoted, or a
 * sale typed in at a market — it says so rather than picking a side. Nothing
 * here is a default the form can act on by itself; `markShipped` still refuses
 * a dispatch whose tracking answer contradicts what was typed.
 */
function SoldAs({ order }: { order: OrderDetail }) {
  if (order.soldAsTracked === true) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] text-muted">
        <Pill tone="good">Sold as a tracked parcel</Pill>
        <span>There should be an article number on the label.</span>
      </div>
    );
  }

  if (order.soldAsTracked === false) {
    return (
      <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] text-muted">
        <Pill tone="line">Sold as a Large Letter</Pill>
        <span>Australia Post gives no tracking on these, so no number is expected.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5 text-[13.5px] text-muted">
      <Unknown what="Service not recorded" />
      <span>
        Nothing on this order says which postage service it was sold as, so go by
        what the label says.
      </span>
    </div>
  );
}

/** One of the two answers to "did this parcel go with tracking?". */
function TrackingChoice({
  value,
  label,
  detail,
  defaultChecked,
}: {
  value: "tracked" | "untracked";
  label: string;
  detail: string;
  defaultChecked: boolean;
}) {
  return (
    <label
      htmlFor={`tracking_mode_${value}`}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-line2 bg-surface px-4 py-3"
    >
      <input
        id={`tracking_mode_${value}`}
        type="radio"
        name="tracking_mode"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-1 h-4 w-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-[14px] font-extrabold">{label}</span>
        <span className="block text-[13px] text-muted">{detail}</span>
      </span>
    </label>
  );
}

/**
 * The dispatch form. Both choices and the number are always visible: this is a
 * server component with no client state, so nothing is hidden or disabled
 * behind JavaScript, and the contradiction ("no tracking" plus a typed number)
 * is caught by the action rather than by an input that quietly went grey.
 *
 * `defaultTracked` only ever pre-selects a radio from something already
 * recorded — the service the postage was quoted for on a first dispatch, or
 * what is actually saved when correcting one. `null` leaves both unanswered,
 * and `markShipped` refuses a submission with no answer rather than reading a
 * blank as "untracked".
 */
function DispatchForm({
  order,
  defaultTracked,
  submitLabel,
  caption,
}: {
  order: OrderDetail;
  defaultTracked: boolean | null;
  submitLabel: string;
  caption: string;
}) {
  return (
    <AdminForm action={markShipped}>
      <input type="hidden" name="id" value={order.id} />

      <SoldAs order={order} />

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1.5 text-[13.5px] font-extrabold">
          Did this parcel go with tracking?
        </legend>
        <TrackingChoice
          value="tracked"
          label="Yes — here is the number"
          detail="From the Australia Post label. Paste just the number."
          defaultChecked={defaultTracked === true}
        />
        <TrackingChoice
          value="untracked"
          label="No — posted without tracking"
          detail="Nothing to follow. The customer is told that, rather than shown a blank."
          defaultChecked={defaultTracked === false}
        />
      </fieldset>

      <Field
        label="Tracking number"
        htmlFor="tracking_number"
        hint="Leave this empty if you chose “posted without tracking”."
      >
        <input
          id="tracking_number"
          name="tracking_number"
          type="text"
          autoComplete="off"
          spellCheck={false}
          /*
           * Never prefilled, not even when correcting a dispatch. The reason to
           * open this form is that the saved number is wrong, and a box that
           * arrives already holding the wrong number is one that gets submitted
           * again unchanged.
           */
          defaultValue=""
          placeholder="33ABC123456789"
          className={inputClass}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">{submitLabel}</SubmitButton>
        <span className="text-[13px] text-muted">{caption}</span>
      </div>

      <Alert>
        No email goes out. The customer sees this on the tracking page and in
        their account, which is what every page on the shop tells them to check.
      </Alert>
    </AdminForm>
  );
}

/**
 * What was recorded, once the parcel has gone.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT A NULL `tracking_number` IS ALLOWED TO MEAN HERE.
 *
 * The column is one nullable text field, so "posted with nothing to follow"
 * and "posted, but the number was never written down" are the same value in
 * the database. Nothing in the schema tells them apart. What keeps them apart
 * is `markShipped`, which is the only thing that writes this column and which
 * refuses to record a tracked dispatch with an empty box — so a `shipped` row
 * with no number can only have got there by somebody deliberately answering
 * "posted without tracking". That is an application invariant, not a
 * constraint: a hand edit in the Supabase table editor still breaks it.
 *
 * The one case a null genuinely does not mean "posted" is a sale typed in at a
 * market, which `recordSale` writes straight to `delivered` with
 * `shipping_method` of `in_person`. Nothing was ever posted, and saying it went
 * untracked would be untrue, so that is read off the method rather than
 * assumed.
 * ────────────────────────────────────────────────────────────────────────────
 */
function RecordedDispatch({ order }: { order: OrderDetail }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12.5px] font-extrabold tracking-[0.04em] text-faint">
        RECORDED
      </span>
      {order.trackingNumber ? (
        <span className="font-mono text-[14px] break-all select-all">
          {order.trackingNumber}
        </span>
      ) : order.shippingMethod === "in_person" ? (
        <span className="text-[14px] text-muted">
          Handed over in person. Nothing was posted, so there is nothing to follow.
        </span>
      ) : (
        <span className="text-[14px] text-muted">
          Posted without tracking — there is no number to follow.
        </span>
      )}
    </div>
  );
}

export function DispatchPanel({ order }: { order: OrderDetail }) {
  if (order.status === "cancelled") {
    return (
      <Panel title="Post this parcel">
        <p className="text-[14px] text-muted">
          This order is cancelled, so there is nothing to post.
        </p>
        {/*
          * An order cancelled *after* the parcel went still has a real article
          * number on it, and that is the number somebody chasing a refund will
          * need. It stays on screen rather than being tidied away with the
          * form.
          */}
        {order.trackingNumber ? (
          <div className="mt-4 border-t border-line pt-4">
            <RecordedDispatch order={order} />
          </div>
        ) : null}
      </Panel>
    );
  }

  if (order.status === "delivered") {
    return (
      <Panel
        title="Post this parcel"
        note="Already arrived, so there is nothing left to record here."
      >
        <RecordedDispatch order={order} />
      </Panel>
    );
  }

  if (order.status === "shipped") {
    return (
      <Panel
        title="Posted"
        note="What the customer can see on the tracking page right now."
      >
        <div className="flex flex-col gap-6">
          <RecordedDispatch order={order} />

          <div className="border-t border-line pt-5">
            <h3 className="text-[14px] font-extrabold">Wrong number?</h3>
            <p className="mt-1 mb-3 text-[13px] text-muted">
              Record it again. Answer the tracking question the same way you
              would the first time — this replaces what is saved.
            </p>
            <DispatchForm
              order={order}
              // Correcting: start from what is actually on the row, not from
              // what the postage was sold as. The two can legitimately differ —
              // a letter-quoted basket that grew and went as a parcel.
              defaultTracked={order.trackingNumber !== null}
              submitLabel="Replace what is recorded"
              caption="Overwrites the tracking number saved above."
            />
          </div>

          <div className="border-t border-line pt-5">
            <h3 className="text-[14px] font-extrabold">Not posted after all?</h3>
            <p className="mt-1 mb-3 text-[13px] text-muted">
              Puts it back to packed and removes the tracking number. There is no
              history kept, so the number is gone — keep the label until you are
              sure.
            </p>
            <AdminForm action={undoDispatch}>
              <input type="hidden" name="id" value={order.id} />
              <div>
                <SubmitButton variant="soft" size="sm" pendingLabel="Undoing…">
                  Undo this dispatch
                </SubmitButton>
              </div>
            </AdminForm>
          </div>
        </div>
      </Panel>
    );
  }

  const name = recipientName(order);

  return (
    <Panel
      title="Post this parcel"
      note="The tracking number is recorded here, at the moment the parcel goes."
    >
      <DispatchForm
        order={order}
        defaultTracked={order.soldAsTracked}
        submitLabel="Post this parcel"
        caption={`Marks ${order.orderNumber ?? "this order"}${name ? ` — ${name}` : ""} as posted.`}
      />
    </Panel>
  );
}
