"use client";

import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * A confirmation that says what will actually happen.
 *
 * "Are you sure?" is not a safeguard — the student cannot be sure without
 * knowing the cost, so `impact` lists it line by line and the dialog is opened
 * only after that cost has been fetched.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impact?: string[];
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {impact && impact.length > 0 ? (
          <ul className="bg-muted/50 list-disc rounded p-3 pl-7 text-sm">
            {impact.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}

        <p className="text-muted-foreground text-xs">
          This cannot be undone.
        </p>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
