"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { deleteStatisticsAction } from "@/lib/app-actions";

/** Erases the server's copy of this install's statistics and starts a new install id. */
export function DeleteStatistics() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function erase() {
    if (
      !window.confirm(
        "Delete the usage statistics the developer holds for this install? Your study material isn't affected. The app starts a new install id and keeps sending statistics from here on.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { ok } = await deleteStatisticsAction();
      if (ok) {
        toast.success("Your statistics were deleted from the server.");
        router.refresh();
      } else {
        toast.error("Couldn't reach the server. Check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => void erase()}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      Delete my statistics from the server
    </Button>
  );
}
