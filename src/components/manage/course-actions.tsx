"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/manage/confirm-dialog";
import { Button } from "@/components/ui/button";
import { deleteCourseAction } from "@/lib/manage/actions";

export function CourseActions({
  courseId,
  title,
  examCount,
}: {
  courseId: string;
  title: string;
  examCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Delete ${title}`}
      >
        <Trash2 className="size-3.5" />
        Delete subject
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${title}?`}
        description="The subject and every deck inside it go together."
        impact={[
          `${examCount} deck(s), with their sources, cards and review history`,
          "Every uploaded file for those decks",
        ]}
        confirmLabel="Delete subject"
        onConfirm={async () => {
          const removed = await deleteCourseAction(courseId);
          toast.success(`Deleted ${title} and ${removed} deck(s)`);
          router.refresh();
        }}
      />
    </>
  );
}
