"use client";

import { Field, inputClass } from "@/components/ui";
import { AdminForm, SubmitButton } from "../AdminForm";
import { inviteStaff } from "../actions";
import { InviteLinkResult } from "./InviteLinkResult";

/**
 * The invite form.
 *
 * `inviteStaff` returns the plaintext token exactly once, wrapped in a prefix,
 * because only its hash is stored - the same reason a password table holds
 * hashes. That means the ordinary "here is a green tick" ending is not enough:
 * the message *is* the deliverable. `InviteLinkResult` renders it, and is
 * shared with the "New link" button on the invitations table so the two endings
 * cannot drift apart.
 *
 * This is a client component because `AdminForm`'s result is what decides which
 * ending to render. Nothing about staff, roles or the database is read here -
 * the server action does all of that.
 */

export function InviteForm() {
  return (
    <AdminForm action={inviteStaff} onDone={(state) => <InviteLinkResult state={state} />}>
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
            <option value="studio">Studio, everything but access and settings</option>
            <option value="packing">Packing, orders only</option>
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
