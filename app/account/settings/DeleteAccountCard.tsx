"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { SHOP } from "@/lib/config";
import { formsReachStudio, hasStudioMailbox, socialLinks } from "@/lib/contact";

const LINK = "font-bold text-accent underline underline-offset-2";

/**
 * How to ask for the account to be closed, using only channels that exist.
 * `SHOP.supportEmail` renders the literal string "[HELLO@YOURDOMAIN]" when
 * unset, so it may never be printed without `hasStudioMailbox`. Same chain as
 * the legal pages; the predicates now live in lib/contact.ts, the markup
 * cannot.
 *
 * @param canSendEmail server-read capability, threaded in as a prop — see the
 *   note on the component's props.
 */
function HowToAsk({ canSendEmail }: { canSendEmail: boolean }) {
  const formDelivers = formsReachStudio(canSendEmail);
  if (hasStudioMailbox) {
    return (
      <>
        Write to{" "}
        <a href={`mailto:${SHOP.supportEmail}`} className={LINK}>
          {SHOP.supportEmail}
        </a>{" "}
        from the address on this account and ask us to close it
        {formDelivers ? (
          <>
            , or send the same through the{" "}
            <Link href="/contact" className={LINK}>
              contact form
            </Link>
          </>
        ) : null}
        .
      </>
    );
  }

  const handles = socialLinks;

  if (handles.length > 0) {
    return (
      <>
        Message us on{" "}
        {handles.map((handle, index) => (
          <span key={handle.label}>
            {index > 0 ? " or " : ""}
            <a href={handle.href} className={LINK}>
              {handle.label}
            </a>
          </span>
        ))}{" "}
        and ask us to close the account, telling us the email address it uses.
      </>
    );
  }

  return (
    <>
      We have not published a way to reach us yet, so we cannot take deletion
      requests at the moment. Any channel we open will be listed on our{" "}
      <Link href="/contact" className={LINK}>
        contact page
      </Link>
      .
    </>
  );
}

export function DeleteAccountCard({
  canSendEmail,
}: {
  /**
   * Whether the shop can send its own email — `isEmailConfigured()`, read on
   * the server by the settings page and handed down. It cannot be read here:
   * the secrets behind it are not `NEXT_PUBLIC_`, so this client component
   * would see `undefined` and would offer the contact form as a route to a
   * deletion request even where that form reaches nobody.
   */
  canSendEmail: boolean;
}) {
  const [asked, setAsked] = useState(false);

  // This card deletes nothing, and no longer pretends to.
  //
  // Removing an auth user needs the service-role key, so it can only happen in
  // a server route that does not exist yet; the browser client holds the anon
  // key and is refused. A button labelled "Delete my account" that quietly
  // filed a support request was the false claim here — so the button now asks
  // for deletion, which is exactly what happens, and the typed DELETE
  // confirmation is gone because nothing destructive is being confirmed.
  return (
    <section
      className="rounded-card border border-danger-soft bg-surface p-5 sm:p-6"
      aria-labelledby="delete-heading"
    >
      <h2 id="delete-heading" className="text-xl text-danger">
        Delete account
      </h2>
      <p className="mt-1 text-[13.5px] text-muted">
        There is no self-service delete yet. Closing an account is done by hand
        so we can check nothing is mid-print, and it removes your sign-in,
        profile details, saved addresses and favourites. Past orders are kept —
        Australian
        tax law requires us to hold order and payment records for at least five
        years.
      </p>

      <div className="mt-5">
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => setAsked(true)}
        >
          How to close my account
        </Button>
      </div>

      {asked ? (
        <div className="mt-4">
          {/* The two-business-day clock is gone. Nothing measures or guarantees
              a turnaround — /contact says exactly that, and the same promise was
              removed from the product page, /order/confirmed and the contact
              form on that principle. What is left is what actually happens: a
              person does it, and writes back. */}
          <Alert tone="info">
            <HowToAsk canSendEmail={canSendEmail} /> We do it by hand, and one of
            us writes back to confirm once it is done. Nothing is deleted until
            then.
          </Alert>
        </div>
      ) : null}

      <p className="mt-4 text-[12.5px] text-faint">
        What we hold and how long we keep it is set out in our{" "}
        <Link href="/legal/privacy" className={LINK}>
          privacy policy
        </Link>
        .
      </p>
    </section>
  );
}
