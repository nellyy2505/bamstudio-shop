"use client";

import { AdminForm, SubmitButton } from "../AdminForm";
import { reissueInvitation } from "../actions";
import { InviteLinkResult } from "./InviteLinkResult";

/**
 * "New link" on an invitation that is still waiting.
 *
 * Revokes the old link and issues a fresh one in a single press, then shows it
 * the same way the invite form does. Before this existed, an owner who closed
 * the page without copying the link had no move on this screen except Revoke,
 * which does not read like the first half of anything.
 */
export function ReissueButton({ invitationId }: { invitationId: string }) {
  return (
    <AdminForm
      action={reissueInvitation}
      className="items-end"
      onDone={(state) => <InviteLinkResult state={state} />}
    >
      <input type="hidden" name="id" value={invitationId} />
      <SubmitButton variant="soft" size="sm" pendingLabel="Making a link…">
        New link
      </SubmitButton>
    </AdminForm>
  );
}
