import type { Metadata } from "next";
import { LegalShell } from "../LegalShell";
import { SHOP } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What personal information Bam Studio collects when you order, why we collect it, who we share it with, and how to access or correct it.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy policy"
      intro={`How ${SHOP.name} handles the personal information you give us when you order, sign up or send us a message.`}
      updated="25 August 2026"
    >
      <h2>Who we are</h2>
      <p>
        {SHOP.name} is a sole trader business operating as{" "}
        [REGISTERED BUSINESS NAME], ABN [ABN], based in {SHOP.city},{" "}
        {SHOP.country}. In this policy, &quot;we&quot; and &quot;us&quot; mean
        that business. We can be reached at [HELLO@YOURDOMAIN] or by post at
        [BUSINESS POSTAL ADDRESS].
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
        <li>
          <strong>Messages</strong> — anything you send through our contact form
          or by email, including the order number you quote.
        </li>
        <li>
          <strong>Newsletter signups</strong> — your email address, and nothing
          else.
        </li>
        <li>
          <strong>Account details</strong> — if you create an account, your email
          address and a securely hashed password held by our hosting provider. We
          never see the password itself.
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
        Office requires; and, if you have asked for it, to send you occasional
        news about new designs and market dates.
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
          <strong>Website and database hosting</strong> — [HOSTING PROVIDER] and
          [DATABASE PROVIDER], which store order and account records.
        </li>
        <li>
          <strong>Delivery</strong> — Australia Post, which receives the name and
          address on the parcel label.
        </li>
        <li>
          <strong>Email</strong> — [EMAIL PROVIDER], which sends order
          confirmations and any newsletter you subscribed to.
        </li>
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
        customer records. By ordering, you consent to your information being
        stored and processed overseas by the providers listed above.
      </p>

      <h2>Marketing and how to opt out</h2>
      <p>
        We only email marketing to people who asked for it. Every newsletter has
        an unsubscribe link, and you can also reply to any email or write to
        [HELLO@YOURDOMAIN] and we will take you off the list. Order
        confirmations, delivery updates and replies to your own messages are not
        marketing and will still be sent.
      </p>

      <h2>Cookies</h2>
      <p>
        The site uses cookies and similar browser storage to keep your basket
        between visits, to keep you signed in if you have an account, and to
        complete checkout securely. You can block or clear cookies in your
        browser, but the basket and checkout will not work properly without them.
        [ADD ANY ANALYTICS OR ADVERTISING COOKIES HERE BEFORE LAUNCH.]
      </p>

      <h2>How long we keep it</h2>
      <p>
        Order and payment records are kept for at least five years, which is the
        period Australian tax law requires. Contact-form messages are kept while
        they are useful for support and then deleted. Newsletter subscriptions
        are kept until you unsubscribe.
      </p>

      <h2>Security</h2>
      <p>
        The site runs over HTTPS, payment details never touch our systems, and
        access to order records is restricted to the people who need it to fill
        orders. No system is perfectly secure, but if a data breach ever occurs
        that is likely to cause you serious harm, we will notify you and the
        Office of the Australian Information Commissioner.
      </p>

      <h2>Accessing and correcting your information</h2>
      <p>
        Email [HELLO@YOURDOMAIN] to ask what we hold about you, to correct it, or
        to ask us to delete it. We will respond within a reasonable time, usually
        30 days. We may need to keep some records even after a deletion request
        where tax or consumer law requires it, and we will tell you if that
        applies.
      </p>

      <h2>Complaints</h2>
      <p>
        If you think we have mishandled your personal information, tell us first
        at [HELLO@YOURDOMAIN] — we would rather fix it. If you are not satisfied
        with our response, you can complain to the Office of the Australian
        Information Commissioner at oaic.gov.au.
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
        top will change with it. Material changes will also be noted in the
        newsletter.
      </p>
    </LegalShell>
  );
}
