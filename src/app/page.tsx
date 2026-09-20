import Link from "next/link";
import { CalendarDays, FileStack, Layers, ListChecks } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CourseActions } from "@/components/manage/course-actions";
import {
  CreateCourseDialog,
  CreateExamDialog,
} from "@/components/manage/create-dialogs";
import { listCoursesWithExams } from "@/lib/queries";

export default async function DashboardPage() {
  const courses = await listCoursesWithExams();
  const courseOptions = courses.map((course) => ({
    id: course.id,
    title: course.title,
  }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Subjects</h1>
          <p className="text-muted-foreground text-sm">
            Upload slides and a study guide, then generate sourced flashcards.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <CreateExamDialog courses={courseOptions} />
          <CreateCourseDialog />
        </div>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No subjects yet</CardTitle>
            <CardDescription>
              Create a subject for a class, then add a deck for each exam.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateCourseDialog />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {courses.map((course) => (
            <section key={course.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <h2 className="text-lg font-medium">{course.title}</h2>
                  {course.term ? (
                    <Badge variant="secondary">{course.term}</Badge>
                  ) : null}
                  <span className="text-muted-foreground text-sm">
                    {course.exams.length} deck
                    {course.exams.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex gap-1">
                  <CreateExamDialog
                    courses={courseOptions}
                    courseId={course.id}
                    label="Add deck"
                    variant="ghost"
                  />
                  <CourseActions
                    courseId={course.id}
                    title={course.title}
                    examCount={course.exams.length}
                  />
                </div>
              </div>

              {course.exams.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No decks yet — add one for the next exam.
                </p>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {course.exams.map((exam) => (
                  <Card key={exam.id} className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-base">{exam.title}</CardTitle>
                      {exam.date ? (
                        <CardDescription className="flex items-center gap-1.5">
                          <CalendarDays className="size-3.5" />
                          {exam.date}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/exams/${exam.id}`}>Open</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <PipelineStep
          icon={<FileStack className="size-4" />}
          title="Ingest"
          body="PDF, PPTX & DOCX text, tables, and notes, indexed by slide, page, or heading."
        />
        <PipelineStep
          icon={<Layers className="size-4" />}
          title="Generate"
          body="Atomic cards, each linked to the slide that supports it."
        />
        <PipelineStep
          icon={<ListChecks className="size-4" />}
          title="Verify"
          body="Coverage matrix against every study-guide objective."
        />
      </section>
    </div>
  );
}

function PipelineStep({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{body}</CardDescription>
      </CardHeader>
    </Card>
  );
}
