import { createHash } from "node:crypto";
import { getStaffRole, type StaffRole } from "@/lib/auth/staff";
import { createAdminClient, getUser } from "@/lib/supabase/server";

/**
 * Reading an invitation, and working out what the person holding it may do.
 *
 * DEFECT THIS CLOSES: `inviteStaff` has always handed back a link to
 * `/admin/join?token=…`, and that route did not exist. Every invitation the
 * owner has ever made 404s, so nobody has ever been able to accept one — there
 * is no path into `public.staff` for Studio or Packing at all, and the only
 * person in the studio is the owner, placed by hand in the SQL editor. This
 * module is the missing half of the invitation.
 *
 * Two callers share it, and they must agree exactly: the page, which decides
 * what to render, and `acceptInvitation` in app/admin/actions.ts, which writes
 * the row. A page that says "you may join" while the action disagrees is how
 * someone is shown a button that always fails, so the rules live here once.
 *
 * THREE RULES, none of which may be relaxed:
 *
 *   1. The token is matched by its SHA-256 hash, because that is all the
 *      database holds (0003_admin.sql, and `inviteStaff`). The plaintext is
 *      never stored, never logged and never echoed back to the page.
 *   2. Who is accepting comes from the session cookie — `getUser()` — and from
 *      nothing else. No email, user id or role is ever read out of the URL or
 *      the form.
 *   3. `staff` and `staff_invitations` have RLS on with no policy and are
 *      revoked from anon and authenticated, so only the service-role client can
 *      see them. Hence `createAdminClient()`, on the server, here.
 */

/**
 * The only roles an invitation may ever grant.
 *
 * `staff.role` also allows 'owner'; `staff_invitations.role` does not, and the
 * check constraint in 0003_admin.sql says so. This list is the same rule in
 * TypeScript, so a row that somehow carries 'owner' — a hand-edit in the SQL
 * editor, a constraint dropped in a future migration — is refused here rather
 * than quietly minting a second owner who can then invite more owners.
 */
export const INVITABLE_ROLES = ["studio", "packing"] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(value: string): value is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(value);
}

/**
 * The one hashing rule, in one place.
 *
 * `inviteStaff` writes the hash and this module reads it. If the two ever
 * disagreed — a different algorithm, a different digest encoding — every
 * invitation would silently stop matching and the page would say "not valid"
 * to people holding a perfectly good link. Neither end computes it itself.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What the page has to render, and what the action has to decide against. */
export type JoinState =
  /** Nobody is signed in, so we cannot tell whose invitation this is. */
  | { kind: "signed_out" }
  /** No token, an unknown token, or a database we could not reach. */
  | { kind: "invalid" }
  | { kind: "accepted" }
  | { kind: "revoked" }
  | { kind: "expired" }
  /** Signed in as somebody other than the person invited. */
  | { kind: "wrong_person"; signedInAs: string }
  /** The row asks for something an invitation may not grant. */
  | { kind: "refused_role" }
  | { kind: "already_staff"; role: StaffRole }
  | {
      kind: "ready";
      invitationId: string;
      role: InvitableRole;
      /** Whoever made the invitation, recorded on the staff row as invited_by. */
      invitedBy: string | null;
      userId: string;
      email: string;
    };

function assertServer(fn: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${fn}() was called in the browser. It reads staff_invitations with the ` +
        "service-role key, which must never reach a client bundle.",
    );
  }
}

export async function resolveJoin(rawToken: string): Promise<JoinState> {
  assertServer("resolveJoin");

  // Identity first, and from the session alone. Everything below is a
  // statement about *this* signed-in person; none of it can be steered by a
  // request body.
  const user = await getUser();
  if (!user) return { kind: "signed_out" };

  const token = rawToken.trim();
  if (!token) return { kind: "invalid" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("staff_invitations")
    .select("id, email, role, expires_at, accepted_at, revoked_at, created_by")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  // A failed read is not a grant. If the database is unreachable the link is
  // treated as unusable for the duration, exactly as `getStaffRole()` treats a
  // failed staff lookup as "not staff".
  if (error || !data) return { kind: "invalid" };

  const signedInAs = (user.email ?? "").toLowerCase();
  const invitedEmail = String(data.email ?? "").toLowerCase();

  /*
   * The identity check comes before anything about the invitation's life, and
   * it deliberately does not name the address that was invited.
   *
   * An invitation is to a person, not a link to forward. Somebody who was sent
   * the link by mistake learns only that it is not theirs — never who it was
   * for, and never whether it is still live. `inviteStaff` lower-cases the
   * address on the way in, so both sides are compared lower-cased; an account
   * with no email at all can never match.
   */
  if (!signedInAs || signedInAs !== invitedEmail) {
    return { kind: "wrong_person", signedInAs: user.email ?? "" };
  }

  // Same order as the state shown on /admin/access, so the owner's table and
  // the invitee's page never describe one invitation two different ways.
  if (data.accepted_at) return { kind: "accepted" };
  if (data.revoked_at) return { kind: "revoked" };
  if (new Date(String(data.expires_at)).getTime() < Date.now()) {
    return { kind: "expired" };
  }

  // Already in the studio: say so and send them there rather than writing a
  // second row. `staff.user_id` is the primary key, so a duplicate would fail
  // anyway — but the person deserves a sentence, not a constraint violation.
  const staff = await getStaffRole();
  if (staff) return { kind: "already_staff", role: staff.role };

  const role = String(data.role ?? "");
  if (!isInvitableRole(role)) return { kind: "refused_role" };

  return {
    kind: "ready",
    invitationId: String(data.id),
    role,
    invitedBy: (data.created_by as string | null) ?? null,
    userId: user.id,
    email: user.email ?? "",
  };
}
