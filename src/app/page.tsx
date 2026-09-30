import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, KeyRound, ListPlus } from "lucide-react";

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
import { DeleteDeckButton } from "@/components/manage/delete-deck-button";
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
import { isAnswerable, isSetupComplete, readProvider } from "@/lib/settings";

export default async function DashboardPage() {
  // First run lands on the wizard instead of an empty dashboard.
  if (!isSetupComplete(db)) redirect("/welcome");

  const courses = await listCoursesWithExams();
  // Google sign-in is gone; anyone who used it needs a key of their own now.
  const provider = readProvider(db);
  const needsKey = provider !== "local" && !isAnswerable(db);
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

      {needsKey ? (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4" />
              {provider === "gemini"
                ? "Add your Gemini key"
                : "Add your API key"}
            </CardTitle>
            <CardDescription>
              {provider === "gemini"
                ? "AI features now run on your own free Google AI Studio key. It takes about a minute — Settings walks you through it."
                : "AI features need your API key. Paste it in Settings."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link href="/settings">Add key in Settings</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <QuickStart courses={courseOptions} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-sm">
          Other ways to start:
        </span>
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
                        <CardTitle className="text-base">
                          {exam.title}
                        </CardTitle>
                        <div className="flex shrink-0">
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
                          <DeleteDeckButton
                            examId={exam.id}
                            examTitle={exam.title}
                          />
                        </div>
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
