"use client";

import { AdminForm, SubmitButton } from "@/app/admin/AdminForm";
import { acceptInvitation } from "@/app/admin/actions";

/**
 * The button that turns an invitation into a staff row.
 *
 * A BUTTON, not the page render, because accepting is a mutation: it writes to
 * `public.staff`, the one table that decides authority. A GET that grants
 * authority is a GET that a link preview, a mail scanner or a browser prefetch
 * can fire on somebody's behalf, and the person would then be staff without
 * ever having agreed to anything. So the page only reads, and this posts.
 *
 * The same `AdminForm` / `SubmitButton` pair every staff screen uses, so a
 * failure says so in the same place and the button cannot be pressed twice
 * while the first press is in flight. On success the action redirects to
 * /admin, so there is no success message to render here.
 *
 * The token rides along in a hidden field. That is not a leak — it is already
 * in the address bar of the page this form is on — and the action does not
 * trust it: it re-hashes it and re-checks every rule from the database before
 * writing anything. Nothing about the role, the email or the invitation is
 * sent from here, because anything in a form is something a person can retype.
 */
export function JoinForm({ token }: { token: string }) {
  return (
    <AdminForm action={acceptInvitation}>
      <input type="hidden" name="token" value={token} />
      <SubmitButton size="lg" pendingLabel="Joining…">
        Accept and join the studio
      </SubmitButton>
    </AdminForm>
  );
}
