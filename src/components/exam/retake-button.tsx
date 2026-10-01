"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startPaper } from "@/lib/exam/actions";
import { toast } from "@/lib/notify";

/**
 * Sets a new paper from just the questions missed on the last one, reworded
 * and with fresh options, so the retake tests the fact rather than the memory
 * of last time's wording.
 */
export function RetakeButton({
  examId,
  cardIds,
  strictness,
}: {
  examId: string;
  cardIds: string[];
  strictness?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleRetake() {
    setBusy(true);
    const result = await startPaper(examId, {
      questionCount: cardIds.length,
      durationMinutes: null,
      sources: [],
      ranges: {},
      topics: [],
      rephrase: true,
      strictness,
      cardIds,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.set < result.askedFor) {
      toast.info(
        `Set ${result.set} of ${result.askedFor} — the rest have been deleted or excluded since.`,
      );
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    router.refresh();
  }

  return (
    <Button onClick={handleRetake} disabled={busy || cardIds.length === 0}>
      {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      Retake the {cardIds.length === 1 ? "one" : cardIds.length} I missed
    </Button>
  );
}
