"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, cx } from "@/components/ui";
import type { FormState } from "./actions";

/**
 * The one form wrapper the staff area uses.
 *
 * React 19's `useActionState` needs a client component, but only the wrapper
 * does — the fields inside are passed as children from a server component, so
 * nothing about a product, an order or a cost ends up in the client bundle.
 * That is why this takes `children` rather than rendering fields itself.
 *
 * It exists so no screen has to hand-roll pending state, and so a save that
 * fails says so in the same place every time. A form that quietly does nothing
 * on failure is how someone types a price three times and walks away believing
 * it saved.
 */
export function AdminForm({
  action,
  children,
  className,
  onDone,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  /** Rendered with the result, when a screen wants to do more than show it. */
  onDone?: (state: FormState) => React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={cx("flex flex-col gap-4", className)}>
      {children}
      {state ? (
        onDone ? (
          onDone(state)
        ) : (
          <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
        )
      ) : null}
    </form>
  );
}

/**
 * A submit button that disables itself while the action is in flight.
 *
 * `useFormStatus` only reports on the form it is *inside*, which is why this is
 * a separate component rather than a prop on AdminForm — a hook called in the
 * same component that renders the <form> reads the parent form's status, not
 * this one's, and would never show pending at all.
 */
export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "dark" | "ghost" | "soft" | "danger";
  size?: "sm" | "md" | "lg";
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}
