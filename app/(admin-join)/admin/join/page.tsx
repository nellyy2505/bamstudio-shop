import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Alert, ButtonLink, EmptyState, Icon, type IconName } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/auth/staff";
import { safeNext } from "@/lib/safe-next";
import { resolveJoin, type JoinState } from "./invitation";
import { JoinForm } from "./JoinForm";

/**
 * /admin/join?token=… — where an invitation becomes studio access.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS AT app/(admin-join)/admin/join/ AND NOT AT app/admin/join/
 *
 * `app/admin/layout.tsx` calls `requireStaff()`, which redirects anyone without
 * a row in `public.staff`. An invited person is BY DEFINITION not staff yet —
 * that is the whole reason they were sent a link — so a page nested under that
 * layout would bounce them to /admin the moment it rendered, and the invitation
 * could never be accepted. It is the same trap the route was born with: the
 * link `inviteStaff` hands out has never resolved to anything.
 *
 * The fix is NOT to weaken the layout's guard. `requireStaff()` there is what
 * keeps every other /admin/* page shut, and softening it to let one page
 * through would soften it for all of them.
 *
 * A route group does it instead. `(admin-join)` is a folder whose name is in
 * parentheses, so it contributes nothing to the URL: this file still serves
 * exactly /admin/join. What it changes is the LAYOUT chain — layouts nest by
 * folder, so a page outside app/admin/ is not wrapped by app/admin/layout.tsx
 * and never calls `requireStaff()`. Every other /admin/* route is untouched and
 * still guarded. There is no conflict, because nothing else in the app resolves
 * to /admin/join.
 *
 * Two consequences worth knowing:
 *   • `app/layout.tsx` keys its "staff area, no shop chrome" branch on the
 *     PATH, not on the folder, so this page correctly gets no promo bar and no
 *     footer. It therefore draws its own frame below.
 *   • `proxy.ts` also keys on the path, so a signed-out visitor is still sent
 *     to /login before this page renders. The signed-out branch below is the
 *     second line, not the only one — see the note on `backHere`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here writes anything. Accepting is a mutation and lives in a server
 * action the person submits, because a GET that grants authority is a GET that
 * a link preview, a prefetch or a scanner can fire on their behalf.
 */

export const metadata: Metadata = {
  // The root layout appends " · Bam Studio" through its title template.
  title: "Join the studio",
  // An invitation link is a secret. Nothing about it should ever be indexed.
  robots: { index: false, follow: false, nocache: true },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Next 16 hands searchParams over as a Promise, and repeats may be arrays. */
function one(value: string | string[] | undefined): string {
  const found = Array.isArray(value) ? value[0] : value;
  return typeof found === "string" ? found : "";
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const token = one((await searchParams).token);
  const state = await resolveJoin(token);

  /*
   * Where sign-in has to put them back: this exact link, token and all.
   *
   * Built through `safeNext()` even though we are the ones building it. The
   * token is arbitrary text from a URL, so it is encoded first and then the
   * whole path is put through the same validator every other `next=` goes
   * through — one rule, one place, and no way for a crafted token to smuggle a
   * second destination into the query string.
   *
   * `proxy.ts` used to drop this: it redirected a signed-out visitor to /login
   * with `next` set to the PATHNAME only, so the token was gone before this
   * page ever ran and the round trip ended on "this link isn't valid". It now
   * carries `request.nextUrl.search` as well. The copy below still tells
   * someone to reopen the link if they end up back here without one, because
   * an invitation can also be pasted without its query string by hand.
   */
  const backHere = safeNext(`/admin/join?token=${encodeURIComponent(token)}`, "/admin");

  return <Shell>{renderState(state, token, backHere)}</Shell>;
}

/** One branch per state, each saying which one it is rather than "no". */
function renderState(state: JoinState, token: string, backHere: string): ReactNode {
  switch (state.kind) {
    /* ------------------------------------------------------- not signed in */
    case "signed_out":
      return (
        <>
          <Ending
            icon="lock"
            title="Sign in first"
            body="This invitation belongs to one email address, so we need to know who you are before it can be used. If you have never shopped with us, make an account with that same address first — the studio runs on the shop's own sign-in."
          >
            <ButtonLink href={`/login?next=${encodeURIComponent(backHere)}`}>
              Sign in and come back
            </ButtonLink>
            <ButtonLink href="/signup" variant="soft">
              Create an account
            </ButtonLink>
          </Ending>
          <Alert tone="info">
            Keep this link. Making an account does not bring you back here on its own — open
            the invitation again once you are signed in, and it will pick up where you left off.
          </Alert>
        </>
      );

    /* ------------------------------------------ no token, or an unknown one */
    case "invalid":
      /*
       * One answer for "there is no token", "that token is nonsense" and "that
       * token is not in the table". Telling those apart would turn this page
       * into an oracle that confirms whether a guessed token exists, which is
       * the same reasoning the sign-in form uses for its single generic error.
       */
      return (
        <Ending
          icon="help"
          title="This link isn't valid"
          body="We can't match it to an invitation. Links get broken by being split across two lines in a message, so it is worth copying it again in one piece — otherwise ask whoever invited you for a fresh one."
        >
          <ButtonLink href="/" variant="soft">
            Back to the shop
          </ButtonLink>
        </Ending>
      );

    /* ----------------------------------------------- used, revoked, expired */
    case "accepted":
      return (
        <Ending
          icon="check"
          title="This invitation has already been used"
          body="An invitation works once. If it was not you who used it, or you have since lost your access, ask the owner to invite you again."
        >
          <ButtonLink href="/" variant="soft">
            Back to the shop
          </ButtonLink>
        </Ending>
      );

    case "revoked":
      return (
        <Ending
          icon="x"
          title="This invitation was revoked"
          body="Somebody with studio access cancelled it, so it can no longer be used. Ask the owner for a fresh invitation if you still need to get in."
        >
          <ButtonLink href="/" variant="soft">
            Back to the shop
          </ButtonLink>
        </Ending>
      );

    case "expired":
      return (
        <Ending
          icon="clock"
          title="This invitation has expired"
          body="Invitations last seven days and this one is past that. Nothing has gone wrong — ask the owner for a fresh one and it will work straight away."
        >
          <ButtonLink href="/" variant="soft">
            Back to the shop
          </ButtonLink>
        </Ending>
      );

    /* ------------------------------------------------- signed in as someone else */
    case "wrong_person":
      /*
       * The address that WAS invited is deliberately not shown. Whoever is
       * reading this may be the wrong person entirely — a forwarded message, a
       * shared computer — and they have no business learning who the owner
       * invited. Their own address is theirs to see, and it is the one thing
       * they need in order to work out what to do.
       */
      return (
        <Ending
          icon="user"
          title="This invitation isn't for this account"
          body={`You are signed in as ${state.signedInAs}, and the invitation was made for a different email address. An invitation is to a person, not a link that can be passed on, so it will not work from here.`}
        >
          <ButtonLink href="/account" variant="soft">
            Sign out from your account page
          </ButtonLink>
        </Ending>
      );

    /* -------------------------------------- a role no invitation may grant */
    case "refused_role":
      return (
        <Ending
          icon="shield"
          title="This invitation can't be accepted"
          body="It asks for a level of access that cannot be handed out through a link. Nothing has been changed. Ask the owner to invite you as Studio or Packing instead."
        >
          <ButtonLink href="/" variant="soft">
            Back to the shop
          </ButtonLink>
        </Ending>
      );

    /* --------------------------------------------------------- already in */
    case "already_staff":
      return (
        <Ending
          icon="shield"
          title="You're already in the studio"
          body={`There is nothing to accept — your account is already in the studio as ${ROLE_LABEL[state.role]}. This link has done its job.`}
        >
          <ButtonLink href="/admin">Open the studio</ButtonLink>
        </Ending>
      );

    /* ---------------------------------------------------------- the accept */
    case "ready":
      return (
        <>
          <div className="flex flex-col gap-2 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-[22px] bg-butter">
              <Icon name="gift" size={30} strokeWidth={1.5} />
            </span>
            <h1 className="mt-4 text-[28px]">You&apos;ve been invited to the studio</h1>
            <p className="text-[14.5px] text-muted">
              Accepting adds studio access to the account you are already signed in with,{" "}
              <b className="text-ink">{state.email}</b>.
            </p>
          </div>

          <dl className="mt-7 flex flex-col gap-3 rounded-xl border border-line2 bg-cream p-4 text-[14px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="font-extrabold">What you&apos;ll be able to do</dt>
              <dd className="text-muted">{ROLE_LABEL[state.role]}</dd>
            </div>
            <p className="text-[13px] text-muted">
              {state.role === "packing"
                ? "Packing sees orders and nothing else — no products, no settings and no reports, so no costs or margins."
                : "Studio sees orders, products, inventory, colours and reports. Studio access and the costing settings stay with the owner."}
            </p>
          </dl>

          <div className="mt-6">
            <JoinForm token={token} />
          </div>

          <p className="mt-5 text-[13px] text-muted">
            The studio is the back of the shop. What you can see there is what the owner chose
            for you above, and nothing else changes about your account.
          </p>
        </>
      );
  }
}

/**
 * The frame.
 *
 * Drawn here rather than borrowed from app/admin/layout.tsx on purpose: that
 * layout is the staff shell, with the sidebar and the dark STAFF bar, and it
 * calls `requireStaff()`. Somebody who has not accepted yet is not staff and
 * should not be shown the studio's furniture before they are in it. This is the
 * same centred card the sign-in page uses.
 */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="wrap flex min-h-screen items-center justify-center py-12 md:py-16">
      <div className="w-full max-w-[520px]">
        <div className="card flex flex-col gap-4 px-6 py-8 sm:px-8">{children}</div>
        <p className="mt-6 text-center text-sm text-muted">
          <Link
            href="/"
            className="font-bold text-accent underline underline-offset-2 hover:text-accent-dark"
          >
            Bam Studio
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Every ending that is not the accept: one shape, so they read alike. */
function Ending({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <EmptyState
      icon={
        <span className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-cream">
          <Icon name={icon} size={30} strokeWidth={1.5} />
        </span>
      }
      title={title}
      body={body}
    >
      {children}
    </EmptyState>
  );
}
