"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  FileDown,
  FolderOpen,
  ListChecks,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { ExportDialog } from "@/components/manage/export-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import {
  deleteExamAction,
  examImpact,
  resetProgressAction,
} from "@/lib/manage/actions";

/**
 * The ••• menu on a deck: everything a student reaches for occasionally —
 * exporting, managing files, the study-guide check, starting over — kept out
 * of the way of Study guide → Flashcards → Practice exam.
 */
export function DeckActionsMenu({
  examId,
  examTitle,
  cardCount,
  hasStudyGuide,
  hasDate,
}: {
  examId: string;
  examTitle: string;
  cardCount: number;
  hasStudyGuide: boolean;
  hasDate: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"delete" | "reset" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [impact, setImpact] = useState<string[]>([]);

  async function openDelete() {
    const summary = await examImpact(examId);
    setImpact(
      summary
        ? [
            `${summary.sourceFiles} source file(s) and everything extracted from them`,
            `${summary.flashcards} flashcard(s), including any you edited`,
            `${summary.objectives} study-guide topic(s) and the study-guide check`,
            `${summary.sessions} study session(s) and all review history`,
          ]
        : [],
    );
    setConfirm("delete");
  }

  return (
    <>
      <DropdownMenu>
        <Hint label="More actions: export, files, reset">
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>This deck</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link href={`/exams/${examId}/sources`}>
              <FolderOpen />
              Your files
            </Link>
          </DropdownMenuItem>
          {hasStudyGuide ? (
            <DropdownMenuItem asChild>
              <Link href={`/exams/${examId}/coverage`}>
                <ListChecks />
                Check my study guide
              </Link>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={`/exams/${examId}/plan`}>
              <CalendarDays />
              {hasDate ? "Study plan" : "Set an exam date"}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={cardCount === 0}
            onSelect={() => setExporting(true)}
          >
            <FileDown />
            Export (Anki, Quizlet, CSV…)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setConfirm("reset")}>
            <RotateCcw />
            Reset study progress
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => void openDelete()}
          >
            <Trash2 />
            Delete deck
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ExportDialog
        examId={examId}
        cardCount={cardCount}
        open={exporting}
        onOpenChange={setExporting}
      />

      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(open) => setConfirm(open ? "reset" : null)}
        title="Reset study progress?"
        description={`Clears review history and the review schedule for ${examTitle}.`}
        impact={[
          "Every card, rubric, edit and star is kept",
          "Your study-guide check is kept",
          "Review history, progress levels and due dates are cleared",
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
