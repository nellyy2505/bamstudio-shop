"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Alert, cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type PreferenceKey =
  | "marketing_opt_in"
  | "review_reminders"
  | "restock_alerts";

/**
 * These switches save a preference and nothing more.
 *
 * No sender reads them: there is no mailing list, no review reminder job and no
 * restock alert anywhere in this codebase, in any configuration. So each one is
 * described as what it is — a note of what you would like *if* we ever build it
 * — rather than as a subscription to mail that would never arrive.
 *
 * This is unconditional and separate from `canSendEmail` below. Setting the
 * Resend secrets turns on the order confirmation; it does not turn any of these
 * three into something that sends.
 */
const PREFERENCES: {
  key: PreferenceKey;
  label: string;
  description: string;
}[] = [
  {
    key: "marketing_opt_in",
    label: "New drops and offers",
    description:
      "Say yes and we will count you in when there is a list to add you to — a note when a new colourway lands, no more than monthly.",
  },
  {
    key: "review_reminders",
    label: "Review reminders",
    description:
      "Say yes and you would not mind a nudge to review, a couple of weeks after a parcel arrives.",
  },
  {
    key: "restock_alerts",
    label: "Restock alerts",
    description:
      "Say yes and you would like to hear when something you looked at is printed again.",
  },
];

function Switch({
  on,
  labelledBy,
  disabled,
  onToggle,
}: {
  on: boolean;
  labelledBy: string;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-disabled={disabled ? true : undefined}
      disabled={disabled}
      onClick={onToggle}
      className={cx(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        on ? "bg-good" : "bg-line2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-1 h-5 w-5 rounded-full bg-surface shadow-sm transition-[left]",
          on ? "left-6" : "left-1",
        )}
      />
    </button>
  );
}

export function EmailPreferences({
  userId,
  canSendEmail,
  marketingOptIn,
  reviewReminders,
  restockAlerts,
}: {
  userId: string;
  /**
   * Whether the shop can send its own email — `isEmailConfigured()`, read on
   * the server by the settings page and handed down.
   *
   * It arrives as a prop and is never read here, for two reasons. The secrets
   * it derives from are not `NEXT_PUBLIC_`, so this component would see
   * `undefined` and silently answer "we send nothing" while the shop was in
   * fact emailing order confirmations; and the server render and the hydrated
   * render would then produce different words, which is a hydration mismatch on
   * top of a lie. A boolean prop serialises identically on both sides.
   */
  canSendEmail: boolean;
  marketingOptIn: boolean;
  reviewReminders: boolean;
  restockAlerts: boolean;
}) {
  const baseId = useId();
  const [values, setValues] = useState<Record<PreferenceKey, boolean>>({
    marketing_opt_in: marketingOptIn,
    review_reminders: reviewReminders,
    restock_alerts: restockAlerts,
  });
  const [error, setError] = useState<string | null>(null);

  async function toggle(key: PreferenceKey) {
    const next = !values[key];
    const previous = values;
    setValues({ ...values, [key]: next });
    setError(null);

    try {
      const supabase = createClient();
      // upsert so a missing profile row self-heals rather than silently
      // updating zero rows and reporting success.
      const { error: cause } = await supabase
        .from("profiles")
        .upsert({ id: userId, [key]: next });
      if (cause) throw new Error(cause.message);
    } catch (cause) {
      setValues(previous);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save that preference. Please try again.",
      );
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="email-prefs-heading">
      <h2 id="email-prefs-heading" className="text-xl">
        Email preferences
      </h2>
      {/* "There is no mailing list" is true in every configuration. "Nothing
          here emails you" was not, twice over: with the Resend secrets set the
          shop emails an order confirmation, and Supabase Auth sends the
          address-confirmation and password-reset mail in EVERY configuration,
          secrets or no secrets. So the denial is narrowed to these three
          switches and the mail that does go out is named. */}
      <p className="mt-1 text-[13.5px] text-muted">
        We do not send any of these yet — there is no mailing list, no review
        reminders and no restock alerts. Flicking a switch saves your choice for
        the day we can act on it, and nothing goes out in the meantime. The only
        mail you get from us is{" "}
        {canSendEmail
          ? "the order confirmation when you pay, and the emails that confirm your address or reset your password"
          : "the emails that confirm your address or reset your password"}
        , and none of it is affected by these switches.
      </p>

      <div className="mt-5 flex flex-col divide-y divide-line border-t border-line">
        {PREFERENCES.map((preference) => {
          const labelId = `${baseId}-${preference.key}`;
          return (
            <div
              key={preference.key}
              className="flex items-start justify-between gap-4 py-4"
            >
              <div>
                <b id={labelId} className="text-[14.5px]">
                  {preference.label}
                </b>
                <p className="mt-0.5 text-[13px] text-muted">
                  {preference.description}
                </p>
              </div>
              <Switch
                on={values[preference.key]}
                labelledBy={labelId}
                onToggle={() => toggle(preference.key)}
              />
            </div>
          );
        })}

        {/* Was a permanently-on switch promising receipts, printing progress
            and tracking emails. Printing progress and tracking are never
            emailed in any configuration, so those stay denied outright. The
            order confirmation IS a receipt by any customer's reading, so the
            denial of that half is gated — this line used to deny it flat while
            the shop was sending one. There is still nothing to switch: the
            confirmation is part of buying, not a subscription. */}
        <div className="py-4">
          <b className="text-[14.5px]">Order updates</b>
          <p className="mt-0.5 text-[13px] text-muted">
            {canSendEmail
              ? "We email you one order confirmation when your payment goes through, listing what you ordered and the total paid. We do not email printing progress or tracking."
              : "We do not email receipts, printing progress or tracking."}{" "}
            Your order number, its progress and any tracking number are on your{" "}
            <Link
              href="/account/orders"
              className="font-bold text-accent underline underline-offset-2"
            >
              orders page
            </Link>
            .
          </p>
        </div>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
    </section>
  );
}
