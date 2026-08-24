"use client";

import { useState } from "react";
import { Alert, Button, Field, Icon, inputClass } from "@/components/ui";

const TOPICS = [
  { value: "order", label: "A question about my order" },
  { value: "returns", label: "Returns or something faulty" },
  { value: "custom", label: "Custom design request" },
  { value: "wholesale", label: "Wholesale or market enquiry" },
  { value: "other", label: "Something else" },
];

type Status = "idle" | "sending" | "sent" | "error";

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
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
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          typeof body?.error === "string"
            ? body.error
            : "We could not send that just now. Please try again in a moment.",
        );
        setStatus("error");
        return;
      }

      form.reset();
      setStatus("sent");
    } catch {
      setError(
        "We could not reach the studio — check your connection and try again.",
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
        <p className="mt-2 max-w-[48ch] text-[15px] text-muted">
          Thank you — it has landed in our inbox. One of us reads every message
          personally, so replies usually take a business day or two, and a little
          longer over a market weekend.
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
        Fields marked with an asterisk are required. If it is about an order,
        adding the order number saves us both an email.
      </p>

      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
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
            hint="Optional — it looks like BS-1042-9F3A."
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
          hint="Ten characters or more. Photos can follow by email reply."
        >
          <textarea
            id="contact-message"
            name="message"
            required
            minLength={10}
            maxLength={2000}
            rows={6}
            placeholder="Tell us what you need — colours, quantities, dates, anything that helps."
            className="w-full rounded-xl border border-line2 bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </Field>

        {status === "error" && error ? (
          <Alert tone="error">{error}</Alert>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-4">
          <Button type="submit" size="lg" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send message"}
            <Icon name="arrow" size={18} />
          </Button>
          <span className="text-xs text-muted">
            We only use your details to answer you.
          </span>
        </div>
      </form>
    </div>
  );
}
