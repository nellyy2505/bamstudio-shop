import { redirect } from "next/navigation";
import { createAdminClient, getUser } from "@/lib/supabase/server";

/**
 * Who is allowed behind the shopfront, and what each of them may touch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE
 *
 * A role is NOT a column on `profiles`. 0001_init.sql grants every signed-in
 * account UPDATE on its own profile row across all columns, so a role there
 * would be self-assignable over PostgREST with the anon key that ships in the
 * browser bundle — one HTTP request and a customer is an admin. RLS cannot
 * restrict a policy to a subset of columns, so the fix is a separate table.
 *
 * `public.staff` therefore has RLS on, NO policy, and an explicit revoke from
 * anon and authenticated. It is readable only with the service-role key, which
 * means only this module, on the server. `supabase/verify.sql` asserts all four
 * of those facts on every run.
 *
 * The consequence you must remember: **the role cannot be checked in
 * `proxy.ts`**, because middleware only has the anon client. The proxy is a
 * cheap first gate that establishes "signed in at all"; the real check is
 * `requireStaff()`, and it has to be called by every page, route handler and
 * server action under /admin. A Next.js layout is not a security boundary for
 * route handlers — nothing about being nested under `app/admin/` protects an
 * API route. Call it yourself, every time.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type StaffRole = "owner" | "studio" | "packing";

/** The things the staff area can do. A page belongs to exactly one. */
export type Capability =
  | "orders"
  | "catalogue"
  | "colours"
  | "inventory"
  | "reports"
  | "settings"
  | "access";

/**
 * What each role may reach.
 *
 * Deliberately a whitelist per role rather than a rank comparison: "packing is
 * less than studio" invites an off-by-one that quietly grants something, while
 * a list you have to type into is a list someone has to read.
 *
 * `packing` is orders and nothing else — no costs, no prices, no catalogue —
 * so the person helping you post parcels never sees your margins.
 */
const CAPABILITIES: Record<StaffRole, readonly Capability[]> = {
  owner: [
    "orders",
    "catalogue",
    "colours",
    "inventory",
    "reports",
    "settings",
    "access",
  ],
  studio: ["orders", "catalogue", "colours", "inventory", "reports"],
  packing: ["orders"],
};

export function can(role: StaffRole, capability: Capability): boolean {
  return CAPABILITIES[role].includes(capability);
}

/** Human wording for a role, for anything a person reads. */
export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  studio: "Studio — everything",
  packing: "Packing — orders only",
};

function assertServer(fn: string) {
  if (typeof window !== "undefined") {
    throw new Error(
      `${fn}() was called in the browser. It reads the staff table with the ` +
        "service-role key, which must never reach a client bundle. A server " +
        "component calls it; a client component takes the answer as a prop.",
    );
  }
}

export type StaffMember = {
  userId: string;
  email: string;
  role: StaffRole;
};

/**
 * The signed-in user's staff role, or null if they have none.
 *
 * Returns null rather than throwing for an ordinary customer: not being staff
 * is the normal case, not an error.
 */
export async function getStaffRole(): Promise<StaffMember | null> {
  assertServer("getStaffRole");

  const user = await getUser();
  if (!user) return null;

  // The service-role client, because `staff` is unreadable with any other key.
  // The lookup is keyed on the id from the verified session — never on
  // anything a request body or header could supply.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("staff")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  // A failed read is not a grant. If the database is unreachable, nobody is
  // staff for the duration — the shop keeps serving customers either way.
  if (error || !data) return null;

  return {
    userId: data.user_id as string,
    email: user.email ?? "",
    role: data.role as StaffRole,
  };
}

/**
 * Require staff access, optionally with a specific capability.
 *
 * Redirects rather than throwing so a signed-out visitor lands on the sign-in
 * page and a signed-in customer lands back on the shop — neither is told that
 * a staff area exists, which is one fewer thing to go looking for.
 */
export async function requireStaff(capability?: Capability): Promise<StaffMember> {
  assertServer("requireStaff");

  const staff = await getStaffRole();
  if (!staff) redirect("/login?next=%2Fadmin");
  if (capability && !can(staff.role, capability)) redirect("/admin");

  return staff;
}

/*
 * ────────────────────────────────────────────────────────────────────────────
 * THERE IS NO "NOBODY RUNS THIS STUDIO YET" PAGE, AND THIS IS WHY.
 *
 * There used to be one: while `staff` was empty the layout showed a screen with
 * the signed-in account's user id and the SQL to make it the owner, so claiming
 * the studio was one paste. It read well, and it was wrong.
 *
 * MEASURED, by loading the built server as an ordinary signed-in customer with
 * no staff row: every single /admin URL — /admin/settings, /admin/access, all
 * of them — returned 200 and that page, because "is the table empty" is a
 * question about the DATABASE, not about who is asking. Any customer with an
 * account saw that a staff area existed and was unclaimed. Nothing could be
 * done with it, but it was never theirs to see, and it was visible in exactly
 * the window between deploying and claiming.
 *
 * The fix is to delete the state rather than to guard it. Not staff is not
 * staff, whoever else is or is not staff, and the redirect is the same for
 * everyone. The claim step moved to where the person doing it already is: the
 * Supabase SQL editor, with the statement at the bottom of 0003_admin.sql,
 * keyed on her email rather than on a user id she would have had to read off a
 * web page.
 *
 * Do not reintroduce a bootstrap page, a bootstrap route, or a bootstrap
 * environment variable. Each one is a standing path into the single table that
 * decides authority, and "it only works while the table is empty" stops being
 * true the moment someone empties it.
 * ────────────────────────────────────────────────────────────────────────────
 */
