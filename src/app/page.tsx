import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, ListPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QuickStart } from "@/components/ingest/quick-start";
import { CourseActions } from "@/components/manage/course-actions";
import {
  EditCourseDialog,
  EditExamDialog,
} from "@/components/manage/edit-dialogs";
import {
  CreateCourseDialog,
  CreateExamDialog,
} from "@/components/manage/create-dialogs";
import { db } from "@/db";
import { listCoursesWithExams } from "@/lib/queries";
import { isSetupComplete } from "@/lib/settings";

export default async function DashboardPage() {
  // First run lands on the wizard instead of an empty dashboard.
  if (!isSetupComplete(db)) redirect("/welcome");

  const courses = await listCoursesWithExams();
  const courseOptions = courses.map((course) => ({
    id: course.id,
    title: course.title,
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Your study sets
        </h1>
        <p className="text-muted-foreground text-sm">
          Add your slides, read the study guide, practise with flashcards, then
          take a practice exam.
        </p>
      </div>

      <QuickStart courses={courseOptions} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">Other ways to start:</span>
        <Button asChild variant="outline" size="sm">
          <Link href="/decks/new">
            <ListPlus className="size-4" />
            Type in cards yourself
          </Link>
        </Button>
        {courses.length > 0 ? (
          <CreateExamDialog courses={courseOptions} />
        ) : null}
        <CreateCourseDialog />
      </div>

      {courses.length === 0 ? null : (
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
                  <EditCourseDialog
                    courseId={course.id}
                    title={course.title}
                    term={course.term}
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
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-base">{exam.title}</CardTitle>
                        <EditExamDialog
                          exam={{
                            id: exam.id,
                            title: exam.title,
                            date: exam.date,
                            courseId: course.id,
                          }}
                          courses={courseOptions}
                          size="icon-sm"
                        />
                      </div>
                      {exam.date ? (
                        <CardDescription className="flex items-center gap-1.5">
                          <CalendarDays className="size-3.5" />
                          {exam.date}
                        </CardDescription>
                      ) : null}
                    </CardHeader>
                    <CardContent className="mt-auto">
                      <Button asChild size="sm" className="w-full">
                        <Link href={`/exams/${exam.id}`}>Study</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

    </div>
  );
}
