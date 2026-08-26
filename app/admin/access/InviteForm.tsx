"use client";

import { Alert, Field, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../AdminForm";
import { inviteStaff } from "../actions";
import type { FormState } from "../actions";

/**
 * The invite form, and the one place the invitation link is ever readable.
 *
 * `inviteStaff` returns the plaintext token exactly once, wrapped in a prefix,
 * because only its hash is stored — the same reason a password table holds
 * hashes. That means the ordinary "here is a green tick" ending is not enough:
 * the message *is* the deliverable, and it has to be shown as something a
 * person can select and copy, with a sentence saying it will not be shown
 * again. Hence `onDone`, which replaces the default Alert.
 *
 * This is a client component because `AdminForm`'s result is what decides which
 * ending to render. Nothing about staff, roles or the database is read here —
 * the server action does all of that.
 */

const LINK_PREFIX = "INVITE_LINK:";

export function InviteForm() {
  return (
    <AdminForm action={inviteStaff} onDone={(state) => <Result state={state} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Their email"
          htmlFor="invite_email"
          hint="It has to be the address they sign in with."
        >
          <input
            id="invite_email"
            name="email"
            type="email"
            required
            placeholder="name@example.com"
            className={inputClass}
          />
        </Field>

        <Field
          label="What they may do"
          htmlFor="invite_role"
          hint="Owner is not on this list. There is one owner, and it is you."
        >
          <select id="invite_role" name="role" defaultValue="packing" className={inputClass}>
            <option value="studio">Studio — everything but access and settings</option>
            <option value="packing">Packing — orders only</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Making a link…">Create an invitation</SubmitButton>
        <span className="text-[13px] text-muted">
          Nothing is emailed. You get a link to send them yourself.
        </span>
      </div>
    </AdminForm>
  );
}

function Result({ state }: { state: FormState }) {
  if (!state) return null;
  if (!state.ok) return <Alert tone="error">{state.message}</Alert>;
  if (!state.message.startsWith(LINK_PREFIX)) {
    return <Alert tone="success">{state.message}</Alert>;
  }

  const link = state.message.slice(LINK_PREFIX.length);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line2 bg-cream p-4">
      <p className="text-[13.5px] font-extrabold">
        Their invitation link — copy it now
      </p>
      <code className="block overflow-x-auto rounded-lg border border-line2 bg-surface px-3.5 py-2.5 font-mono text-[13px] break-all select-all">
        {link}
      </code>
      <p className="text-[13px] text-muted">
        This is shown once and cannot be recovered. Only a hash of it is stored, so nobody —
        not you, not the database — can read it back. Send it to them in a message, and if it
        is lost, revoke the invitation below and make a new one. It expires in seven days.
      </p>
    </div>
  );
}
