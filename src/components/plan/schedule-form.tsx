"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setExamSchedule } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The two numbers the plan rests on.
 *
 * Both optional: without a date there is no deadline to plan against, and the
 * planner says so rather than inventing one.
 */
export function ScheduleForm({
  examId,
  date,
  dailyMinutes,
}: {
  examId: string;
  date: string | null;
  dailyMinutes: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [examDate, setExamDate] = useState(date ?? "");
  const [minutes, setMinutes] = useState(String(dailyMinutes ?? 30));

  return (
    <div className="flex flex-wrap items-end gap-3">
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
        <Label htmlFor="daily-minutes" className="text-xs">
          Minutes a day
        </Label>
        <Input
          id="daily-minutes"
          type="number"
          min={5}
          max={600}
          step={5}
          className="sm:w-32"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
      </div>

      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await setExamSchedule(
              examId,
              examDate || null,
              minutes ? Number(minutes) : null,
            );
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
