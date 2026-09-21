"use client";

/**
 * Making a drill from a page you are already looking at.
 *
 * The picture is rendered on demand by the route behind the `<img>`, which is
 * why this is a dialog rather than something the sources page pays for on
 * every load: a deck has hundreds of pages and a handful of diagrams.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SquareDashedMousePointer } from "lucide-react";

import { OcclusionEditor } from "@/components/diagrams/occlusion-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CreateDrillDialog({
  examId,
  slideId,
  title,
  unitLabel,
  existingDrills,
}: {
  examId: string;
  slideId: string;
  title: string | null;
  /** "Page 35", as the student's own file numbers it. */
  unitLabel: string;
  existingDrills: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SquareDashedMousePointer className="size-4" />
          {existingDrills > 0 ? "Add another drill" : "Create diagram drill"}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {unitLabel}
            {title ? ` — ${title}` : ""}
          </DialogTitle>
          <DialogDescription>
            Cover each label you want to recall. The drill becomes a card in
            this deck, scheduled like every other one.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <OcclusionEditor
            examId={examId}
            slideId={slideId}
            topic={title}
            imageUrl={`/api/slides/${slideId}/image`}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
