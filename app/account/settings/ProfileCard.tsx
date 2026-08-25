"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button, Field, cx, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { SHOP } from "@/lib/config";
import { formsReachStudio, hasStudioMailbox, socialLinks } from "@/lib/contact";

const LINK = "font-bold text-accent underline underline-offset-2";

/**
 * How to ask us for a hand, using only channels that exist. `SHOP.supportEmail`
 * renders the literal string "[HELLO@YOURDOMAIN]" when unset, so it may never
 * be printed without `hasStudioMailbox`. Same chain as the legal pages; the
 * predicates now live in lib/contact.ts, the markup cannot.
 *
 * @param canSendEmail server-read capability, threaded in as a prop — see the
 *   note on the component's props. Never read the secrets here: this is a
 *   client component and would answer false in the browser.
 */
function emailChangeHint(canSendEmail: boolean) {
  const formDelivers = formsReachStudio(canSendEmail);
  if (hasStudioMailbox) {
    return (
      <>
        Changing the email on an account needs a hand from us — write to{" "}
        <a href={`mailto:${SHOP.supportEmail}`} className={LINK}>
          {SHOP.supportEmail}
        </a>
        {formDelivers ? (
          <>
            {" "}
            or use the{" "}
            <Link href="/contact" className={LINK}>
              contact form
            </Link>
          </>
        ) : null}
        .
      </>
    );
  }

  const handles = socialLinks;

  if (handles.length > 0) {
    return (
      <>
        Changing the email on an account needs a hand from us — message us on{" "}
        {handles.map((handle, index) => (
          <span key={handle.label}>
            {index > 0 ? " or " : ""}
            <a href={handle.href} className={LINK}>
              {handle.label}
            </a>
          </span>
        ))}
        .
      </>
    );
  }

  return (
    <>
      Changing the email on an account needs a hand from us, and we have not
      published a way to reach us yet.
    </>
  );
}

export function ProfileCard({
  userId,
  canSendEmail,
  email,
  firstName,
  lastName,
  phone,
}: {
  userId: string;
  /**
   * Whether the shop can send its own email — `isEmailConfigured()`, read on
   * the server by the settings page and handed down. It cannot be read here:
   * the secrets behind it are not `NEXT_PUBLIC_`, so this client component
   * would see `undefined`, offer the contact form as a second door when it does
   * not deliver, and render different words before and after hydration.
   */
  canSendEmail: boolean;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}) {
  const [form, setForm] = useState({
    first_name: firstName,
    last_name: lastName,
    phone,
  });
  const [errors, setErrors] = useState<{ first_name?: string }>({});
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form.first_name.trim()) {
      setErrors({ first_name: "Enter a first name" });
      return;
    }
    setErrors({});
    setState("saving");

    try {
      const supabase = createClient();
      // upsert, not update: a 0-row update reports no error, so an account
      // whose trigger-created profile row is missing would "save" nothing.
      const { error } = await supabase.from("profiles").upsert({
        id: userId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim() || null,
        phone: form.phone.trim() || null,
      });

      if (error) throw new Error(error.message);
      setState("done");
      setMessage(null);
    } catch (cause) {
      setState("error");
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Could not save your details. Please try again.",
      );
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="text-xl">
        Profile
      </h2>
      {/* The name goes on the parcel, and — where the Resend secrets are set —
          onto the order confirmation's delivery details. Neither is a claim
          this line needs to make, so it says the part that is true in every
          configuration and no more. */}
      <p className="mt-1 text-[13.5px] text-muted">
        The name we put on your parcels.
      </p>

      <form onSubmit={save} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          label="First name"
          htmlFor="profile-first-name"
          error={errors.first_name}
        >
          <input
            id="profile-first-name"
            className={inputClass}
            autoComplete="given-name"
            value={form.first_name}
            onChange={(event) =>
              setForm({ ...form, first_name: event.target.value })
            }
          />
        </Field>

        <Field label="Last name" htmlFor="profile-last-name">
          <input
            id="profile-last-name"
            className={inputClass}
            autoComplete="family-name"
            value={form.last_name}
            onChange={(event) =>
              setForm({ ...form, last_name: event.target.value })
            }
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Email address"
            htmlFor="profile-email"
            hint={emailChangeHint(canSendEmail)}
          >
            <input
              id="profile-email"
              type="email"
              className={cx(inputClass, "bg-cream text-muted")}
              value={email}
              readOnly
              aria-readonly="true"
            />
          </Field>
        </div>

        <div className="sm:col-span-2">
          <Field
            label="Phone"
            htmlFor="profile-phone"
            hint="Only used if a courier needs to reach you — optional"
          >
            <input
              id="profile-phone"
              type="tel"
              className={inputClass}
              autoComplete="tel"
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </Field>
        </div>

        {state === "done" ? (
          <div className="sm:col-span-2">
            <Alert tone="success">Your details are saved.</Alert>
          </div>
        ) : null}
        {state === "error" && message ? (
          <div className="sm:col-span-2">
            <Alert tone="error">{message}</Alert>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </section>
  );
}
