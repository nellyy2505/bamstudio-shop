"use client";

import { Button, Icon } from "@/components/ui";

/**
 * Opens the browser's print dialog.
 *
 * A client component for one reason: `window.print()`. Everything else on the
 * packing slip and the pick list is server-rendered, and both pages work
 * without this button — Ctrl+P prints exactly the same thing, which is what
 * makes it safe for the button to be missing if JavaScript has not loaded.
 *
 * It carries `no-print` like every other control, so it does not appear on the
 * paper it produces.
 */
export function PrintButton({ children = "Print this" }: { children?: React.ReactNode }) {
  return (
    <Button
      type="button"
      size="md"
      className="no-print"
      onClick={() => window.print()}
    >
      <Icon name="doc" size={18} />
      {children}
    </Button>
  );
}
