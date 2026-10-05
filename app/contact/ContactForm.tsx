"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Field, Icon, inputClass } from "@/components/ui";
import { SHOP } from "@/lib/config";
import { hasStudioMailbox } from "@/lib/contact";

const TOPICS = [
  { value: "order", label: "A question about my order" },
  { value: "returns", label: "Returns or something faulty" },
  { value: "custom", label: "Custom design request" },
  { value: "wholesale", label: "Wholesale or market enquiry" },
  { value: "other", label: "Something else" },
];

/**
 * /api/contact stores the enquiry as a row first, then emails the studio
 * (0006_enquiries.sql). `stored: true` means the message is in the studio
 * inbox (/admin/enquiries) whether or not the email went out, so both
 * `delivered` and `stored` count as received - "sent". Only a 200 with neither
 * is `undelivered`: the enquiry reached nobody, so the form stays on screen with
 * the customer's words intact. No reply time is promised in either case.
 */
type Status = "idle" | "sending" | "sent" | "undelivered" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  // When the form appeared, for the server's too-fast-to-be-human check.
  const openedAt = useRef(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus("sending");
    setError(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          topic: String(data.get("topic") ?? ""),
          orderNumber: String(data.get("orderNumber") ?? ""),
          message: String(data.get("message") ?? ""),
          website: String(data.get("website") ?? ""),
          elapsedMs: openedAt.current ? Date.now() - openedAt.current : undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? body.error
            : "That didn't send. Please try again in a moment.",
        );
        setStatus("error");
        return;
      }

      const body = await res.json().catch(() => null);

      // 200 says the submission was valid, not that it arrived. Only clear the
      // form once the enquiry is stored in the studio inbox or was emailed.
      if (body?.delivered || body?.stored) {
        form.reset();
        setStatus("sent");
        return;
      }
      setStatus("undelivered");
    } catch {
      setError(
        "We couldn't connect. Check your connection and try again.",
      );
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="card flex flex-col items-start p-7 sm:p-9">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good-soft text-good">
          <Icon name="check" size={28} strokeWidth={2.4} />
        </span>
        <h2 className="mt-5 text-2xl">Message sent</h2>
        {/* Rendered on delivered:true or stored:true. Either way the message
            is in the studio inbox, so "received" is a report, not a hope. No
            reply time: nothing in this codebase measures a turnaround. */}
        <p className="mt-2 max-w-[48ch] text-[15px] text-muted">
          Thanks, we&apos;ve got your message. We read every one ourselves.
        </p>
        <Button
          variant="soft"
          className="mt-6"
          onClick={() => setStatus("idle")}
        >
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <div className="card p-7 sm:p-9">
      <h2 className="text-2xl">Send us a message</h2>
      <p className="mt-1.5 text-[14.5px] text-muted">
        Fields marked * are required.
      </p>

      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
        {/* Hidden from people and screen readers; bots fill it in. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label>
            Website
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name *" htmlFor="contact-name">
            <input
              id="contact-name"
              name="name"
              type="text"
              required
              maxLength={100}
              autoComplete="name"
              placeholder="Mia Nguyen"
              className={inputClass}
            />
          </Field>

          <Field label="Email *" htmlFor="contact-email">
            <input
              id="contact-email"
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              placeholder="you@example.com"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Topic *" htmlFor="contact-topic">
            <select
              id="contact-topic"
              name="topic"
              required
              defaultValue="order"
              className={inputClass}
            >
              {TOPICS.map((topic) => (
                <option key={topic.value} value={topic.value}>
                  {topic.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Order number"
            htmlFor="contact-order"
            hint="Optional, e.g. BS-1042-9F3A"
          >
            <input
              id="contact-order"
              name="orderNumber"
              type="text"
              maxLength={40}
              placeholder="BS-1042-9F3A"
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          label="Message *"
          htmlFor="contact-message"
          hint="At least 10 characters."
        >
          <textarea
            id="contact-message"
            name="message"
            required
            minLength={10}
            maxLength={2000}
            rows={6}
            placeholder="How can we help?"
            className="w-full rounded-xl border border-line2 bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </Field>

        {status === "error" && error ? (
          <Alert tone="error">{error}</Alert>
        ) : null}

        {status === "undelivered" ? (
          <Alert tone="error">
            That didn&apos;t reach us. Your message is still here.{" "}
            {/* Built from NEXT_PUBLIC_ config only, so it is identical on the
                server and in the browser - safe in a client component. Whether
                the form DELIVERS is decided by the server page, which renders
                this component only when it does. */}
            {hasStudioMailbox ? (
              <>
                Please email it to{" "}
                <a
                  href={`mailto:${SHOP.supportEmail}`}
                  className="font-bold underline underline-offset-2"
                >
                  {SHOP.supportEmail}
                </a>
                .
              </>
            ) : (
              <>Try again in a few minutes.</>
            )}
          </Alert>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-4">
          <Button type="submit" size="lg" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send message"}
            <Icon name="arrow" size={18} />
          </Button>
          <span className="text-xs text-muted">
            We only use your details to reply.
          </span>
        </div>
      </form>
    </div>
  );
}
