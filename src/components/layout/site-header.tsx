import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DeckSwitcher } from "@/components/manage/deck-switcher";
import { listCoursesWithExams } from "@/lib/queries";

export async function SiteHeader() {
  const courses = await listCoursesWithExams();

  return (
    <header className="border-b sticky top-0 z-40 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <GraduationCap className="size-5" />
          <span className="hidden sm:inline">Study App</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <DeckSwitcher
            courses={courses.map((course) => ({
              id: course.id,
              title: course.title,
              exams: course.exams.map((exam) => ({
                id: exam.id,
                title: exam.title,
              })),
            }))}
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
