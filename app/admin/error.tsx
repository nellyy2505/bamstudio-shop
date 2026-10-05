"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * A studio screen that throws (a failed action, an upload over the request
 * limit) lands here rather than on the framework's generic error page.
 */
export default function AdminError({
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
    <div className="flex flex-col items-start gap-3 py-10">
      <h1 className="font-display text-2xl font-bold">That didn&apos;t work</h1>
      <p className="max-w-lg text-muted">
        Nothing was saved from this attempt. If you were uploading photos, try fewer at once.
        {error.digest ? ` Reference: ${error.digest}.` : ""}
      </p>
      <Button onClick={() => reset()}>Try again</Button>
    </div>
  );
}
