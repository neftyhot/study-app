"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteExamAction,
  examImpact,
  resetProgressAction,
} from "@/lib/manage/actions";

export function ExamSettings({
  examId,
  examTitle,
}: {
  examId: string;
  examTitle: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);
  const [impact, setImpact] = useState<string[]>([]);

  async function openDelete() {
    const summary = await examImpact(examId);
    setImpact(
      summary
        ? [
            `${summary.sourceFiles} source file(s) and everything extracted from them`,
            `${summary.flashcards} flashcard(s), including any you edited`,
            `${summary.objectives} study-guide objective(s) and the coverage matrix`,
            `${summary.sessions} study session(s) and all review history`,
          ]
        : [],
    );
    setConfirm("delete");
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deck settings</CardTitle>
          <CardDescription>
            Export a full JSON backup — sources, cards, coverage, and review
            history. Starting the material over and getting rid of it are
            different things, so they are different buttons.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            {/* A plain link: the browser downloads it, no blob juggling. */}
            <a href={`/api/exams/${examId}/export`} download>
              <Download className="size-4" />
              Export backup
            </a>
          </Button>
          <Button variant="outline" onClick={() => setConfirm("reset")}>
            <RotateCcw className="size-4" />
            Reset study progress
          </Button>
          <Button variant="outline" onClick={() => void openDelete()}>
            <Trash2 className="size-4" />
            Delete deck
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(open) => setConfirm(open ? "reset" : null)}
        title="Reset study progress?"
        description={`Clears review history and the review schedule for ${examTitle}.`}
        impact={[
          "Every card, rubric, edit and star is kept",
          "The coverage matrix is kept",
          "Review history, mastery tiers and due dates are cleared",
        ]}
        confirmLabel="Reset progress"
        onConfirm={async () => {
          const result = await resetProgressAction(examId);
          toast.success(
            `Cleared ${result.progressCleared} card record(s) and ${result.sessionsCleared} session(s)`,
          );
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => setConfirm(open ? "delete" : null)}
        title={`Delete ${examTitle}?`}
        description="The whole deck goes, including its uploaded files."
        impact={impact}
        confirmLabel="Delete deck"
        onConfirm={async () => {
          await deleteExamAction(examId);
          toast.success(`Deleted ${examTitle}`);
          router.push("/");
        }}
      />
    </>
  );
}
