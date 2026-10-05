"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui";

/** Shown when a shop page fails to render, instead of the framework's blank error. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="wrap flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="font-display text-3xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-muted">
        Sorry, this page didn&apos;t load. Please try again in a moment.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <ButtonLink href="/" variant="ghost">
          Go home
        </ButtonLink>
      </div>
    </div>
  );
}
