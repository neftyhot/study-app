"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ListChecks, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

type Phase = "mapping" | "review" | "conflicts";

export type CoverageJobView = {
  status: "running" | "done" | "failed";
  phases: Partial<Record<Phase, { done: number; total: number }>>;
  checkConflicts: boolean;
  startedAt: number;
  percent: number;
  summary: Summary | null;
  error: string | null;
};

const PHASE_LABELS: Record<Phase, string> = {
  mapping: "Matching cards to objectives",
  review: "Checking gaps against your slides",
  conflicts: "Comparing files for contradictions",
};

type Summary = {
  objectives: number;
  covered: number;
  partiallyCovered: number;
  missing: number;
  fixableGaps: number;
  sourceGaps: number;
  cardsMapped: number;
  unresolvedReferences: number;
  unverifiedCitations: number;
  conflicts: number;
  conflictPairsChecked: number;
  durationMs?: number;
};

export function CoveragePanel({
  examId,
  objectiveCount,
  cardCount,
  fileCount,
  initialJob = null,
}: {
  examId: string;
  objectiveCount: number;
  cardCount: number;
  fileCount: number;
  /** A check already in flight, so coming back to the page resumes the bar. */
  initialJob?: CoverageJobView | null;
}) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  // Only meaningful with two or more files to compare.
  const [checkConflicts, setCheckConflicts] = useState(fileCount > 1);
  const [job, setJob] = useState<CoverageJobView | null>(initialJob);
  const summary = job?.status === "done" ? job.summary : null;
  const running = job?.status === "running";
  const busy = starting || running;

  // Poll the check on the server while it runs; it carries on if the page
  // is left, and picks up here when the page comes back.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/exams/${examId}/coverage`);
        const payload = (await response.json()) as { job: CoverageJobView | null };
        if (cancelled || !payload.job) return;
        setJob(payload.job);

        if (payload.job.status === "done" && payload.job.summary) {
          toast.success(
            `${payload.job.summary.covered}/${payload.job.summary.objectives} objectives fully covered`,
          );
          router.refresh();
        } else if (payload.job.status === "failed") {
          toast.error(payload.job.error ?? "Coverage analysis failed");
        }
      } catch {
        // A dropped poll is not a failure; the next one catches up.
      }
    };

    const timer = setInterval(() => void tick(), 700);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, examId, router]);

  async function analyze() {
    setStarting(true);
    try {
      const query = checkConflicts && fileCount > 1 ? "" : "?conflicts=false";
      const response = await fetch(
        `/api/exams/${examId}/coverage${query}`,
        { method: "POST" },
      );
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Coverage analysis failed");
        return;
      }
      setJob(payload.job);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setStarting(false);
    }
  }

  const blocked = objectiveCount === 0 || cardCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Analyze coverage</CardTitle>
        <CardDescription>
          Maps your cards onto each study-guide objective, then re-checks every
          gap against the slides themselves to tell a missing card apart from
          missing source material.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button onClick={() => void analyze()} disabled={busy || blocked}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ListChecks className="size-4" />
            )}
            {busy ? "Analyzing…" : "Run coverage analysis"}
          </Button>

          <div className="flex items-center gap-2">
            <Checkbox
              id="conflicts"
              checked={checkConflicts}
              disabled={busy || fileCount < 2}
              onCheckedChange={(value) => setCheckConflicts(value === true)}
            />
            <Label
              htmlFor="conflicts"
              className="text-muted-foreground text-sm font-normal"
            >
              Also check files against each other for contradictions
            </Label>
          </div>
        </div>

        {blocked ? (
          <p className="text-muted-foreground text-sm">
            {objectiveCount === 0
              ? "Upload a study guide first — the matrix is built from its objectives."
              : "Generate flashcards first; there is nothing to map yet."}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {objectiveCount} objectives × {cardCount} cards
            {fileCount < 2
              ? " · conflict detection needs two or more source files"
              : null}
          </p>
        )}

        {running && job ? <CoverageProgress job={job} /> : null}

        {job?.status === "failed" ? (
          <p className="text-destructive text-sm">{job.error}</p>
        ) : null}

        {summary ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>
              <strong>{summary.covered}</strong> fully covered,{" "}
              {summary.partiallyCovered} partial, {summary.missing} missing
              across {summary.objectives} objectives
              {summary.durationMs
                ? `, checked in ${Math.round(summary.durationMs / 1000)}s`
                : ""}
              .
            </p>
            {summary.sourceGaps > 0 ? (
              <p className="text-muted-foreground">
                {summary.sourceGaps} gap(s) your uploaded files do not answer at
                all — more cards will not fix those.
              </p>
            ) : null}
            {summary.conflicts > 0 ? (
              <p className="text-muted-foreground">
                {summary.conflicts} contradiction(s) found across{" "}
                {summary.conflictPairsChecked} compared slide pair(s).
              </p>
            ) : null}
            {summary.unverifiedCitations > 0 ? (
              <p className="text-muted-foreground text-xs">
                {summary.unverifiedCitations} supporting quote(s) were not
                actually in the slide cited and were discarded.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CoverageProgress({ job }: { job: CoverageJobView }) {
  const order: Phase[] = job.checkConflicts
    ? ["mapping", "review", "conflicts"]
    : ["mapping", "review"];

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          Checking coverage…
        </span>
        <span className="text-muted-foreground tabular-nums">{job.percent}%</span>
      </div>
      <Progress value={job.percent} />
      <ul className="text-muted-foreground space-y-0.5 text-xs">
        {order.map((phase) => {
          const state = job.phases[phase];
          const finished = state && state.total > 0 && state.done >= state.total;
          return (
            <li key={phase} className={finished ? "text-foreground" : undefined}>
              {finished ? "✓ " : state ? "… " : "○ "}
              {PHASE_LABELS[phase]}
              {state && state.total > 0 ? ` — ${state.done} of ${state.total}` : ""}
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-xs">
        Runs in the background — you can leave this page and come back.
      </p>
    </div>
  );
}
