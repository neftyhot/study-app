import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, FileText, History } from "lucide-react";

import { PracticeRunner } from "@/components/exam/practice-runner";
import { RetakeButton } from "@/components/exam/retake-button";
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
  paperHistory,
  paperQuestions,
  timeRemaining,
} from "@/lib/exam/session";
import { OWN_CARDS } from "@/lib/exam/paper";
import { readGradingStrictness } from "@/lib/settings";
import { parseStamp } from "@/lib/stats";
import type { SourceOption } from "@/lib/generate/selection";
import {
  getExam,
  getExamStats,
  listAnswerSources,
  listTopicsBySource,
} from "@/lib/queries";

function formatDate(iso: string) {
  return (parseStamp(iso) ?? new Date()).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  const { paper: chosenPaper } = await props.searchParams;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [files, topicRows, stats] = await Promise.all([
    listAnswerSources(examId),
    listTopicsBySource(examId),
    getExamStats(examId),
  ]);

  // Topics sit under the file their cards came from; cards the student wrote
  // themselves come from no file, so they get an entry of their own.
  const topics: Record<string, { topic: string; cards: number }[]> = {};
  for (const row of topicRows) {
    const key = row.fileId ?? OWN_CARDS;
    (topics[key] ??= []).push({ topic: row.topic, cards: row.cards });
  }
  for (const list of Object.values(topics)) {
    list.sort((a, b) => b.cards - a.cards || a.topic.localeCompare(b.topic));
  }

  const sources: SourceOption[] = [
    ...files.filter((file) => topics[file.id]),
    ...(topics[OWN_CARDS]
      ? [
          {
            id: OWN_CARDS,
            filename: "Cards you wrote",
            fileType: "manual",
            units: 0,
            firstIndex: 0,
            lastIndex: 0,
          },
        ]
      : []),
  ];

  const open = activePaper(db, examId);
  const history = paperHistory(db, examId);
  // A past paper picked from the history, or else the most recent one.
  const latest =
    history.find((paper) => paper.id === chosenPaper) ?? latestPaper(db, examId);
  const questions = open ? paperQuestions(db, open.id) : [];

  // The marked paper is only shown once there is no open one, so a student
  // cannot sit with last week's answers visible beside this week's questions.
  const marked =
    !open && latest && history.some((paper) => paper.id === latest.id)
      ? diagnostic(db, latest.id)
      : [];
  const missed = marked.filter((row) => row.verdict !== "correct");
  const right = marked.filter((row) => row.verdict === "correct");
  const missedCards = [
    ...new Set(missed.flatMap((row) => (row.flashcardId ? [row.flashcardId] : []))),
  ];
  const isLatest = latest?.id === history[0]?.id;
  const percent = (paper: { score: number | null; questionCount: number }) =>
    Math.round(((paper.score ?? 0) / Math.max(paper.questionCount, 1)) * 100);

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
        // A new paper is a new sitting: remount so the answers, the count and
        // the timer all start from that paper rather than the last one.
        key={open?.id ?? "setup"}
        examId={examId}
        sources={sources}
        topics={topics}
        cardCount={stats.flashcards}
        defaultStrictness={readGradingStrictness()}
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
                {isLatest ? "Last paper" : `Paper of ${formatDate(latest.startedAt)}`}
                <Badge variant="secondary">
                  {latest.score} of {latest.questionCount}
                </Badge>
                <Badge variant="outline">{percent(latest)}%</Badge>
              </CardTitle>
              <CardDescription>
                Every question you missed, and the material it came from.
              </CardDescription>
            </CardHeader>
            {missedCards.length > 0 ? (
              <CardContent>
                <RetakeButton
                  examId={examId}
                  cardIds={missedCards}
                  strictness={latest.strictness ?? undefined}
                />
              </CardContent>
            ) : null}
          </Card>

          {missed.map((row) => (
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

          {right.length > 0 && missed.length > 0 ? (
            <details className="group">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-sm">
                Show the {right.length} you got right
              </summary>
              <div className="mt-4 space-y-4">
                {right.map((row) => (
                  <Card key={row.id}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base leading-snug break-words">
                        <CircleCheck className="size-4 shrink-0" />
                        {row.prompt}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p className="text-muted-foreground break-words">
                        You answered:{" "}
                        <span className="text-foreground">{row.answer}</span>
                      </p>
                      {row.source ? (
                        <p className="text-muted-foreground text-xs">
                          From {row.source.label}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </details>
          ) : null}

          {missed.length === 0 ? (
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

      {!open && history.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4" />
              Past papers
            </CardTitle>
            <CardDescription>
              {trend(history.map(percent))} Pick one to see how it went.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.map((paper) => (
                <li key={paper.id}>
                  <Link
                    href={`/exams/${examId}/practice?paper=${paper.id}`}
                    scroll={false}
                    aria-current={paper.id === latest?.id ? "true" : undefined}
                    className="hover:bg-muted/50 aria-[current]:bg-muted flex items-center gap-3 rounded px-2 py-2"
                  >
                    <span className="text-muted-foreground w-36 shrink-0">
                      {formatDate(paper.startedAt)}
                    </span>
                    <span className="bg-muted h-2 flex-1 overflow-hidden rounded">
                      <span
                        className="bg-primary block h-full"
                        style={{ width: `${percent(paper)}%` }}
                      />
                    </span>
                    <span className="min-w-24 shrink-0 text-right whitespace-nowrap tabular-nums">
                      {paper.score} of {paper.questionCount} · {percent(paper)}%
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** One line on the direction of the scores, newest first in the list given. */
function trend(scores: number[]): string {
  if (scores.length < 2) return "";
  const recent = scores.slice(0, 3);
  const earlier = scores.slice(3, 6);
  const average = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  if (earlier.length === 0) {
    const change = scores[0] - scores[scores.length - 1];
    if (Math.abs(change) < 5) return "Holding steady.";
    return change > 0 ? `Up ${change} points since the first.` : `Down ${-change} points since the first.`;
  }
  const change = Math.round(average(recent) - average(earlier));
  if (Math.abs(change) < 5) return "Holding steady over your recent papers.";
  return change > 0
    ? `Your last three average ${change} points higher than the three before.`
    : `Your last three average ${-change} points lower than the three before.`;
}
