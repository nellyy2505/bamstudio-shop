import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LegalShell } from "../LegalShell";
import { SHOP } from "@/lib/config";
import {
  formsReachStudio,
  hasSocialAccount,
  hasStudioMailbox,
  sendsOrderConfirmation,
  socialLinks,
} from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { selfCanonical } from "../../seo";

export const metadata: Metadata = {
  ...selfCanonical("/legal/privacy"),
  title: "Privacy policy",
  description:
    "What personal information Bam Studio collects when you order, why we collect it, who we share it with, and how to access or correct it.",
};

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would turn a privacy disclosure into a false one —
 * specifically, it would keep denying that customer names, addresses and
 * order contents reach a US mail processor while they do. Cheap to render.
 */
export const dynamic = "force-dynamic";

/**
 * Whether the shop can send at all, read once from the server-side secrets.
 * This is a server component, so `isEmailConfigured()` is safe here and is the
 * same condition the senders themselves check — no public mirror to drift.
 *
 * It matters more on this page than anywhere else: it decides whether a US mail
 * processor is disclosed as a recipient of customer names, addresses, order
 * contents and totals. Getting it wrong is not a wording problem.
 */
const CAN_SEND_EMAIL = isEmailConfigured();

/** Does an enquiry typed into /contact reach a person? See lib/contact.ts. */
const FORM_DELIVERS = formsReachStudio(CAN_SEND_EMAIL);

/** Does paying trigger an automatic order email to the customer? */
const SENDS_CONFIRMATION = sendsOrderConfirmation(CAN_SEND_EMAIL);

const LINK = "font-bold text-accent underline underline-offset-2";

function SocialLinks() {
  return (
    <>
      {socialLinks.map((link, index) => (
        <span key={link.label}>
          {index > 0 ? " or " : ""}
          <a href={link.href} className={LINK}>
            {link.label}
          </a>
        </span>
      ))}
    </>
  );
}

/**
 * One sentence telling the reader how to reach us, using only channels that
 * exist. `SHOP.supportEmail` renders the literal string "[HELLO@YOURDOMAIN]"
 * when unset, so it may never be printed without `hasSupportEmail`.
 *
 * This chain is repeated in the terms and refund pages and in the account
 * pages. The *predicates* it branches on now live in lib/contact.ts; the JSX
 * itself still cannot, because a .ts module holds no markup and each page words
 * the fallback differently.
 */
function Reach({
  detail,
  unavailable,
}: {
  detail: string;
  unavailable: ReactNode;
}) {
  if (hasStudioMailbox) {
    return (
      <>
        Email{" "}
        <a href={`mailto:${SHOP.supportEmail}`} className={LINK}>
          {SHOP.supportEmail}
        </a>{" "}
        {detail}.
        {FORM_DELIVERS ? (
          <>
            {" "}
            Our{" "}
            <Link href="/contact" className={LINK}>
              contact form
            </Link>{" "}
            reaches the same inbox.
          </>
        ) : null}
      </>
    );
  }

  if (hasSocialAccount) {
    return (
      <>
        Message us on <SocialLinks /> {detail}.
      </>
    );
  }

  return <>{unavailable}</>;
}

const NO_CHANNEL = (
  <>
    We have not published a contact address yet. Until one appears on our{" "}
    <Link href="/contact" className={LINK}>
      contact page
    </Link>
    , there is no way to reach us about this.
  </>
);

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy policy"
      intro={`How ${SHOP.name} handles the personal information you give us when you order, sign up or send us a message.`}
      updated="27 August 2026"
    >
      <h2>Who we are</h2>
      {/* The registered business name and postal address are the owner's real
          details and cannot be invented, so this sentence is written to be
          true and complete without them. Both still have to be added before
          launch — a privacy policy needs a named contact point. */}
      <p>
        {SHOP.name} is a sole trader business based in {SHOP.city},{" "}
        {SHOP.country}
        {SHOP.abn ? <>, ABN {SHOP.abn}</> : null}. In this policy,
        &quot;we&quot; and &quot;us&quot; mean that business.{" "}
        <Reach
          detail="with any question about this policy"
          unavailable={NO_CHANNEL}
        />
      </p>
      <p>
        As a small business we may fall below the turnover threshold at which the
        Privacy Act 1988 (Cth) applies automatically. We have chosen to handle
        personal information in line with the Australian Privacy Principles
        regardless, because you should not have to check our revenue to know how
        your address is treated.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Order details</strong> — your name, email address, delivery
          address, phone number if you give one, what you bought, and any
          personalisation text (for example the letters on a name charm).
        </li>
        {/* The contact form is only offered where it can actually deliver, so
            naming it here when it is absent points a customer at something they
            cannot find. The mailbox clause is gated for the same reason. */}
        <li>
          <strong>Messages</strong> — anything you send us
          {FORM_DELIVERS ? " through our contact form" : ""}
          {FORM_DELIVERS && hasStudioMailbox ? " or" : ""}
          {hasStudioMailbox ? " by email" : ""}
          {!FORM_DELIVERS && !hasStudioMailbox
            ? " however you reach us"
            : ""}, including the order number you quote.
          {FORM_DELIVERS
            ? " A message sent through the contact form is saved in our database: your name, your email address, the topic you picked, the order number if you gave one, what you wrote, and the date it arrived."
            : ""}
        </li>
        {/* This used to say the address "reaches us as a message and nothing
            else. There is no subscriber database behind this site." Both
            sentences stopped being true with 0006_enquiries.sql, which adds
            public.newsletter_signups. What has NOT changed is that nothing
            sends to it — see the marketing section below. */}
        <li>
          <strong>Asking to hear about new drops</strong> — if you give us your
          email address to hear about new designs, we save that address, the
          date you asked and which part of the site you asked from. We do not
          keep a name with it. There is no newsletter, so nothing is sent to it.
        </li>
        <li>
          <strong>Account details</strong> — if you create an account, your email
          address and a securely hashed password held by Supabase, the service
          that runs our accounts and database. We never see the password itself.
        </li>
        <li>
          <strong>Payment information</strong> — handled entirely by our payment
          processor. Card numbers are never sent to us or stored on our systems.
          We receive only a payment reference, the amount, and the billing name
          and email.
        </li>
        <li>
          <strong>Technical information</strong> — basic server logs such as IP
          address, browser type and pages requested, used to keep the site
          running and to spot abuse.
        </li>
      </ul>

      <h2>Why we collect it</h2>
      <p>
        To print, pack and post your order; to answer your questions; to process
        returns and refunds; to keep the business records the Australian Taxation
        Office requires; and, if you have asked us to, to note that you would
        like to hear about new designs and market dates if we ever set up a way
        to send them.
      </p>
      <p>
        We do not sell personal information, and we do not share it for anyone
        else&apos;s marketing.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Only the service providers we need to run the shop, and only the
        information they need:
      </p>
      <ul>
        <li>
          <strong>Payment processing</strong> — Stripe, which handles the card
          transaction and fraud checks.
        </li>
        <li>
          <strong>Accounts and order records</strong> — Supabase, which stores
          your order history, profile and sign-in details, the messages sent
          through our contact form and any address given to hear about new
          drops, and sends the account emails described below.
        </li>
        <li>
          <strong>Website hosting</strong> — the provider that serves these pages
          and keeps the basic server logs above.
        </li>
        <li>
          <strong>Delivery</strong> — Australia Post, which receives the name and
          address on the parcel label.
        </li>
        {/* Disclosed whenever email is ON — on the secrets alone, NOT on
            `FORM_DELIVERS`. The order confirmation goes through Resend with no
            dependency on the studio mailbox, so gating this on the mailbox too
            produced a real configuration in which customer names, addresses,
            order contents and totals were handed to a US processor while this
            list named no email provider at all. Both flows are described,
            because they carry different data to different recipients: the
            confirmation carries the customer's own order TO the customer, the
            form carries their message to us. */}
        {CAN_SEND_EMAIL ? (
          <li>
            <strong>Email delivery</strong> — Resend, which sends our email for
            us and is based in the United States. It handles your order
            confirmation, so it sees your name, your email address, what you
            ordered and what you paid
            {FORM_DELIVERS
              ? ", and it carries a message you send us through the contact form, or a request to hear about new drops, to our own inbox"
              : ""}
            . It does not use any of it for its own purposes.
          </li>
        ) : null}
      </ul>
      <p>
        We may also disclose information where the law requires it, or where it
        is reasonably necessary to deal with a serious safety or fraud issue.
      </p>

      <h2>Overseas disclosure</h2>
      <p>
        Some of these providers store data outside Australia, including in the
        United States and the European Union. Two of our designers are based in
        Vietnam; they work on artwork and product files and do not need access to
        customer records. By ordering — or by sending us a message or your email
        address through this site, both of which are now saved with the same
        providers — you consent to your information being stored and processed
        overseas by the providers listed above.
      </p>

      <h2>Email we send, and marketing</h2>
      {/* Three separate facts, and only one of them is unconditional.
          - Marketing, dispatch, tracking, restock and review-reminder email:
            never sent, in any configuration. Nothing in this codebase can.
          - Account email (address confirmation, password reset): always sent,
            by Supabase Auth, independent of the Resend secrets.
          - The itemised order confirmation: sent by the Stripe webhook whenever
            the Resend secrets are set. That is an automatic order email by any
            reading, so the denial has to be gated on SENDS_CONFIRMATION. This
            paragraph was previously ungated and false in the launch config. */}
      {/* "There is no mailing list" was true until 0006_enquiries.sql and is
          not any more: addresses are kept. What is still true, and is the part
          that matters to a reader, is that nothing sends to them — there is no
          code anywhere in this project that mails a subscriber. */}
      <p>
        We do not send marketing email. There is no newsletter: we keep the
        addresses that have asked to hear about new drops, and nothing is sent
        to them. If you have ticked a preference in your account, it records
        what you would like for the day we can send it, and nothing goes out in
        the meantime. We never send dispatch, tracking, restock or
        review-reminder emails.
      </p>
      <p>
        {SENDS_CONFIRMATION
          ? "There are two kinds of email this site sends by itself. The first is about your account: confirming your email address when you sign up, and the link that resets your password when you ask for one. The second is a single order confirmation, sent to the address you gave at checkout once your payment succeeds, listing what you ordered and the total paid. Neither is marketing, and there is nothing to unsubscribe from."
          : "The only email this site sends by itself is about your account: confirming your email address when you sign up, and the link that resets your password when you ask for one. Those are part of signing in, not marketing. No order confirmation is sent — your order number is shown on screen after you pay instead."}
      </p>
      <p>
        There is no unsubscribe link on this site, because there is nothing yet
        to unsubscribe from. If you would rather we did not keep your address in
        the meantime, ask us using the details under &quot;Accessing and
        correcting your information&quot; below. If we ever do start a
        newsletter, it will only go to people who asked for it, every message
        will carry an unsubscribe link, and this page will be updated before the
        first one is sent.
      </p>

      <h2>Cookies</h2>
      <p>
        The site uses cookies and similar browser storage to keep your basket
        between visits, to keep you signed in if you have an account, and to
        complete checkout securely. You can block or clear cookies in your
        browser, but the basket and checkout will not work properly without them.
        {/* Verified against the codebase: no analytics or advertising script is
            loaded anywhere. Update this line the day one is added. */}{" "}
        We do not use analytics or advertising cookies.
      </p>

      <h2>How long we keep it</h2>
      {/* Both branches of this used to say a contact-form message "is not saved
          on this site", and the last sentence said there was no subscriber list
          to keep. 0006_enquiries.sql makes all three false. No retention period
          is stated here because none is set: nothing prunes either table, and a
          period this shop does not enforce would be a worse sentence than an
          honest "until we delete it". If a period is ever decided, say it here
          and build the thing that applies it in the same change. */}
      <p>
        Order and payment records are kept for at least five years, which is the
        period Australian tax law requires.{" "}
        {FORM_DELIVERS
          ? "A message sent through our contact form is kept in our database, and so is an address given to hear about new drops."
          : "Any address we have been given to hear about new drops is kept in our database."}{" "}
        We have not set a period after which either is deleted, and nothing
        removes them on its own — they stay until we delete them by hand. You
        can ask us to delete yours at any time; see below.
      </p>

      <h2>Security</h2>
      {/* The access sentence is the schema, in plain words: both tables have
          row-level security on with no policy and are revoked from the anon and
          authenticated roles, so only the service-role key reaches them — which
          is still true now that /admin/enquiries exists, because that screen is
          server-rendered and reads with the service-role key. What changed is
          WHO can then see the words: the screen is gated on the `reports`
          capability, which the owner and studio roles hold and the packing role
          does not. That is a disclosure, so it is stated below rather than left
          implied. */}
      <p>
        The site runs over HTTPS, payment details never touch our systems, and
        access to order records is restricted to the people who need it to fill
        orders and answer messages.{" "}
        {FORM_DELIVERS
          ? "Messages sent through the contact form, and addresses given to hear about new drops, are stored"
          : "Addresses given to hear about new drops are stored"}{" "}
        where only the studio&apos;s own administrative key can reach them — the
        key this website runs on cannot read them at all. No system is perfectly
        secure, but if a data breach ever occurs that is likely to cause you
        serious harm, we will notify you and the Office of the Australian
        Information Commissioner.
      </p>
      {/* THIS PARAGRAPH USED TO SAY THE OPPOSITE, and had to be rewritten in
          the same change that shipped /admin/enquiries. It told customers there
          was no studio screen listing their messages, that a failed
          notification email meant nobody had seen theirs, and that they should
          not wait on a reply. All three stopped being true the moment that
          screen existed. A legal page that quietly becomes false is worse than
          one that admits a gap, so: if this screen is ever removed, put the old
          wording back in the same change. */}
      {FORM_DELIVERS ? (
        <p>
          Being plain about who reads a message and when: messages sent through
          this form are listed on a screen inside our studio that only accounts
          we have given access to can open — someone helping us pack parcels
          cannot see them. An email tells us a message has arrived, and if that
          email does not go out your message is still saved and still on that
          screen, so it is seen the next time we look. Nobody is watching it
          around the clock — this is a very small shop — so a reply can take a
          few days.
        </p>
      ) : null}

      <h2>Accessing and correcting your information</h2>
      <p>
        <Reach
          detail="to ask what we hold about you, to correct it, or to ask us to delete it"
          unavailable={NO_CHANNEL}
        />{" "}
        We will respond within a reasonable time, usually 30 days. Deleting an
        account is done by hand rather than by a button — see the note on the{" "}
        <Link href="/account/settings" className={LINK}>
          settings page
        </Link>
        . We may need to keep some records even after a deletion request where
        tax or consumer law requires it, and we will tell you if that applies.
      </p>

      <h2>Complaints</h2>
      <p>
        If you think we have mishandled your personal information, tell us first
        — we would rather fix it.{" "}
        <Reach
          detail="with what went wrong"
          unavailable={NO_CHANNEL}
        />{" "}
        If you are not satisfied with our response, you can complain to the
        Office of the Australian Information Commissioner at oaic.gov.au.
      </p>

      <h2>Children</h2>
      <p>
        Our products are bought by adults. We do not knowingly collect personal
        information from children, and we ask that anyone under 18 orders through
        a parent or guardian.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will update this page when our practices change, and the date at the
        top will change with it.
      </p>
    </LegalShell>
  );
}
