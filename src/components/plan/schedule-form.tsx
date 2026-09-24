"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setExamSchedule } from "@/lib/actions";
import {
  EVERY_DAY,
  hasWeekday,
  normaliseStudyDays,
  toggleWeekday,
  WEEK_ORDER,
  WEEKDAY_LABELS,
} from "@/lib/plan/days";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * What the plan needs from the student: when the exam is and which days
 * they will study. How long each day takes is worked out from those.
 */
export function ScheduleForm({
  examId,
  date,
  studyDays,
}: {
  examId: string;
  date: string | null;
  studyDays: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [examDate, setExamDate] = useState(date ?? "");
  const [days, setDays] = useState(normaliseStudyDays(studyDays));

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="space-y-1.5">
        <Label htmlFor="exam-date" className="text-xs">
          <CalendarDays className="size-3.5" />
          Exam date
        </Label>
        <Input
          id="exam-date"
          type="date"
          className="sm:w-44"
          value={examDate}
          onChange={(event) => setExamDate(event.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Days I&apos;ll study</Label>
        <div className="flex gap-1" role="group" aria-label="Study days">
          {WEEK_ORDER.map((weekday) => {
            const on = hasWeekday(days, weekday);
            return (
              <Button
                key={weekday}
                type="button"
                size="sm"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                className={cn("w-11 px-0", !on && "text-muted-foreground")}
                onClick={() => {
                  const next = toggleWeekday(days, weekday);
                  // At least one day has to stay on.
                  if (next !== 0) setDays(next);
                }}
              >
                {WEEKDAY_LABELS[weekday]}
              </Button>
            );
          })}
        </div>
      </div>

      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setExamSchedule(examId, examDate || null, days || EVERY_DAY);
            toast.success("Plan updated");
            router.refresh();
          })
        }
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        Update plan
      </Button>
    </div>
  );
}
