"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await createClient().auth.signOut();
    } catch {
      // Session already gone or Supabase unreachable — still leave /account.
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="soft"
      size="sm"
      full
      onClick={signOut}
      disabled={busy}
    >
      <Icon name="back" size={16} />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
