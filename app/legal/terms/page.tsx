import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LegalShell } from "../LegalShell";
import {
  PRINT_LEAD_TIME,
  SHIPPING,
  SHOP,
  transitRangeLabel,
} from "@/lib/config";
import {
  formsReachStudio,
  hasSocialAccount,
  hasStudioMailbox,
  sendsOrderConfirmation,
  socialLinks,
} from "@/lib/contact";
import { isEmailConfigured } from "@/lib/email";
import { money } from "@/lib/format";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms you agree to when you order from Bam Studio: ordering, pricing, made-to-order lead times, personalisation, delivery, design ownership and your consumer rights.",
};

/**
 * Rendered on every request, never baked at build time.
 *
 * The email sentences below are derived from `isEmailConfigured()`, which
 * reads the RESEND_API_KEY / EMAIL_FROM secrets at render time. Prerendered,
 * that answer is frozen into the HTML at build: an owner who adds the two
 * secrets to the host without triggering a rebuild gets order-confirmation
 * emails going out from the Stripe webhook while this page still says none
 * are sent. A stale bake would turn a term of the contract into a false
 * statement; a legal document nobody loads in bulk can afford the render.
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

/** Does paying trigger an automatic order email? Gates the sentence below. */
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
 * Same chain as the privacy and refund pages. The *predicates* it branches on
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
    We have not published a contact address yet. Until one appears on our{" "}
    <Link href="/contact" className={LINK}>
      contact page
    </Link>
    , there is no way to reach us about an order.
  </>
);

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of service"
      intro={`The agreement between you and ${SHOP.name} when you buy something from this website.`}
      updated="25 August 2026"
    >
      <h2>About these terms</h2>
      {/* The registered business name and postal address are the owner's own
          details and cannot be invented here, so the sentence is written to be
          true without them. Both still have to be added before launch. */}
      <p>
        This website is operated by a sole trader based in {SHOP.city},{" "}
        {SHOP.country}, trading as {SHOP.name}
        {SHOP.abn ? <>, ABN {SHOP.abn}</> : null}. By placing an order you agree
        to these terms. If you do not agree with them, please do not order.
      </p>

      <h2>Ordering</h2>
      {/* Contract formation must key on something the software actually does.
          Checkout stages the order as `pending`; the Stripe webhook confirms it
          and allocates the order number once payment succeeds. The confirmation
          email is sent AFTER that, only when the Resend secrets are set, and it
          can fail silently — so the contract cannot hang off it, which is why
          the old "when we send you an order confirmation email" was wrong even
          now that one is sent. FLAGGED FOR THE OWNER'S LEGAL REVIEW — it is the
          most load-bearing sentence on the site. */}
      <p>
        Placing an order is an offer to buy. We accept that offer — and the
        contract is formed — when your payment succeeds and we record the order
        under its own order number, which is the number shown to you at the end
        of checkout. Until that happens we may decline an order — for example if
        an item has sold out, if a price was listed incorrectly, or if we cannot
        deliver to your address. If we decline after you have paid, we refund you
        in full.
      </p>
      <p>
        Keep your order number: it is how you{" "}
        <Link href="/track" className={LINK}>
          track the parcel
        </Link>{" "}
        and how we find your order if you write to us.{" "}
        {/* Gated on the capability the webhook itself checks, never on a
            separate switch: while the secrets are set an itemised confirmation
            really is sent, and denying it here would be a false statement in a
            legal document. Dispatch and tracking mail is denied unconditionally
            because nothing sends either in any configuration. It is stated as
            what we do, not as a delivery guarantee — the send is fire-and-forget
            and can fail, which is why /track never depends on it. */}
        {SENDS_CONFIRMATION
          ? "When your payment succeeds we email you an order confirmation listing what you ordered and the total paid. We do not send dispatch or tracking emails, and the confirmation is a courtesy rather than a guarantee — your order number and this website are what you rely on."
          : "We do not send order confirmation, dispatch or tracking emails."}
      </p>

      <h2>Prices and payment</h2>
      <p>
        All prices are in Australian dollars.{" "}
        {SHOP.gstRegistered
          ? "Prices include GST, and your receipt shows the GST component."
          : `${SHOP.name} is not currently registered for GST, so no GST is charged on your order.`}
        Prices exclude delivery, which is shown at checkout before you pay.
      </p>
      <p>
        Payment is taken at checkout through Stripe. We do not receive or store
        your card details. If your payment is reversed or charged back after we
        have dispatched, we may recover the goods or the amount owing.
      </p>

      <h2>Made to order</h2>
      <p>
        Everything here is printed after you order it, on a single printer, in
        PLA plastic. Allow {PRINT_LEAD_TIME.label} for printing, checking and
        packing before dispatch. That lead time is in addition to delivery time,
        and it can stretch during market weekends or a busy gift season — we will
        tell you if it does.
      </p>

      <h2>How the products look</h2>
      <p>
        These are 3D-printed objects, not injection-moulded ones. Fine layer
        lines, small seam marks and slight differences between two of the same
        design are normal and are not defects. Colours on your screen will not
        match the filament exactly, and filament batches shift a little over
        time.
      </p>
      <p>
        <strong>Safety:</strong> these are not toys for children under three —
        they contain small parts and can present a choking hazard. PLA is not
        food-safe, dishwasher-safe or heat-resistant. Keep pieces out of hot cars
        and away from boiling water.
      </p>

      <h2>Personalised items</h2>
      <p>
        For name charms and anything else you personalise, you are responsible
        for the spelling, characters and colours you submit — we print exactly
        what you enter. Check the personalisation in your basket before you pay,
        and afterwards in{" "}
        <Link href="/account/orders" className={LINK}>
          your account
        </Link>{" "}
        if you have one. Tell us immediately if something is wrong.
      </p>
      <p>
        We will not print licensed or trademarked characters, logos, or anything
        offensive, hateful or unlawful. If we decline a personalisation request
        for one of those reasons, we will refund you in full.
      </p>
      <p>
        Personalised items cannot be returned for change of mind. See our{" "}
        <Link
          href="/legal/refunds"
          className="font-bold text-accent underline underline-offset-2"
        >
          refund policy
        </Link>
        .
      </p>

      <h2>Delivery</h2>
      <p>
        {/* This clause named a flat $9.50 / $14.50 until postage moved to live
            Australia Post quoting, at which point it would have been a stated
            price the shop does not charge — in the contract itself. It now
            states the rule rather than a number, which stays true as carrier
            rates move. The free-postage threshold is the shop's own promotion,
            is unchanged, and is still stated as a figure because it is one. */}
        We post within Australia through Australia Post. Postage is calculated
        from the weight of your order at Australia Post&rsquo;s current rates,
        and the exact amount is shown to you before you pay. Standard post takes{" "}
        {transitRangeLabel("standard")} and express takes{" "}
        {transitRangeLabel("express")}, both measured from dispatch, not from
        when you order. Standard post is free on orders of{" "}
        {money(SHIPPING.freeThreshold)} or more.
      </p>
      <p>
        Delivery timeframes are estimates given by the carrier, not guarantees.
        You are responsible for giving us a correct, complete delivery address;
        parcels returned to us because of a wrong address can be re-sent at your
        cost. Risk in the goods passes to you on delivery. If a parcel appears
        lost or is damaged in transit, contact us and we will lodge an enquiry
        with the carrier and sort out a replacement or refund.
      </p>
      {/* Checkout only accepts Australian addresses (`allowed_countries: ["AU"]`
          in app/api/checkout/route.ts), so this is a statement of what the site
          does, not a placeholder for terms that do not exist yet. */}
      <p>
        We post within Australia only. Checkout will not accept an overseas
        delivery address, and these terms do not cover international orders.
      </p>

      <h2>Custom and wholesale orders</h2>
      <p>
        Custom design work and larger wholesale runs are quoted individually.
        Quotes cover the design, quantity, price and lead time, and are valid for
        30 days. Custom work is treated as personalised for the purposes of
        returns. We may ask for a deposit before starting a large run.
      </p>

      <h2>Our designs</h2>
      <p>
        Every design we sell is our own original work. The designs, product
        photography, illustrations, text and the model files behind them remain
        our intellectual property. Buying a product does not give you a licence
        to copy it, scan it, reproduce it, or make and sell versions of it. You
        are of course free to resell the individual item you bought.
      </p>

      <h2>Using this website</h2>
      <p>
        Do not attempt to break into, overload, scrape or interfere with the
        site. If you create an account, keep your password to yourself — you are
        responsible for what happens under your account. We may suspend an
        account that is being used abusively.
      </p>

      <h2>Your consumer rights</h2>
      <p>
        Our goods come with guarantees that cannot be excluded under the
        Australian Consumer Law. You are entitled to a replacement or refund for
        a major failure and to compensation for any other reasonably foreseeable
        loss or damage. You are also entitled to have the goods repaired or
        replaced if they fail to be of acceptable quality and the failure does not
        amount to a major failure.
      </p>
      <p>
        Nothing in these terms limits those rights. To the extent the law allows,
        and other than under those guarantees, our liability for any claim
        connected with an order is limited to replacing the goods or refunding
        what you paid for them.
      </p>

      <h2>Privacy</h2>
      <p>
        Personal information is handled as described in our{" "}
        <Link
          href="/legal/privacy"
          className="font-bold text-accent underline underline-offset-2"
        >
          privacy policy
        </Link>
        .
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms from time to time. The version published when
        you place your order is the one that applies to that order.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of New South Wales, Australia, and
        the courts of that state have jurisdiction over any dispute.
      </p>

      <h2>Contact</h2>
      <p>
        <Reach
          detail="about an order or about these terms"
          unavailable={NO_CHANNEL}
        />
      </p>
    </LegalShell>
  );
}
