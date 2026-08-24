import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "../LegalShell";
import { PRINT_LEAD_TIME, SHIPPING, SHOP } from "@/lib/config";
import { money } from "@/lib/format";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms you agree to when you order from Bam Studio: ordering, pricing, made-to-order lead times, personalisation, delivery, design ownership and your consumer rights.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of service"
      intro={`The agreement between you and ${SHOP.name} when you buy something from this website.`}
      updated="25 August 2026"
    >
      <h2>About these terms</h2>
      <p>
        This website is operated by [REGISTERED BUSINESS NAME], ABN [ABN], a sole
        trader based in {SHOP.city}, {SHOP.country}, trading as {SHOP.name}. By
        placing an order you agree to these terms. If you do not agree with them,
        please do not order.
      </p>

      <h2>Ordering</h2>
      <p>
        Placing an order is an offer to buy. A contract is formed when we send
        you an order confirmation email. Until then we may decline an order — for
        example if an item has sold out, if a price was listed incorrectly, or if
        we cannot deliver to your address. If we decline after you have paid, we
        refund you in full.
      </p>

      <h2>Prices and payment</h2>
      <p>
        All prices are in Australian dollars and include any GST that applies.
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
        what you enter. Check your order confirmation carefully and tell us
        immediately if something is wrong.
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
        We post within Australia through Australia Post. Standard post is{" "}
        {money(SHIPPING.methods[0].price)} ({SHIPPING.methods[0].description})
        and express is {money(SHIPPING.methods[1].price)} (
        {SHIPPING.methods[1].description}), both measured from dispatch, not from
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
      <p>[ADD INTERNATIONAL SHIPPING TERMS HERE IF YOU START SHIPPING ABROAD.]</p>

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
        [REGISTERED BUSINESS NAME], [BUSINESS POSTAL ADDRESS], or email
        [HELLO@YOURDOMAIN]. You can also use our{" "}
        <Link
          href="/contact"
          className="font-bold text-accent underline underline-offset-2"
        >
          contact form
        </Link>
        .
      </p>
    </LegalShell>
  );
}
