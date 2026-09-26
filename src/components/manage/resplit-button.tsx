"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Scissors } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { resplitSourceFileAction } from "@/lib/manage/actions";

/**
 * Re-reads a transcript or notes file with the current section rules, so one
 * uploaded before long sections were split gets its fair share of cards.
 * Existing cards are kept and re-pointed at the section their quote is in.
 */
export function ResplitButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      title="Split long stretches of text into slide-sized sections"
      onClick={async () => {
        setBusy(true);
        const result = await resplitSourceFileAction(fileId);
        setBusy(false);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          result.after === result.before
            ? `Already split well — ${result.after} sections.`
            : `Now ${result.after} sections (was ${result.before}).${
                result.moved > 0 ? ` ${result.moved} cards re-pointed to their section.` : ""
              } Generate again to add cards for the new sections.`,
        );
        router.refresh();
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
      Split again
    </Button>
  );
}
