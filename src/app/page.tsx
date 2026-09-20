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
import { listCoursesWithExams } from "@/lib/queries";

export default async function DashboardPage() {
  const courses = await listCoursesWithExams();

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Courses</h1>
        <p className="text-muted-foreground text-sm">
          Upload slides and a study guide, then generate sourced flashcards.
        </p>
      </div>

      {courses.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No courses yet</CardTitle>
            <CardDescription>
              Run <code className="font-mono">npm run db:seed</code> for a demo
              course, or create one once the ingestion flow lands.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-6">
          {courses.map((course) => (
            <section key={course.id} className="space-y-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-medium">{course.title}</h2>
                {course.term ? (
                  <Badge variant="secondary">{course.term}</Badge>
                ) : null}
              </div>

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
          body="PDF & PPTX text, tables, and speaker notes, indexed by slide."
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
