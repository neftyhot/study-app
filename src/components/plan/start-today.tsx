"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { beginStudySession } from "@/lib/study/actions";

/**
 * Starts the session the plan just described.
 *
 * Without this the plan is a set of numbers a student has to reproduce by
 * hand in a picker — and one they could easily reproduce differently. The
 * session is built from the same rules, capped to the same budget.
 */
export function StartToday({
  examId,
  due,
  label = "Start today's reviews",
}: {
  examId: string;
  due: number;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (due === 0) return null;

  return (
    <Button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const session = await beginStudySession(examId, { scope: "due" });
        setBusy(false);

        if (session.cardOrder.length === 0) {
          toast.error("Nothing is due right now");
          return;
        }

        router.push(`/exams/${examId}/study`);
      }}
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      {label}
    </Button>
  );
}
