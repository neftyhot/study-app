"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteSourceFileAction, sourceFileImpact } from "@/lib/manage/actions";
import { plural } from "@/lib/plural";

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
            `${plural(summary.units, "extracted section")} from this file`,
            `${plural(summary.cardsDeleted, "generated card")} that cite it`,
            ...(summary.cardsKept > 0
              ? [
                  `${plural(summary.cardsKept, "card")} you edited will be KEPT, marked as having lost their source`,
                ]
              : []),
            ...(summary.objectivesDeleted > 0
              ? [`${plural(summary.objectivesDeleted, "study-guide topic")}`]
              : []),
            ...(summary.objectivesKept > 0
              ? [`${plural(summary.objectivesKept, "flagged topic")} will be KEPT`]
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
              ? `Deleted ${filename} and ${plural(result.cardsDeleted, "card")}`
              : `Deleted ${filename}`,
          );
          router.refresh();
        }}
      />
    </>
  );
}
