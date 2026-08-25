import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LegalShell } from "../LegalShell";
import { PRINT_LEAD_TIME, SHOP } from "@/lib/config";
import {
  canReachStudio,
  formsReachStudio,
  hasSocialAccount,
  hasStudioMailbox,
  sendsOrderConfirmation,
  socialLinks,
} from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";

export const metadata: Metadata = {
  title: "Refund policy",
  description:
    "Bam Studio's returns, refunds and replacements: 30 days for change of mind on stock designs, the personalised-items exception, and your Australian Consumer Law rights.",
};

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would turn a term of the contract — and the remedy
 * it points a charged customer at — into a false statement. A legal document
 * nobody loads in bulk can afford the render.
 */
export const dynamic = "force-dynamic";

/**
 * Whether the shop can send at all, read once from the server-side secrets.
 * This is a server component, so `isEmailConfigured()` is safe here and is the
 * same condition the senders themselves check — no public mirror to drift.
 */
const CAN_SEND_EMAIL = isEmailConfigured();

/** Does an enquiry typed into /contact reach a person? See lib/contact.ts. */
const FORM_DELIVERS = formsReachStudio(CAN_SEND_EMAIL);

/** Does paying trigger an automatic order email listing what was bought? */
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
 * Same chain as the privacy and terms pages. The *predicates* it branches on
 * now live in lib/contact.ts; the JSX itself still cannot, because a .ts module
 * holds no markup and each page words the fallback differently.
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
    We have not published a contact address yet, so there is no way to start
    this online. Any channel we open will be listed on our{" "}
    <Link href="/contact" className={LINK}>
      contact page
    </Link>
    , and your rights under the Australian Consumer Law are unaffected in the
    meantime.
  </>
);

export default function RefundsPage() {
  return (
    <LegalShell
      title="Refund policy"
      intro={`When you can send something back to ${SHOP.name}, when you cannot, and how we put it right when we get it wrong.`}
      updated="25 August 2026"
    >
      <h2>Your rights come first</h2>
      <p>
        Our goods come with guarantees that cannot be excluded under the
        Australian Consumer Law. You are entitled to a replacement or refund for
        a major failure and to compensation for any other reasonably foreseeable
        loss or damage. You are also entitled to have the goods repaired or
        replaced if they fail to be of acceptable quality and the failure does not
        amount to a major failure.
      </p>
      <p>
        <strong>
          Nothing on this page reduces those rights, including for personalised
          items.
        </strong>{" "}
        Everything below is either how we meet those obligations, or a goodwill
        policy we offer on top of them.
      </p>

      <h2>Change of mind — 30 days</h2>
      <p>
        We will accept a return on a stock design within 30 days of delivery,
        provided it is unused, undamaged and comes back in its original
        packaging. Once we receive it and check it, we refund the item price to
        your original payment method.
      </p>
      <ul>
        <li>Return postage for a change of mind is at your cost.</li>
        <li>The original delivery charge is not refunded.</li>
        <li>
          Send it with tracking. Until it reaches us, the parcel is your
          responsibility.
        </li>
        <li>
          Items returned used, scratched, or without packaging may be refused or
          partially refunded.
        </li>
      </ul>

      <h2>Personalised items — the exception</h2>
      <p>
        <strong>
          Personalised items cannot be returned or exchanged for change of mind.
        </strong>{" "}
        That covers name charms, letter builds and any custom design made to your
        specification. They are printed to order with your choices and cannot be
        resold to anyone else.
      </p>
      <p>
        Personalised items <strong>can</strong> be returned if they are faulty,
        damaged in transit, or not what you ordered — for example if we printed a
        different name or colour than your order shows. Your Australian Consumer
        Law rights apply to personalised items in full.
      </p>
      {/* The check points at surfaces that exist in every configuration: the
          basket before payment and the order record afterwards. A confirmation
          email now exists too, but only while the Resend secrets are set and it
          can fail without anyone noticing, so it is offered as an extra place
          to look rather than as the place to look. */}
      <p>
        Because a misspelling cannot be undone, please check the spelling and
        colour in your basket before you pay — and again in{" "}
        <Link href="/account/orders" className={LINK}>
          your account
        </Link>{" "}
        if you have one
        {SENDS_CONFIRMATION
          ? ", or on the confirmation email we send when your payment goes through"
          : ""}
        . Tell us straight away if it is wrong; there is usually a window before
        it goes on the printer.
      </p>

      <h2>Faulty, damaged or wrong items</h2>
      <p>
        Tell us within 14 days of delivery, or as soon as a fault appears if it
        is not immediately obvious.{" "}
        <Reach
          detail="with your order number and a photo of the problem — a photo usually saves you having to post anything at all"
          unavailable={NO_CHANNEL}
        />
      </p>
      <p>
        Where an item is faulty, damaged or not what you ordered, we pay the
        return postage and you choose a replacement or a refund for a major
        failure. For a minor fault we may repair or replace the item instead,
        which is what the law allows. Refunds include the delivery charge where
        the whole order was affected.
      </p>

      <h2>Parcels lost in transit</h2>
      <p>
        If tracking has not moved for a week, or the parcel is marked delivered
        and is nowhere to be found, contact us. We lodge an enquiry with
        Australia Post and, once it is clear the parcel is gone, we reprint and
        resend at no cost to you or refund you in full.
      </p>

      <h2>Cancelling or changing an order</h2>
      <p>
        Because printing starts soon after you order, tell us quickly. If your
        order has not gone on the printer we will happily change the colour,
        correct the address or cancel and refund it in full. Once printing has
        started we cannot cancel a personalised item, and other items can only be
        cancelled before dispatch. Printing runs {PRINT_LEAD_TIME.label}, so
        there is usually a window.
      </p>

      <h2>How to start a return</h2>
      {/* The reply here is a person writing back from the studio inbox, not an
          automated email — real as long as there is a channel to write to. With
          no channel at all the steps cannot be honestly described, so the page
          says that instead. The return address itself is a detail only the
          owner can supply, so it is given in the reply rather than printed. */}
      {canReachStudio ? (
        <>
          <ul>
            <li>
              <Reach
                detail="with your order number, what you want to return, and why"
                unavailable={NO_CHANNEL}
              />
            </li>
            <li>
              Wait for our reply before posting anything — one of us will write
              back with the return address and, where it is our fault, a way to
              return it at our cost.
            </li>
            <li>
              Pack the item so it survives the trip, include a note with your
              order number, and send it with tracking.
            </li>
          </ul>
          <p>
            Please do not send anything back before contacting us; unannounced
            returns are easy to lose, and the return address is not published
            here.
          </p>
        </>
      ) : (
        <p>{NO_CHANNEL}</p>
      )}

      <h2>When we refund</h2>
      <p>
        We process approved refunds within 3 business days of receiving the item
        or agreeing to the refund. It then takes your bank or card issuer a
        further 5 to 10 business days to show the money. Refunds go back to the
        original payment method — we cannot refund to a different card or
        account.
      </p>

      <h2>What is not covered</h2>
      <ul>
        <li>
          Normal wear from use. Clicker mechanisms loosen a little as they wear
          in, which is how they are meant to behave.
        </li>
        <li>
          Heat damage. PLA softens in a hot car, in direct summer sun or in a
          dishwasher.
        </li>
        <li>Damage from drops, pets, modification or misuse.</li>
        <li>
          Layer lines, faint seams and small variations between two of the same
          design — these are inherent to 3D printing, not faults.
        </li>
      </ul>

      <h2>Market purchases</h2>
      <p>
        Items bought at a market stall follow the same rules, and your Australian
        Consumer Law rights are identical. Please keep your receipt, since a cash
        sale at the stall leaves no online order record for us to look up.
      </p>

      <h2>Still not sorted?</h2>
      <p>
        <Reach
          detail="and tell us where it went wrong"
          unavailable={NO_CHANNEL}
        />{" "}
        If we cannot agree, you can contact NSW Fair Trading or the ACCC about
        your consumer rights.
      </p>
    </LegalShell>
  );
}
