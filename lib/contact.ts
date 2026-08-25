/**
 * The "can a customer reach us, and what do we actually send them" predicates.
 *
 * These used to be copy-pasted into nine files under three names —
 * `canReachStudio`, `HAS_CHANNEL` (the same mailbox-or-social test) and
 * `FORM_DELIVERS` — with several of the copies carrying a comment saying they
 * wanted to live here. A page that edits its own copy silently desynchronises
 * from the eight that did not, and every one of them gates a promise made to
 * someone who has already been charged. So there is one definition of each.
 *
 * **This module is safe to import from a client component.** It reads only
 * `SHOP`, which is built from `NEXT_PUBLIC_` variables, so every constant here
 * has the identical value on the server and in the browser and cannot cause a
 * hydration mismatch.
 *
 * The one fact that is NOT public is whether the shop can send email at all:
 * that is `isEmailConfigured()` in lib/email.ts, which reads the `RESEND_API_KEY`
 * / `EMAIL_FROM` secrets and may only be called on the server. So the two
 * predicates that depend on it take it as an argument rather than reading it:
 * a server component calls `isEmailConfigured()` and either uses the answer or
 * passes it to its client children as a prop. See lib/email.ts for why the old
 * `NEXT_PUBLIC_EMAIL_ENABLED` mirror of that secret had to go.
 */

import { SHOP } from "@/lib/config";

export type SocialLink = { href: string; label: string };

/**
 * The social accounts that actually exist, in the order they are shown.
 *
 * Both URLs are env-configured and null until set. A link labelled "Instagram"
 * that goes nowhere is its own small false promise, so an unset handle is
 * absent from this list rather than rendered dead.
 */
export const socialLinks: SocialLink[] = [
  SHOP.socials.instagram
    ? { href: SHOP.socials.instagram, label: "Instagram" }
    : null,
  SHOP.socials.tiktok ? { href: SHOP.socials.tiktok, label: "TikTok" } : null,
].filter((link): link is SocialLink => link !== null);

/**
 * Is there a real studio mailbox?
 *
 * Asserts: `SHOP.supportEmail` is an address a person reads, not the
 * `[HELLO@YOURDOMAIN]` placeholder. **Never print `SHOP.supportEmail` or build
 * a `mailto:` from it without checking this** — the placeholder reads as a real
 * address and silently swallows a customer's faulty-goods claim.
 */
export const hasStudioMailbox: boolean = SHOP.hasSupportEmail;

/** At least one social account is published, so a DM is a real channel. */
export const hasSocialAccount: boolean = socialLinks.length > 0;

/**
 * Is there ANY door a customer can walk through under their own steam — a
 * mailbox to write to, or an account to DM?
 *
 * Asserts: "get in touch and we'll put it right" names something that exists.
 * Every remedy offered to someone who has been charged hangs off this.
 *
 * Deliberately does NOT count the on-site contact form. The form is not a
 * channel on its own: it delivers by emailing the studio mailbox, so it needs
 * both the mailbox and sending capability — see `formsReachStudio`. Using this
 * predicate to decide whether to render the form would put a box in front of a
 * customer whose message reaches nobody.
 */
export const canReachStudio: boolean = hasStudioMailbox || hasSocialAccount;

/**
 * Does a message typed into a form on this site actually reach a human?
 *
 * Covers both submission forms, because both work the same way: `/api/contact`
 * and `/api/newsletter` each forward to `SHOP.supportEmail` through Resend and
 * neither persists anything, so the send IS the delivery. Without the mailbox
 * there is nowhere to send it; without the secrets nothing is sent.
 *
 * @param canSendEmail `isEmailConfigured()`, read on the server. Passing a
 *   public build flag here instead is the defect this module exists to stop:
 *   the flag can be true while the secrets are absent, and then the form is
 *   offered, accepted, and the enquiry is lost with nothing recording it.
 *
 * Asserts: it is honest to render the form/sign-up box and to say "our contact
 * form reaches the same inbox". Misusing it — rendering the form when this is
 * false — silently swallows enquiries, including faulty-goods claims.
 */
export function formsReachStudio(canSendEmail: boolean): boolean {
  return canSendEmail && hasStudioMailbox;
}

/**
 * Does the shop email a customer an order confirmation when they pay?
 *
 * The Stripe webhook sends an itemised confirmation (line items, subtotal,
 * postage, total paid) on `isEmailConfigured()` **alone** — it has no
 * dependency on the studio mailbox, which only decides whether the mail also
 * carries a reply-to. So this is that condition and nothing else.
 *
 * @param canSendEmail `isEmailConfigured()`, read on the server.
 *
 * Asserts: the shop sends the customer an automatic order email. Every "we do
 * not send order emails" sentence on the site — including the two in the legal
 * documents — must be gated on this being false, and every "your confirmation
 * is on its way" on it being true. Anding it with `hasStudioMailbox` (the old
 * `FORM_DELIVERS` test) is the specific mistake to avoid: it produces
 * configurations where the mail goes out and the privacy policy denies it.
 */
export function sendsOrderConfirmation(canSendEmail: boolean): boolean {
  return canSendEmail;
}
