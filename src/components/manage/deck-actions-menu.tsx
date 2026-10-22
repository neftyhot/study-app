"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  FileDown,
  FolderOpen,
  CopyMinus,
  ListChecks,
  MoreHorizontal,
  RotateCcw,
  Share2,
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
  removeRepeatsAction,
  resetProgressAction,
} from "@/lib/manage/actions";
import { plural } from "@/lib/plural";

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
  const [confirm, setConfirm] = useState<"delete" | "reset" | "repeats" | null>(null);
  const [exporting, setExporting] = useState(false);
  const [impact, setImpact] = useState<string[]>([]);

  async function openDelete() {
    const summary = await examImpact(examId);
    setImpact(
      summary
        ? [
            `${plural(summary.sourceFiles, "source file")} and everything extracted from them`,
            `${plural(summary.flashcards, "flashcard")}, including any you edited`,
            `${plural(summary.objectives, "study-guide topic")} and the study-guide check`,
            `${plural(summary.sessions, "study session")} and all review history`,
          ]
        : [],
    );
    setConfirm("delete");
  }

  return (
    <>
      <DropdownMenu>
        <Hint label="Maintenance: files, share, export, repeats, reset">
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
          {/* Both open the same dialog; it starts on the .meganstudy file. */}
          <DropdownMenuItem
            disabled={cardCount === 0}
            onSelect={() => setExporting(true)}
          >
            <Share2 />
            Share deck (.meganstudy file)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={cardCount === 0}
            onSelect={() => setExporting(true)}
          >
            <FileDown />
            Export (Anki, Quizlet, CSV…)
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={cardCount < 2}
            onSelect={() => setConfirm("repeats")}
          >
            <CopyMinus />
            Remove repeated cards
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
        open={confirm === "repeats"}
        onOpenChange={(open) => setConfirm(open ? "repeats" : null)}
        title="Remove repeated cards?"
        description={`Finds cards in ${examTitle} that ask the same thing, and keeps the one that says the most.`}
        impact={[
          "Word-for-word copies and rewordings are removed",
          "A card that another card already covers, with more detail, is removed",
          "Stars and review history move to the card that is kept",
          "Cards you edited are never removed",
        ]}
        confirmLabel="Remove repeats"
        onConfirm={async () => {
          const result = await removeRepeatsAction(examId);
          if (result.removed === 0) {
            toast.success("No repeated cards found");
          } else {
            toast.success(
              `Removed ${result.removed} repeated card${result.removed === 1 ? "" : "s"}`,
            );
          }
          router.refresh();
        }}
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
            `Cleared ${plural(result.progressCleared, "card record")} and ${plural(result.sessionsCleared, "session")}`,
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
