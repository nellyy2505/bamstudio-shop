"use client";

import { useState } from "react";
import { Alert, Button, Field, Icon, inputClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const MIN_LENGTH = 8;

type Errors = Partial<Record<"current" | "next" | "confirm", string>>;

export function PasswordCard({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(
    "idle",
  );
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();

    const found: Errors = {};
    if (!current) found.current = "Enter your current password";
    if (next.length < MIN_LENGTH) {
      found.next = `Use at least ${MIN_LENGTH} characters`;
    }
    if (confirm !== next) found.confirm = "The two passwords don't match";
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setState("saving");
    try {
      const supabase = createClient();

      // Supabase updates a password from the session alone, so re-signing in
      // is what actually proves the person at the keyboard knows the old one.
      const { error: signIn } = await supabase.auth.signInWithPassword({
        email,
        password: current,
      });
      if (signIn) {
        setState("idle");
        setErrors({ current: "That current password isn't right" });
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw new Error(error.message);

      setCurrent("");
      setNext("");
      setConfirm("");
      setState("done");
      setMessage(null);
    } catch (cause) {
      setState("error");
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Could not change your password. Please try again.",
      );
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="password-heading">
      <h2 id="password-heading" className="text-xl">
        Password
      </h2>
      <p className="mt-1 text-[13.5px] text-muted">
        At least {MIN_LENGTH} characters. You stay signed in on this device.
      </p>

      <form onSubmit={save} noValidate className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field
            label="Current password"
            htmlFor="password-current"
            error={errors.current}
          >
            <input
              id="password-current"
              type="password"
              className={inputClass}
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
        </div>

        <Field label="New password" htmlFor="password-new" error={errors.next}>
          <input
            id="password-new"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </Field>

        <Field
          label="Confirm new password"
          htmlFor="password-confirm"
          error={errors.confirm}
        >
          <input
            id="password-confirm"
            type="password"
            className={inputClass}
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>

        {state === "done" ? (
          <div className="sm:col-span-2">
            <Alert tone="success">Password changed.</Alert>
          </div>
        ) : null}
        {state === "error" && message ? (
          <div className="sm:col-span-2">
            <Alert tone="error">{message}</Alert>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" size="sm" disabled={state === "saving"}>
            <Icon name="lock" size={15} />
            {state === "saving" ? "Updating…" : "Update password"}
          </Button>
        </div>
      </form>
    </section>
  );
}
