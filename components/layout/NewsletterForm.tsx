"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui";

/**
 * There is still no newsletter — no mailout, no welcome email and no
 * unsubscribe link anywhere on this site — so nothing here may promise one, or
 * a frequency.
 *
 * What did change (0006_enquiries.sql) is that the address is now kept.
 * /api/newsletter writes it to `public.newsletter_signups` before it emails the
 * studio, so a mail provider that is unconfigured or down no longer throws the
 * request away. That table is a record that somebody asked; it is not a list
 * anything sends to.
 *
 * The two response flags say different things and both are used below.
 * `delivered` says only that the studio was emailed about the request — never
 * that anyone read it. `stored` says the address is on record and will still be
 * there tomorrow — never that it is subscribed to anything, because nothing
 * sends to it. "That did not reach the studio and nothing was saved" was this
 * component's undelivered copy and is false whenever `stored` is true, which is
 * why the two cases are now worded apart.
 *
 * The Footer decides whether this form is offered at all; it renders only where
 * the request can actually reach someone. That decision needs the server-side
 * Resend secrets, which is why it is made there and not here — a client
 * component reads them as `undefined`. Nothing in this component depends on the
 * capability, so no prop is threaded in; if a claim about email is ever added
 * here it must arrive as one.
 *
 * The order-confirmation email the shop now sends is unrelated to this box and
 * must not be mentioned in it: signing up for news is not buying something.
 */
type State = "idle" | "sending" | "done" | "undelivered" | "error";

const noteClass =
  "flex items-start gap-2 rounded-xl bg-[#38332D] px-4 py-3 text-[13.5px] font-semibold text-[#D8D2C6]";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  // Kept separately from `state` because it is orthogonal to it: an address can
  // be on record whether or not the studio was told, and the undelivered copy
  // is only true in one of those two cases.
  const [stored, setStored] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => null);

      // 400/429 — the address was rejected or we are throttled. The route
      // sends wording the customer can act on, so prefer it over our own.
      if (!res.ok || !body?.ok) {
        setError(
          typeof body?.error === "string"
            ? body.error
            : "That did not go through. Please try again in a moment.",
        );
        setState("error");
        return;
      }

      // 200 either way. `delivered` says whether the studio was notified and
      // `stored` whether the address is on record; they are independent, and
      // the copy below may only claim the one it has.
      setEmail("");
      setStored(body.stored === true);
      setState(body.delivered ? "done" : "undelivered");
    } catch {
      setError("We could not reach the studio. Check your connection and try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className={noteClass}>
        <Icon name="check" size={16} className="mt-0.5 shrink-0" />
        <span>
          {stored
            ? "Your address is on record and the studio has been told. There is still no newsletter, so nothing goes out to it yet."
            : "Passed on to the studio, though we could not put your address on record here — so it may not be kept. There is no newsletter yet either way."}
        </span>
      </p>
    );
  }

  if (state === "undelivered") {
    return (
      <p className={noteClass}>
        <Icon name="help" size={16} className="mt-0.5 shrink-0" />
        {stored ? (
          <span>
            Your address is on record, but we could not tell the studio, so
            nobody has seen it yet. There is still no newsletter and nothing
            goes out to it. If you need an answer to something,{" "}
            <Link href="/contact" className="underline underline-offset-2">
              say hello here
            </Link>
            .
          </span>
        ) : (
          <span>
            That did not reach the studio and nothing was saved. Try again in a
            minute, or{" "}
            <Link href="/contact" className="underline underline-offset-2">
              say hello here
            </Link>
            .
          </span>
        )}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          Email address
        </label>
        <input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email address"
          className="h-12 min-w-0 flex-1 rounded-xl border border-[#4A443C] bg-[#38332D] px-4 text-[15px] text-[#F6F2EA] placeholder:text-[#948D80] focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="h-12 shrink-0 rounded-full bg-[#F6F2EA] px-5 font-display font-semibold text-[#2B2724] disabled:opacity-60"
        >
          {state === "sending" ? "…" : "Ask"}
        </button>
      </div>
      {/* Previously sr-only, so a failed submit looked like nothing happened —
          the customer would assume they were signed up. */}
      {state === "error" && error ? (
        <p role="alert" className="text-[12.5px] text-[#E8B4A8]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
