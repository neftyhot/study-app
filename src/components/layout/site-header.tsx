import Link from "next/link";
import { GraduationCap, Search, Settings } from "lucide-react";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { DeckSwitcher } from "@/components/manage/deck-switcher";
import { DownloadChip } from "@/components/settings/download-chip";
import { db } from "@/db";
import { LOCAL_MODELS } from "@/lib/llm/catalog";
import { listCoursesWithExams } from "@/lib/queries";
import { readDownload } from "@/lib/settings";

export async function SiteHeader() {
  const courses = await listCoursesWithExams();
  const download = readDownload(db);

  return (
    <header className="border-b sticky top-0 z-40 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <GraduationCap className="size-5" />
          <span className="hidden sm:inline">Study App</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" aria-label="Search everything">
            <Link href="/search">
              <Search className="size-4" />
            </Link>
          </Button>
          <DownloadChip initial={download} models={LOCAL_MODELS} />
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
          <Button asChild variant="ghost" size="icon" aria-label="Settings">
            <Link href="/settings">
              <Settings className="size-4" />
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
