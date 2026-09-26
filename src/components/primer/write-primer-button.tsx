"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { PrimerRun } from "@/lib/primer/runs";

const STAGE_LABEL: Record<PrimerRun["stage"], string> = {
  explaining: "Reading the slides",
  filling_gaps: "Covering slides it skipped",
  organising: "Organising into topics",
  saving: "Saving",
};

export function WritePrimerButton({
  examId,
  depth,
  rewrite,
}: {
  examId: string;
  depth: string;
  rewrite: boolean;
}) {
  const router = useRouter();
  const [run, setRun] = useState<PrimerRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState(false);

  const fetchRun = useCallback(async () => {
    const response = await fetch(`/api/exams/${examId}/primer?depth=${depth}`, { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as { run?: PrimerRun | null };
    return payload.run ?? null;
  }, [examId, depth]);

  // Pick up a run already going, e.g. after navigating away and back.
  useEffect(() => {
    let cancelled = false;
    void fetchRun().then((latest) => {
      if (cancelled || !latest?.running) return;
      setRun(latest);
      setWatching(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchRun]);

  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(async () => {
      const latest = await fetchRun();
      setRun(latest);
      if (latest?.running) return;
      clearInterval(timer);
      setWatching(false);
      if (latest?.error) toast.error(latest.error);
      else {
        toast.success(rewrite ? "Study guide rewritten." : "Study guide ready.");
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [watching, fetchRun, rewrite, router]);

  async function start() {
    setStarting(true);
    try {
      const response = await fetch(`/api/exams/${examId}/primer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depth }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 409) {
        toast.error(payload.error ?? "Couldn't start the study guide.");
        return;
      }
      setRun(payload.run ?? (await fetchRun()));
      setWatching(true);
    } finally {
      setStarting(false);
    }
  }

  const running = Boolean(run?.running);
  if (running && run) {
    const percent = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <div className="w-full space-y-1.5 sm:w-72" aria-live="polite">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {STAGE_LABEL[run.stage]}
          {run.stage === "explaining" || run.stage === "filling_gaps"
            ? ` (${run.done}/${run.total})`
            : "…"}
        </p>
        <Progress value={percent} />
      </div>
    );
  }

  return (
    <Button variant={rewrite ? "outline" : "default"} disabled={starting} onClick={() => void start()}>
      {starting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {rewrite ? "Rewrite" : "Write study guide"}
    </Button>
  );
}
