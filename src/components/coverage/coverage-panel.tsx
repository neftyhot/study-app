"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
};

export function CoveragePanel({
  examId,
  objectiveCount,
  cardCount,
  fileCount,
}: {
  examId: string;
  objectiveCount: number;
  cardCount: number;
  fileCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Only meaningful with two or more files to compare.
  const [checkConflicts, setCheckConflicts] = useState(fileCount > 1);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function analyze() {
    setBusy(true);
    setSummary(null);

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

      setSummary(payload);
      toast.success(
        `${payload.covered}/${payload.objectives} objectives fully covered`,
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Analysis failed");
    } finally {
      setBusy(false);
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

        {summary ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <p>
              <strong>{summary.covered}</strong> fully covered,{" "}
              {summary.partiallyCovered} partial, {summary.missing} missing
              across {summary.objectives} objectives.
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
