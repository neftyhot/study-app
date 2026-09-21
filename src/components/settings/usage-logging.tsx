"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { setUsageLoggingAction } from "@/lib/settings-actions";

/**
 * The opt-in for usage statistics. Off until the student ticks it.
 *
 * Says exactly what is kept, because "anonymous usage data" on its own is
 * the sentence people have learned not to trust.
 */
export function UsageLoggingToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();

  function change(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await setUsageLoggingAction(next);
      if (!result.ok) {
        setEnabled(previous);
        toast.error("Could not save that setting.");
      }
    });
  }

  return (
    <div className="flex items-start gap-2">
      <Checkbox
        id="usage-logging"
        checked={enabled}
        disabled={pending}
        onCheckedChange={(value) => change(value === true)}
        className="mt-0.5"
      />
      <div className="space-y-0.5">
        <Label htmlFor="usage-logging" className="text-sm font-normal">
          Share usage statistics to help improve Study App
        </Label>
        <p className="text-muted-foreground text-xs">
          Records which features call a model, token counts, and estimated
          cost. Never your files, cards, questions, or answers. Off unless
          you turn it on; change it any time in Settings.
        </p>
      </div>
    </div>
  );
}
