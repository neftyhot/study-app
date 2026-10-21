"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acknowledgeLecturesBetaAction } from "@/lib/lectures/actions";

/**
 * Shown the first time someone opens Lectures. Recording is still in Beta,
 * and recording other people has rules the app can't check for them.
 */
export function LecturesBetaNotice({ acknowledged }: { acknowledged: boolean }) {
  const [open, setOpen] = useState(!acknowledged);
  const [pending, startTransition] = useTransition();

  const accept = () =>
    startTransition(async () => {
      // Closing is enough for this visit; a failed save just asks again next time.
      await acknowledgeLecturesBetaAction().catch(() => undefined);
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : accept())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lectures is in Beta</DialogTitle>
          <DialogDescription>
            Transcripts are made on this computer and can miss words, mishear names, or get timestamps
            slightly off. Check anything important against your notes.
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Ask before you record. Some schools, professors, and states require permission from everyone
          being recorded, and that&apos;s up to you to get.
        </p>
        <DialogFooter>
          <Button onClick={accept} disabled={pending}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
