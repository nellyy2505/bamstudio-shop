"use client";

import { useId, useState } from "react";
import { Alert, cx } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type PreferenceKey =
  | "marketing_opt_in"
  | "review_reminders"
  | "restock_alerts";

const PREFERENCES: {
  key: PreferenceKey;
  label: string;
  description: string;
}[] = [
  {
    key: "marketing_opt_in",
    label: "New drops and offers",
    description: "A note when a new colourway or collection lands. Rarely more than monthly.",
  },
  {
    key: "review_reminders",
    label: "Review reminders",
    description: "One nudge a couple of weeks after your parcel arrives.",
  },
  {
    key: "restock_alerts",
    label: "Restock alerts",
    description: "When something you looked at is printed and back in stock.",
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
  marketingOptIn,
  reviewReminders,
  restockAlerts,
}: {
  userId: string;
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
      const { error: cause } = await supabase
        .from("profiles")
        .update({ [key]: next })
        .eq("id", userId);
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
      <p className="mt-1 text-[13.5px] text-muted">
        Changes save the moment you flick a switch.
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

        <div className="flex items-start justify-between gap-4 py-4">
          <div>
            <b id={`${baseId}-order-updates`} className="text-[14.5px]">
              Order updates
            </b>
            <p className="mt-0.5 text-[13px] text-muted">
              Receipts, printing progress and tracking. These are part of buying
              from us, so they can&apos;t be switched off.
            </p>
          </div>
          <Switch on labelledBy={`${baseId}-order-updates`} disabled />
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
