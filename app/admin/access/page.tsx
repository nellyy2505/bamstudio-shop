import { ROLE_LABEL, requireStaff, type StaffRole } from "@/lib/auth/staff";
import { formatDate } from "@/lib/format";
import { Pill } from "@/components/ui";
import { AdminForm, SubmitButton } from "../AdminForm";
import { removeStaff, revokeInvitation } from "../actions";
import { NoRows, PageHead, Panel } from "../ui";
import { listInvitations, listStaff, type InvitationRow } from "../data";
import { InviteForm } from "./InviteForm";

/**
 * Who is allowed in the studio.
 *
 * There is no sign-up. The shop's registration form makes customers and nothing
 * else, the staff table is unreadable and unwritable with the key the browser
 * holds, and the only way in is an invitation made on this page by someone who
 * already has the access capability — which is the owner alone.
 */

const INVITE_TONE: Record<InvitationRow["state"], "accent" | "good" | "neutral" | "warn"> = {
  pending: "accent",
  accepted: "good",
  revoked: "neutral",
  expired: "warn",
};

const INVITE_WORDS: Record<InvitationRow["state"], string> = {
  pending: "waiting",
  accepted: "accepted",
  revoked: "revoked",
  expired: "expired",
};

export default async function AccessPage() {
  const me = await requireStaff("access");

  const [staff, invitations] = await Promise.all([listStaff(), listInvitations()]);

  return (
    <div className="flex flex-col gap-7">
      <PageHead
        title="Studio access"
        subtitle="Who can get behind the shopfront, and how much of it they see."
      />

      <Panel title="How this works">
        <div className="flex flex-col gap-3 text-[14px] text-muted">
          <p>
            <b className="text-ink">Nobody can sign themselves up as staff.</b> Registering on
            the shop makes a customer account and only that. The one table that decides who has
            authority cannot be read or written with the key a browser holds, so the only way
            into the studio is an invitation made here.
          </p>
          <ul className="flex flex-col gap-2">
            <li>
              <b className="text-ink">Owner</b> — everything, including this page and the
              costing settings. There is one, placed by hand in the database, and it cannot be
              handed out or invited.
            </li>
            <li>
              <b className="text-ink">Studio</b> — everything except studio access and
              settings. Orders, products, inventory, colours and reports.
            </li>
            <li>
              <b className="text-ink">Packing</b> — orders only. No products, no settings, no
              reports, so no costs and no margins. This is the role for someone helping you get
              parcels out.
            </li>
          </ul>
        </div>
      </Panel>

      <Panel
        title="In the studio"
        note="Everyone who can sign in behind the shopfront right now."
        padded={false}
      >
        {staff.length === 0 ? (
          <NoRows>Nobody has a role yet.</NoRows>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">ACCOUNT</th>
                  <th className="px-5 py-3">ROLE</th>
                  <th className="px-5 py-3">SINCE</th>
                  <th className="px-5 py-3 text-right">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {staff.map((person) => {
                  const isMe = person.userId === me.userId;
                  const isOwner = person.role === "owner";

                  return (
                    <tr key={person.userId}>
                      <td className="px-5 py-3.5 break-all">{person.email}</td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        {ROLE_LABEL[person.role as StaffRole] ?? person.role}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                        {formatDate(person.createdAt)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {isMe ? (
                          <span className="text-[13px] text-faint">
                            This is you. Removing it would lock you out.
                          </span>
                        ) : isOwner ? (
                          <span className="text-[13px] text-faint">
                            An owner is only removed in the database.
                          </span>
                        ) : (
                          <AdminForm action={removeStaff} className="items-end">
                            <input type="hidden" name="user_id" value={person.userId} />
                            <SubmitButton
                              variant="danger"
                              size="sm"
                              pendingLabel="Removing…"
                            >
                              Remove access
                            </SubmitButton>
                          </AdminForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Invite someone"
        note="A link you send them yourself. It works once, for that email, for seven days."
      >
        <InviteForm />
      </Panel>

      <Panel
        title="Invitations"
        note="Newest first. Revoking one stops it being used, but an invitation already accepted has to be undone by removing the person above."
        padded={false}
      >
        {invitations.length === 0 ? (
          <NoRows>No invitations have been made.</NoRows>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] font-extrabold tracking-[0.08em] text-faint">
                  <th className="px-5 py-3">EMAIL</th>
                  <th className="px-5 py-3">ROLE</th>
                  <th className="px-5 py-3">SENT</th>
                  <th className="px-5 py-3">EXPIRES</th>
                  <th className="px-5 py-3">STATE</th>
                  <th className="px-5 py-3 text-right">
                    <span className="sr-only">Revoke</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td className="px-5 py-3.5 break-all">{invitation.email}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {ROLE_LABEL[invitation.role as StaffRole] ?? invitation.role}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {formatDate(invitation.createdAt)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-muted">
                      {formatDate(invitation.expiresAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <Pill tone={INVITE_TONE[invitation.state]}>
                        {INVITE_WORDS[invitation.state]}
                      </Pill>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {invitation.state === "pending" ? (
                        <AdminForm action={revokeInvitation} className="items-end">
                          <input type="hidden" name="id" value={invitation.id} />
                          <SubmitButton variant="soft" size="sm" pendingLabel="Revoking…">
                            Revoke
                          </SubmitButton>
                        </AdminForm>
                      ) : (
                        <span className="text-[13px] text-faint">Nothing to do</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
