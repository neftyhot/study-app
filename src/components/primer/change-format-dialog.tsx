"use client";

import { Shuffle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { PrimerDepth, PrimerFormat } from "@/db/schema";

import { PrimerGenerator } from "./primer-generator";

/**
 * Rewriting a finished guide in another format or length, from the top of the
 * guide. The new version is saved beside the old one (both stay in the list);
 * picking the same format and length rewrites that one in place.
 *
 * The page keys this on the version shown, so it closes once the new one opens.
 */
export function ChangeFormatDialog({
  examId,
  depth,
  format,
  written,
}: {
  examId: string;
  depth: PrimerDepth;
  format: PrimerFormat;
  written: string[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Shuffle className="size-4" />
          Change format
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Rewrite in a different format</DialogTitle>
          <DialogDescription>
            Pick a new format or length and write it again from your slides. This version stays
            too, so you can switch between them above the guide.
          </DialogDescription>
        </DialogHeader>
        <PrimerGenerator examId={examId} initialDepth={depth} initialFormat={format} written={written} />
      </DialogContent>
    </Dialog>
  );
}
