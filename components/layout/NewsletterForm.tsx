"use client";

import { useState } from "react";
import { Icon } from "@/components/ui";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
    "idle",
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "done" : "error");
      if (res.ok) setEmail("");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-[#38332D] px-4 py-3 text-[13.5px] font-semibold text-[#D8D2C6]">
        <Icon name="check" size={16} />
        You&apos;re on the list — see you at the next drop.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
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
        {state === "sending" ? "…" : "Join"}
      </button>
      {state === "error" ? (
        <span role="alert" className="sr-only">
          Something went wrong. Please try again.
        </span>
      ) : null}
    </form>
  );
}
