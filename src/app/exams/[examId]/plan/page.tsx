import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Scissors, TriangleAlert } from "lucide-react";

import { ScheduleForm } from "@/components/plan/schedule-form";
import { StartToday } from "@/components/plan/start-today";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { buildPlan, formatMinutes } from "@/lib/plan";
import { getExam, loadPlanCards } from "@/lib/queries";

export default async function PlanPage(
  props: PageProps<"/exams/[examId]/plan">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const { cards, hasCoverage } = await loadPlanCards(examId);
  const plan = buildPlan({
    cards,
    examDate: exam.date,
    dailyMinutes: exam.dailyMinutes,
    hasCoverage,
  });

  const learnedShare =
    plan.totals.cards === 0
      ? 0
      : (plan.totals.learned / plan.totals.cards) * 100;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Study plan</h1>
        <p className="text-muted-foreground text-sm">
          What today should hold, and whether the days left are enough for
          what is left.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <ScheduleForm
            examId={examId}
            date={exam.date}
            dailyMinutes={exam.dailyMinutes}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <CalendarClock className="size-4" />
            Today
            <Badge variant="secondary">
              about {formatMinutes(plan.today.minutes)}
            </Badge>
            {plan.daysLeft !== null ? (
              <Badge variant="outline">
                {plan.daysLeft === 0
                  ? "Exam today"
                  : `${plan.daysLeft} day${plan.daysLeft === 1 ? "" : "s"} to go`}
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Reviews come first — a review skipped today costs more than a card
            not started today.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Slice label="Reviews due" value={plan.today.due} href={`/exams/${examId}/study`} />
            <Slice label="Stuck cards" value={plan.today.struggling} href={`/exams/${examId}/learn`} />
            <Slice label="New concepts" value={plan.today.fresh} href={`/exams/${examId}/learn`} />
          </div>

          <div className="flex flex-wrap gap-2">
            <StartToday examId={examId} due={plan.today.due} />
            {plan.today.fresh > 0 ? (
              <Button asChild variant={plan.today.due > 0 ? "outline" : "default"}>
                <Link href={`/exams/${examId}/learn`}>
                  Learn {plan.today.fresh} new concept
                  {plan.today.fresh === 1 ? "" : "s"}
                </Link>
              </Button>
            ) : null}
          </div>

          {plan.today.reviewsFillTheDay ? (
            <p className="text-muted-foreground text-sm">
              Reviews alone use today&apos;s time, so nothing new is scheduled.
              That is the right call — but if this keeps happening, the deck is
              growing faster than it is being learned.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where the deck stands</CardTitle>
          <CardDescription>
            {plan.totals.learned} of {plan.totals.cards} cards started ·{" "}
            {plan.totals.unstudied} not yet seen ·{" "}
            {plan.totals.struggling} keep going wrong
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={learnedShare} />

          {plan.workload.capacity === null ? (
            <p className="text-muted-foreground text-sm">
              Set an exam date above and this will tell you whether the time
              left is enough.
            </p>
          ) : (
            <p className="text-sm">
              About <strong>{formatMinutes(plan.workload.minutes)}</strong> of
              work remains, including the reviews it will generate. You have{" "}
              <strong>{formatMinutes(plan.workload.capacity)}</strong> before
              the exam.
            </p>
          )}
        </CardContent>
      </Card>

      {plan.workload.deficitMinutes !== null &&
      plan.workload.deficitMinutes > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" />
              There is more material than time
            </CardTitle>
            <CardDescription>
              Short by about {formatMinutes(plan.workload.deficitMinutes)}.
              Finishing everything would take{" "}
              {plan.workload.requiredDailyMinutes === null
                ? "more time than remains"
                : `${formatMinutes(plan.workload.requiredDailyMinutes)} a day`}
              . Better to choose what to drop than to run out of days with the
              last topic untouched.
            </CardDescription>
          </CardHeader>

          {plan.cuts.length > 0 ? (
            <CardContent className="space-y-3">
              {plan.cuts.map((cut) => (
                <div key={cut.id} className="rounded-md border p-3">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Scissors className="size-3.5" />
                    {cut.label}
                    <Badge variant="outline">
                      saves about {formatMinutes(cut.minutesSaved)}
                    </Badge>
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {cut.detail} ({cut.cards} card
                    {cut.cards === 1 ? "" : "s"})
                  </p>
                </div>
              ))}
              <p className="text-muted-foreground text-xs">
                Nothing is deleted by choosing one of these — exclude those
                cards from the deck when you are ready, or simply study the
                rest first.
              </p>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function Slice({
  label,
  value,
  href,
}: {
  label: string;
  value: number;
  href: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {value > 0 ? (
        <Button asChild variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs">
          <Link href={href}>Start</Link>
        </Button>
      ) : null}
    </div>
  );
}
