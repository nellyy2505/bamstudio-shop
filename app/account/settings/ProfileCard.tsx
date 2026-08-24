"use client";

import { useState } from "react";
import { Alert, Button, Field, cx, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { SHOP } from "@/lib/config";

export function ProfileCard({
  userId,
  email,
  firstName,
  lastName,
  phone,
}: {
  userId: string;
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
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || null,
          phone: form.phone.trim() || null,
        })
        .eq("id", userId);

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
      <p className="mt-1 text-[13.5px] text-muted">
        The name we put on your parcels and order emails.
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
            hint={`Changing the email on an account needs a hand from us — email ${SHOP.supportEmail}.`}
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
