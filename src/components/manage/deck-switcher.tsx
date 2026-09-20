"use client";

import { useRouter } from "next/navigation";
import { Library } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SwitcherCourse = {
  id: string;
  title: string;
  exams: { id: string; title: string }[];
};

/**
 * Jumps between decks from anywhere, grouped by subject.
 *
 * Grouped rather than flat because two subjects routinely both have an
 * "Exam 2", and a list of identical names is not a switcher.
 */
export function DeckSwitcher({
  courses,
  currentExamId,
}: {
  courses: SwitcherCourse[];
  currentExamId?: string;
}) {
  const router = useRouter();
  const decks = courses.filter((course) => course.exams.length > 0);

  if (decks.length === 0) return null;

  return (
    <Select
      value={currentExamId ?? ""}
      onValueChange={(examId) => router.push(`/exams/${examId}`)}
    >
      <SelectTrigger className="w-44 sm:w-56" aria-label="Switch deck">
        <Library className="size-3.5 shrink-0" />
        <SelectValue placeholder="Switch deck" />
      </SelectTrigger>
      <SelectContent>
        {decks.map((course) => (
          <SelectGroup key={course.id}>
            <SelectLabel>{course.title}</SelectLabel>
            {course.exams.map((exam) => (
              <SelectItem key={exam.id} value={exam.id}>
                {exam.title}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
