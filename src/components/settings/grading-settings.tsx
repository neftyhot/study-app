"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  STRICTNESS_LABELS,
  STRICTNESS_LEVELS,
  type Strictness,
} from "@/lib/grade/strictness";
import { setGradingStrictness } from "@/lib/settings-actions";

export function GradingSettings({ initial }: { initial: Strictness }) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function choose(next: Strictness) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setGradingStrictness(next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Typed-answer grading</CardTitle>
        <CardDescription>
          How hard written answers are marked in Learn and in practice exams.
          A reversed direction or a wrong mechanism is always wrong, whatever
          this is set to.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {STRICTNESS_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={value === level}
              disabled={pending}
              onClick={() => choose(level)}
              className={`rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                value === level ? "border-primary bg-primary/5" : "hover:bg-muted/60"
              }`}
            >
              <span className="block text-sm font-medium">
                {STRICTNESS_LABELS[level].label}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {STRICTNESS_LABELS[level].blurb}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
