"use client";

/**
 * Cards from photos of handwritten or printed notes.
 *
 * Three steps, in order, so nothing leaves the machine by surprise: pick the
 * photos, see which model would read them and roughly what that costs, tick
 * the box. Photos are shrunk in the window first, which cuts both the upload
 * and the tokens without making handwriting harder to read.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/notify";
import { scanPlanAction, type ScanPlan } from "@/lib/scan/actions";

const MAX_IMAGES = 10;
const MAX_EDGE = 1600;

/** Shrinks a photo to at most MAX_EDGE on its long side, as JPEG. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("shrink"))), "image/jpeg", 0.85),
  );
}

export function ScanNotesDialog({ examId }: { examId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [plan, setPlan] = useState<ScanPlan | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (files.length === 0) return;
    let live = true;
    scanPlanAction(files.length).then(
      (next) => live && setPlan(next),
      () => live && setPlan({ ok: false, error: "Couldn't work out the cost. Try again." }),
    );
    return () => {
      live = false;
    };
  }, [files.length]);

  function reset() {
    setFiles([]);
    setPlan(null);
    setAgreed(false);
  }

  function choose(list: FileList | null) {
    const picked = Array.from(list ?? []).filter((file) => file.type.startsWith("image/"));
    if (picked.length > MAX_IMAGES) toast.info(`Using the first ${MAX_IMAGES} photos.`);
    setPlan(null);
    setAgreed(false);
    setFiles(picked.slice(0, MAX_IMAGES));
  }

  async function scan() {
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) {
        const blob = await shrink(file).catch(() => file);
        form.append("images", blob, file.name.replace(/\.[^.]+$/, "") + ".jpg");
      }
      const response = await fetch(`/api/exams/${examId}/scan`, { method: "POST", body: form });
      const result = (await response.json()) as {
        added?: number;
        failed?: { name: string; error: string }[];
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Scanning failed.");
      const failed = result.failed ?? [];
      if (result.added) {
        toast.success(`Added ${result.added} card${result.added === 1 ? "" : "s"} from your notes.`, {
          description: "They're marked “from a scan”. Check them against your notes.",
        });
      }
      if (failed.length) {
        toast.error(
          failed.length === files.length ? failed[0].error : `${failed.length} photo${failed.length === 1 ? "" : "s"} couldn't be read.`,
        );
      }
      if (result.added) {
        setOpen(false);
        reset();
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scanning failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Camera className="size-4" />
          Scan notes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make cards from photos of your notes</DialogTitle>
          <DialogDescription>
            Your AI model reads each photo and writes cards from it. Nothing is
            sent until you agree below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="scan-photos">Photos (up to {MAX_IMAGES})</Label>
            <input
              id="scan-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy}
              onChange={(event) => choose(event.target.files)}
              className="text-muted-foreground file:bg-secondary file:text-secondary-foreground block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>

          {files.length > 0 && !plan ? (
            <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
              Working out the cost…
            </p>
          ) : null}

          {plan && !plan.ok ? (
            <p className="text-destructive text-sm" role="alert">{plan.error}</p>
          ) : null}

          {plan?.ok ? (
            <div className="bg-muted/50 space-y-3 rounded-lg border p-3 text-sm">
              <p>
                {files.length} photo{files.length === 1 ? "" : "s"} →{" "}
                {plan.estimate.calls} call{plan.estimate.calls === 1 ? "" : "s"} to{" "}
                <span className="font-medium">{plan.model}</span>. Estimated cost:{" "}
                <span className="font-medium">
                  {plan.estimate.cost === null ? "unknown for this model" : `under ${plan.estimate.costLabel}`}
                </span>
                .
              </p>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="scan-agree"
                  checked={agreed}
                  onCheckedChange={(value) => setAgreed(value === true)}
                  disabled={busy}
                />
                <Label htmlFor="scan-agree" className="leading-snug font-normal">
                  Send these photos to {plan.provider} to read them. Only use
                  photos of your own notes.
                </Label>
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button onClick={scan} disabled={!plan?.ok || !agreed || busy || files.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Camera className="size-4" />}
            {busy ? "Reading your notes…" : "Make cards"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
