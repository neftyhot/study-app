"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { PrimerRun } from "@/lib/primer/runs";
import { useSkipLogistics } from "@/lib/skip-logistics-pref";

const STAGE_LABEL: Record<PrimerRun["stage"], string> = {
  explaining: "Reading the slides",
  filling_gaps: "Covering slides it skipped",
  organising: "Organising into topics",
  saving: "Saving",
};

export function WritePrimerButton({
  examId,
  depth,
  format = "explained",
  rewrite,
  href,
  withExamples: controlledExamples,
  onWithExamplesChange,
}: {
  examId: string;
  depth: string;
  format?: string;
  rewrite: boolean;
  /** Where the finished guide is shown; the page refreshes in place if omitted. */
  href?: string;
  /** Examples on or off, when the parent shows the choice elsewhere too. */
  withExamples?: boolean;
  onWithExamplesChange?: (next: boolean) => void;
}) {
  const router = useRouter();
  const [run, setRun] = useState<PrimerRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState(false);
  const [skipLogistics, setSkipLogistics] = useSkipLogistics();
  const [ownExamples, setOwnExamples] = useState(true);
  const withExamples = controlledExamples ?? ownExamples;
  const setWithExamples = onWithExamplesChange ?? setOwnExamples;
  const toggleId = `skip-logistics-${depth}-${format}-${rewrite ? "rewrite" : "write"}`;
  const examplesId = `examples-${depth}-${format}-${rewrite ? "rewrite" : "write"}`;

  const fetchRun = useCallback(async () => {
    const response = await fetch(`/api/exams/${examId}/primer?depth=${depth}&format=${format}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as { run?: PrimerRun | null };
    return payload.run ?? null;
  }, [examId, depth, format]);

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
        if (href) router.push(href);
        router.refresh();
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [watching, fetchRun, rewrite, router, href]);

  async function start() {
    setStarting(true);
    try {
      const response = await fetch(`/api/exams/${examId}/primer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ depth, format, skipLogistics, withExamples }),
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
    <div className="flex flex-col items-start gap-2">
      <Button variant={rewrite ? "outline" : "default"} disabled={starting} onClick={() => void start()}>
        {starting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {rewrite ? "Rewrite" : "Write study guide"}
      </Button>
      <div className="flex items-center gap-2">
        <Checkbox
          id={toggleId}
          checked={skipLogistics}
          disabled={starting}
          onCheckedChange={(value) => setSkipLogistics(value === true)}
        />
        <Label htmlFor={toggleId} className="text-muted-foreground text-xs font-normal">
          Ignore announcements and syllabus info
        </Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id={examplesId}
          checked={withExamples}
          disabled={starting}
          onCheckedChange={(value) => setWithExamples(value === true)}
        />
        <Label htmlFor={examplesId} className="text-muted-foreground text-xs font-normal">
          Write an example for every concept (you can still add one to any concept later)
        </Label>
      </div>
    </div>
  );
}
