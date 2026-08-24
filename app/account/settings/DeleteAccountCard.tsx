"use client";

import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { SHOP } from "@/lib/config";

const CONFIRM_WORD = "DELETE";

export function DeleteAccountCard() {
  const [typed, setTyped] = useState("");
  const [requested, setRequested] = useState(false);

  // TODO: real deletion needs a server-side admin route — the browser client
  // uses the anon key and cannot remove an auth user. Until that exists this
  // hands the request to support.
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setRequested(true);
  }

  return (
    <section
      className="rounded-card border border-danger-soft bg-surface p-5 sm:p-6"
      aria-labelledby="delete-heading"
    >
      <h2 id="delete-heading" className="text-xl text-danger">
        Delete account
      </h2>
      <p className="mt-1 text-[13.5px] text-muted">
        This closes your account and removes your saved addresses and
        favourites. Past orders are kept for our tax records.
      </p>

      <form onSubmit={onSubmit} className="mt-5 max-w-sm">
        <Field
          label={`Type ${CONFIRM_WORD} to confirm`}
          htmlFor="delete-confirm"
          hint="Case sensitive."
        >
          <input
            id="delete-confirm"
            className={inputClass}
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setRequested(false);
            }}
          />
        </Field>

        <div className="mt-4">
          <Button type="submit" size="sm" variant="danger" disabled={typed !== CONFIRM_WORD}>
            Delete my account
          </Button>
        </div>
      </form>

      {requested ? (
        <div className="mt-4">
          <Alert tone="info">
            Almost — deletion is done by hand so we can check nothing is
            mid-print. Email {SHOP.supportEmail} from this address and we&apos;ll
            close the account within two business days.
          </Alert>
        </div>
      ) : null}
    </section>
  );
}
