"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { deleteExamAction, examImpact } from "@/lib/manage/actions";

/** Delete a deck straight from the dashboard, after saying what goes with it. */
export function DeleteDeckButton({ examId, examTitle }: { examId: string; examTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    setOpen(true);
  }

  return (
    <>
      <Hint label="Delete deck">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${examTitle}`}
          className="text-muted-foreground hover:text-destructive"
          onClick={() => void openDelete()}
        >
          <Trash2 className="size-4" />
        </Button>
      </Hint>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${examTitle}?`}
        description="The whole deck goes, including its uploaded files."
        impact={impact}
        confirmLabel="Delete deck"
        onConfirm={async () => {
          await deleteExamAction(examId);
          toast.success(`Deleted ${examTitle}`);
          router.refresh();
        }}
      />
    </>
  );
}
