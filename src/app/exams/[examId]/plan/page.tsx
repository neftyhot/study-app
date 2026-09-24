import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Coffee, Scissors, TriangleAlert } from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import {
  buildPlan,
  describeStudyDays,
  formatMinutes,
  MAX_DAILY_MINUTES,
  type StudyPlan,
} from "@/lib/plan";
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
    studyDays: exam.studyDays,
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg leading-snug font-normal">
            <Headline plan={plan} />
          </CardTitle>
          <CardDescription>
            {plan.totals.learned} of {plan.totals.cards} cards started
            {plan.studyDaysLeft !== null && plan.studyDaysLeft > 0
              ? ` · ${plural(plan.studyDaysLeft, "study day")} left`
              : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <Progress value={learnedShare} />
          <Separator />
          <ScheduleForm
            examId={examId}
            date={exam.date}
            studyDays={exam.studyDays}
          />
          <p className="text-muted-foreground text-xs">
            Pick the days you&apos;ll study. The time each day needs is worked
            out from how much of the deck is left and how many study days there
            are before the exam.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {plan.today.studyDay ? (
              <CalendarClock className="size-4" />
            ) : (
              <Coffee className="size-4" />
            )}
            Today
            {plan.today.minutes > 0 ? (
              <Badge variant="secondary">
                about {formatMinutes(plan.today.minutes)}
              </Badge>
            ) : null}
          </CardTitle>
          {!plan.today.studyDay ? (
            <CardDescription>
              Day off. Nothing new is scheduled
              {plan.today.due > 0
                ? `, though ${plural(plan.today.due, "review")} ${plan.today.due === 1 ? "is" : "are"} due if you want to get ahead.`
                : "."}
            </CardDescription>
          ) : plan.today.due === 0 && plan.today.fresh === 0 ? (
            <CardDescription>Nothing to do today. You&apos;re caught up.</CardDescription>
          ) : null}
        </CardHeader>
        {plan.today.due > 0 || plan.today.fresh > 0 ? (
          <CardContent className="space-y-3">
            <ol className="space-y-2 text-sm">
              {plan.today.due > 0 ? (
                <li>
                  <strong>1.</strong> Review {plural(plan.today.due, "card")}
                  {plan.today.struggling > 0
                    ? ` (${plan.today.struggling} you keep missing)`
                    : ""}
                </li>
              ) : null}
              {plan.today.fresh > 0 ? (
                <li>
                  <strong>{plan.today.due > 0 ? "2." : "1."}</strong> Learn{" "}
                  {plural(plan.today.fresh, "new card")}
                </li>
              ) : null}
            </ol>
            <div className="flex flex-wrap gap-2">
              <StartToday examId={examId} due={plan.today.due} />
              {plan.today.fresh > 0 ? (
                <Button
                  asChild
                  variant={plan.today.due > 0 ? "outline" : "default"}
                >
                  <Link href={`/exams/${examId}/learn`}>
                    Learn {plan.today.fresh} new
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        ) : null}
      </Card>

      {plan.overloaded && plan.cuts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" />
              What to skip
            </CardTitle>
            <CardDescription>
              {plan.workload.unreachedByExam
                ? `${plural(plan.workload.unreachedByExam, "card")} won't be reached in time. `
                : ""}
              Choosing what to drop now beats running out of days with the last
              topic untouched. Nothing is deleted.
            </CardDescription>
          </CardHeader>
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
                  {cut.detail} ({plural(cut.cards, "card")})
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {plan.days.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The days ahead</CardTitle>
            <CardDescription>
              Later days get lighter as cards stick. The last study day is kept
              for review.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="max-h-96 divide-y overflow-auto rounded-md border text-sm">
              {plan.days.map((day, index) => (
                <li
                  key={day.date}
                  className={
                    day.off
                      ? "text-muted-foreground flex justify-between gap-3 px-3 py-2"
                      : "flex justify-between gap-3 px-3 py-2"
                  }
                >
                  <span className="w-24 shrink-0 font-medium">
                    {index === 0 ? "Today" : formatDate(day.date)}
                  </span>
                  <span className="flex-1">{describeDay(day)}</span>
                  <span className="tabular-nums">
                    {day.off || day.minutes === 0 ? "" : formatMinutes(day.minutes)}
                  </span>
                </li>
              ))}
              {plan.examDate !== null ? (
                <li className="flex gap-3 px-3 py-2 font-medium">
                  <span className="w-24 shrink-0">{formatDate(plan.examDate)}</span>
                  <span>Exam</span>
                </li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** The one sentence the page exists to say. */
function Headline({ plan }: { plan: StudyPlan }) {
  const days = describeStudyDays(plan.studyDays);

  if (plan.examDate === null || plan.daysLeft === null) {
    return (
      <>
        Set your exam date and the days you&apos;ll study, and the plan will
        work out how long each day needs.
      </>
    );
  }
  if (plan.daysLeft === 0) {
    return <>Exam day. Just go over anything that&apos;s due. Good luck!</>;
  }
  if (plan.totals.unstudied === 0 && plan.totals.due === 0 && plan.dailyMinutes === 0) {
    return <>You&apos;ve started every card. Keep up with reviews as they come due.</>;
  }
  if (plan.studyDaysLeft === 0) {
    return (
      <>
        None of your study days ({days}) fall before the exam on{" "}
        {formatDate(plan.examDate)}. Turn on another day below.
      </>
    );
  }
  if (plan.overloaded) {
    return (
      <>
        Even <strong>{formatMinutes(MAX_DAILY_MINUTES)}</strong> a day won&apos;t
        cover the whole deck by {formatDate(plan.examDate)}. Add study days or
        choose what to skip.
      </>
    );
  }
  return (
    <>
      Study about <strong>{formatMinutes(plan.dailyMinutes)}</strong> on each
      study day ({days}) to be ready by {formatDate(plan.examDate)}.
    </>
  );
}

function describeDay(day: StudyPlan["days"][number]): string {
  if (day.off) return "Day off";
  const parts = [];
  if (day.reviews > 0) parts.push(plural(day.reviews, "review"));
  if (day.fresh > 0) parts.push(`${day.fresh} new`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing due";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** A YYYY-MM-DD date as "Thu, Oct 1", read as a calendar day (never UTC-shifted). */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
