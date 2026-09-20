"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteSourceFileAction, sourceFileImpact } from "@/lib/manage/actions";

export function SourceFileActions({
  examId,
  fileId,
  filename,
}: {
  examId: string;
  fileId: string;
  filename: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<string[]>([]);

  async function openConfirm() {
    const summary = await sourceFileImpact(fileId);
    setImpact(
      summary
        ? [
            `${summary.units} extracted section(s) from this file`,
            `${summary.cardsDeleted} generated card(s) that cite it`,
            ...(summary.cardsKept > 0
              ? [
                  `${summary.cardsKept} card(s) you edited will be KEPT, marked as having lost their source`,
                ]
              : []),
            ...(summary.objectivesDeleted > 0
              ? [`${summary.objectivesDeleted} study-guide objective(s)`]
              : []),
            ...(summary.objectivesKept > 0
              ? [`${summary.objectivesKept} flagged objective(s) will be KEPT`]
              : []),
          ]
        : [],
    );
    setOpen(true);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void openConfirm()}
        aria-label={`Delete ${filename}`}
      >
        <Trash2 className="size-3.5" />
        Delete
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${filename}?`}
        description="Cards generated from this file cannot be verified without it, so they go with it. Cards you edited are yours, and are kept."
        impact={impact}
        confirmLabel="Delete file"
        onConfirm={async () => {
          const result = await deleteSourceFileAction(examId, fileId);
          toast.success(
            result
              ? `Deleted ${filename} and ${result.cardsDeleted} card(s)`
              : `Deleted ${filename}`,
          );
          router.refresh();
        }}
      />
    </>
  );
}
