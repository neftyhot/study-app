import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, FileText } from "lucide-react";

import { PracticeRunner } from "@/components/exam/practice-runner";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import {
  activePaper,
  diagnostic,
  latestPaper,
  paperQuestions,
  timeRemaining,
} from "@/lib/exam/session";
import { getExam, listTopics } from "@/lib/queries";
import { getExamStats } from "@/lib/queries";

const ERROR_LABELS: Record<string, string> = {
  directionality: "direction reversed",
  mechanism: "wrong mechanism or site",
  incomplete: "incomplete",
  unrelated: "did not answer it",
};

export default async function PracticePage(
  props: PageProps<"/exams/[examId]/practice">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [topics, stats] = await Promise.all([
    listTopics(examId),
    getExamStats(examId),
  ]);

  const open = activePaper(db, examId);
  const latest = latestPaper(db, examId);
  const questions = open ? paperQuestions(db, open.id) : [];

  // The marked paper is only shown once there is no open one, so a student
  // cannot sit with last week's answers visible beside this week's questions.
  const marked =
    !open && latest?.status === "submitted" ? diagnostic(db, latest.id) : [];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Practice exam</h1>
        <p className="text-muted-foreground text-sm">
          A paper from your own deck, asked in different words, with nothing
          marked until you submit.
        </p>
      </div>

      <PracticeRunner
        examId={examId}
        topics={topics}
        cardCount={stats.flashcards}
        paper={
          open
            ? {
                id: open.id,
                questionCount: open.questionCount,
                durationMinutes: open.durationMinutes,
                remainingMs: timeRemaining(open),
                rephrased: open.rephrased,
              }
            : null
        }
        initialQuestions={questions.map((question) => ({
          id: question.id,
          position: question.position,
          format: question.format,
          prompt: question.prompt,
          options: question.options,
          answer: question.answer,
        }))}
      />

      {marked.length > 0 && latest ? (
        <section className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <FileText className="size-4" />
                Last paper
                <Badge variant="secondary">
                  {latest.score} of {latest.questionCount}
                </Badge>
                <Badge variant="outline">
                  {Math.round(((latest.score ?? 0) / Math.max(latest.questionCount, 1)) * 100)}%
                </Badge>
              </CardTitle>
              <CardDescription>
                Every question you missed, and the material it came from.
              </CardDescription>
            </CardHeader>
          </Card>

          {marked
            .filter((row) => row.verdict !== "correct")
            .map((row) => (
              <Card key={row.id}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base leading-snug break-words">
                    <CircleX className="size-4 shrink-0" />
                    {row.prompt}
                    {row.errorType && row.errorType !== "none" ? (
                      <Badge variant="outline">
                        {ERROR_LABELS[row.errorType] ?? row.errorType}
                      </Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground break-words">
                    You answered:{" "}
                    {row.answer?.trim() ? (
                      <span className="text-foreground">{row.answer}</span>
                    ) : (
                      <em>nothing</em>
                    )}
                  </p>

                  {row.feedback ? <p>{row.feedback}</p> : null}

                  <div className="bg-muted/50 space-y-2 rounded p-3">
                    <p className="break-words">{row.expectedAnswer}</p>
                    {row.source ? (
                      <p className="text-muted-foreground text-xs">
                        From {row.source.label}
                        {row.source.excerpt ? (
                          <>
                            {" — "}
                            <span className="italic">
                              &ldquo;{row.source.excerpt}&rdquo;
                            </span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}

          {marked.every((row) => row.verdict === "correct") ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircleCheck className="size-4" />
                  Every question correct
                </CardTitle>
                <CardDescription>
                  Worth sitting another with more questions, or on the topics
                  this one did not touch.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
