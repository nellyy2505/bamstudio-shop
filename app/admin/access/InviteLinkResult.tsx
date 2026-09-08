"use client";

import { Alert } from "@/components/ui";
import type { FormState } from "../actions";

/**
 * The one place an invitation link is ever readable, shared by the invite form
 * and by the "new link" button on a waiting invitation.
 *
 * It lives on its own because the link is the deliverable, not a confirmation:
 * `inviteStaff` and `reissueInvitation` both return the plaintext token exactly
 * once, wrapped in a prefix, because only its hash is stored. Two copies of
 * this rendering would be two chances for one of them to quietly become a green
 * tick, and a green tick is indistinguishable from "the link is gone" to the
 * person who needed to copy it.
 */

export const LINK_PREFIX = "INVITE_LINK:";

export function InviteLinkResult({ state }: { state: FormState }) {
  if (!state) return null;
  if (!state.ok) return <Alert tone="error">{state.message}</Alert>;
  if (!state.message.startsWith(LINK_PREFIX)) {
    return <Alert tone="success">{state.message}</Alert>;
  }

  // "<status>|<url>". A URL cannot contain a bare pipe, so one split is safe.
  const rest = state.message.slice(LINK_PREFIX.length);
  const divider = rest.indexOf("|");
  const status = divider === -1 ? "email_off" : rest.slice(0, divider);
  const link = divider === -1 ? rest : rest.slice(divider + 1);

  /*
   * Three endings, and the difference matters. "Emailed" means a provider
   * accepted it, which is not the same as landing in an inbox, so the link is
   * still shown and the sentence says to send it if it does not arrive. The
   * other two say plainly that nothing was sent, because an owner who believes
   * an email is on its way will not send the link, and the invitee will wait
   * for something that does not exist.
   */
  const headline =
    status === "emailed"
      ? "Emailed to them. Here is the link as well"
      : status === "not_emailed"
        ? "The email did not send. Copy the link and send it yourself"
        : "Their invitation link, copy it now";

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line2 bg-cream p-4 text-left">
      <p className="text-[13.5px] font-extrabold">{headline}</p>
      <code className="block overflow-x-auto rounded-lg border border-line2 bg-surface px-3.5 py-2.5 font-mono text-[13px] break-all select-all">
        {link}
      </code>
      <p className="text-[13px] text-muted">
        {status === "emailed"
          ? "If it has not arrived in a few minutes, check their spam folder or just send them this link. "
          : status === "not_emailed"
            ? "The invitation itself is fine and the link works. Only the email failed. "
            : "Email is not switched on, so nothing was sent. "}
        This is shown once and cannot be recovered. Only a hash of it is stored, so nobody,
        not you and not the database, can read it back. If it is lost, use <b>New link</b> on
        the invitation below and this one stops working. It expires in seven days.
      </p>
    </div>
  );
}
