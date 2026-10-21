"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Calculator, Clock, FileText, Layers, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "@/lib/notify";

import { CalculatorPanel } from "@/components/cards/number-tools";
import { SourceRangePicker } from "@/components/generate/source-range-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  STRICTNESS_LABELS,
  STRICTNESS_LEVELS,
  type Strictness,
} from "@/lib/grade/strictness";
import {
  abandon,
  answerQuestion,
  loadQuestions,
  regroupTopicsAction,
  rewriteOptions,
  startPaper,
  submit,
} from "@/lib/exam/actions";
import {
  defaultChoices,
  type FileChoice,
  type SourceOption,
} from "@/lib/generate/selection";
import { usePrewarmGrading } from "@/components/learn/use-prewarm-grading";

/** A file's broad topics, as the practice setup lists them. */
export type SourceTopics = Record<string, { topic: string; cards: number }[]>;

/** Past this many topics under one file, the list is too fine to choose from. */
// Mirror MAX_TOPICS_PER_FILE and MIN_CARDS_PER_TOPIC in lib/topics.
const NARROW_TOPICS = 8;
const TINY_TOPIC = 3;

export type Question = {
  id: string;
  position: number;
  format: "mcq" | "typed";
  prompt: string;
  options: string[];
  answer: string | null;
};

export type PaperView = {
  id: string;
  questionCount: number;
  durationMinutes: number | null;
  remainingMs: number | null;
  rephrased: boolean;
};

/**
 * Sitting a practice exam.
 *
 * Nothing here tells the student how they are doing. There is no tick, no
 * color, no count of right answers — an exam that leaks feedback is a study
 * session, and the point of sitting one is to find out what you know without
 * that support.
 */
export function PracticeRunner({
  examId,
  sources,
  topics,
  cardCount,
  paper,
  initialQuestions,
  defaultStrictness,
}: {
  examId: string;
  /** Files with cards behind them, plus "your own cards" when there are any. */
  sources: SourceOption[];
  /** Broad topics by file id. */
  topics: SourceTopics;
  cardCount: number;
  paper: PaperView | null;
  initialQuestions: Question[];
  /** The Settings choice, which each new test starts from. */
  defaultStrictness: Strictness;
}) {
  usePrewarmGrading();
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialQuestions.map((q) => [q.id, q.answer ?? ""])),
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [remaining, setRemaining] = useState(paper?.remainingMs ?? null);
  const [calcOpen, setCalcOpen] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  // Set when Submit is pressed with questions left blank, to ask once.
  const [confirmBlank, setConfirmBlank] = useState(false);

  // Setup form
  const [count, setCount] = useState("20");
  const [duration, setDuration] = useState("none");
  const [rephrase, setRephrase] = useState(true);
  const [strictness, setStrictness] = useState<Strictness>(defaultStrictness);
  const [choices, setChoices] = useState<Record<string, FileChoice>>(() =>
    defaultChoices(sources),
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [regrouping, setRegrouping] = useState(false);
  const narrow = sources.some((source) => {
    const list = topics[source.id] ?? [];
    return (
      list.length > NARROW_TOPICS ||
      (list.length > 1 && list.some((topic) => topic.cards < TINY_TOPIC))
    );
  });

  // Counted over this paper's questions only. Counting every stored answer
  // carried the last paper's answers into the next one: 21 of 20, 22 of 20.
  const answered = useMemo(
    () =>
      questions.filter((question) => (answers[question.id] ?? "").trim() !== "")
        .length,
    [answers, questions],
  );

  // A timed paper submits itself: running out of time is part of the exercise.
  useEffect(() => {
    if (remaining === null || !paper) return;

    const timer = setInterval(() => {
      setRemaining((value) => {
        if (value === null || value <= 1000) {
          clearInterval(timer);
          return value === null ? null : 0;
        }
        return value - 1000;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper?.id, remaining !== null]);

  // Submitted once, from here, rather than from inside the timer's state update.
  useEffect(() => {
    if (remaining === 0) void handleSubmit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining === 0]);

  function choose(questionId: string, option: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
    void answerQuestion(questionId, option);
  }

  async function handleStart() {
    setBusy(true);
    const included = sources.filter((source) => choices[source.id]?.included);
    if (included.length === 0) {
      toast.error("Pick at least one source.");
      setBusy(false);
      return;
    }

    // Everything included and whole sends no filter at all, so a card added
    // since the page loaded is still fair game.
    const everything =
      included.length === sources.length &&
      included.every((source) => choices[source.id].whole);
    const ranges: Record<string, { from: number; to: number }> = {};
    for (const source of included) {
      const choice = choices[source.id];
      if (!choice.whole) ranges[source.id] = { from: choice.from, to: choice.to };
    }
    // A topic only narrows the files it belongs to; one left over from a file
    // since unticked would otherwise empty the paper.
    const topicsInPlay = chosen.filter((topic) =>
      included.some((source) =>
        topics[source.id]?.some((entry) => entry.topic === topic),
      ),
    );

    const result = await startPaper(examId, {
      questionCount: Number(count),
      durationMinutes: duration === "none" ? null : Number(duration),
      sources: everything ? [] : included.map((source) => source.id),
      ranges,
      topics: topicsInPlay,
      rephrase,
      strictness,
    });
    setBusy(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    if (result.set < result.askedFor) {
      toast.info(
        `Only ${result.set} ${result.set === 1 ? "question" : "questions"} available — that is all the deck has.`,
      );
    }
    if (rephrase && !result.rephrased) {
      toast.info("Questions kept the deck's wording — no model was available.");
    }

    const next = await loadQuestions(result.paperId);
    setQuestions(next);
    setAnswers(Object.fromEntries(next.map((q) => [q.id, q.answer ?? ""])));
    router.refresh();
  }

  async function handleRewrite() {
    if (!paper) return;
    setRewriting(true);
    const result = await rewriteOptions(examId, paper.id);
    setRewriting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const next = await loadQuestions(paper.id);
    setQuestions(next);
    setAnswers(Object.fromEntries(next.map((q) => [q.id, q.answer ?? ""])));
    toast.success(
      result.changed < result.of
        ? `Rewrote the options on ${result.changed} of ${result.of} questions.`
        : "Rewrote the answer options.",
    );
    router.refresh();
  }

  async function handleSubmit(automatic = false) {
    if (!paper || submitting.current) return;
    if (!automatic && !confirmBlank && answered < questions.length) {
      setConfirmBlank(true);
      return;
    }
    submitting.current = true;
    setConfirmBlank(false);
    setBusy(true);

    // A typed answer saves on blur; time can run out mid-sentence, before one.
    await Promise.all(
      questions
        .filter((question) => question.format === "typed")
        .map((question) => answerQuestion(question.id, answers[question.id] ?? "")),
    );
    let marked: Awaited<ReturnType<typeof submit>> = null;
    try {
      marked = await submit(examId, paper.id);
    } catch {
      toast.error("The paper could not be marked. Try Submit again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }

    if (!marked) return;
    toast.success(
      automatic
        ? `Time up — ${marked.score} of ${marked.total}`
        : `${marked.score} of ${marked.total}`,
    );
    router.refresh();
  }

  if (!paper) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Build a practice test</CardTitle>
          <CardDescription>
            Questions are drawn from this deck, weighted towards what you have
            not yet learned, and asked in different words from the cards.
            Nothing is marked until you submit.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Questions</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["10", "20", "30", "50"].map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Time limit</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Untimed</SelectItem>
                  {["15", "30", "45", "60", "90"].map((n) => (
                    <SelectItem key={n} value={n}>{n} minutes</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {sources.length > 0 ? (
            <SourceRangePicker
              sources={sources}
              choices={choices}
              onChange={setChoices}
              disabled={busy}
              title="Sources and pages"
              alwaysCheckable
            >
              {(source) => {
                const list = topics[source.id] ?? [];
                if (list.length < 2) return null;

                return (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground text-xs">
                      Topics{" "}
                      {list.some((entry) => chosen.includes(entry.topic))
                        ? ""
                        : "(all)"}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {list.map((entry) => (
                        <Button
                          key={entry.topic}
                          type="button"
                          size="sm"
                          variant={
                            chosen.includes(entry.topic) ? "default" : "outline"
                          }
                          className="h-7 text-xs"
                          onClick={() =>
                            setChosen((previous) =>
                              previous.includes(entry.topic)
                                ? previous.filter((item) => item !== entry.topic)
                                : [...previous, entry.topic],
                            )
                          }
                        >
                          {entry.topic}
                          <span className="opacity-60 tabular-nums">
                            {entry.cards}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              }}
            </SourceRangePicker>
          ) : null}

          {narrow ? (
            <div className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-md p-3 text-sm">
              <p className="text-muted-foreground">
                Some files have lots of one-card topics. Merge them into a few
                broad topics per file?
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={regrouping || busy}
                onClick={async () => {
                  setRegrouping(true);
                  const result = await regroupTopicsAction(examId);
                  setRegrouping(false);
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  setChosen([]);
                  toast.success(
                    `${result.topicsBefore} topics merged into ${result.topicsAfter}`,
                  );
                  router.refresh();
                }}
              >
                {regrouping ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Layers className="size-3.5" />
                )}
                {regrouping ? "Merging…" : "Combine topics"}
              </Button>
            </div>
          ) : null}

          <div className="flex items-start gap-2">
            <Checkbox
              id="rephrase"
              checked={rephrase}
              onCheckedChange={(value) => setRephrase(value === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="rephrase" className="text-sm font-normal">
                Ask in different words
              </Label>
              <p className="text-muted-foreground text-xs">
                You have drilled these cards, and recognising a phrasing is not
                knowing the answer. Needs a model, and takes a moment.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">Grading difficulty</Label>
            <div
              role="radiogroup"
              aria-label="Grading difficulty"
              className="flex flex-wrap gap-2"
            >
              {STRICTNESS_LEVELS.map((level) => (
                <Button
                  key={level}
                  type="button"
                  role="radio"
                  aria-checked={strictness === level}
                  size="sm"
                  variant={strictness === level ? "default" : "outline"}
                  disabled={busy}
                  onClick={() => setStrictness(level)}
                >
                  {STRICTNESS_LABELS[level].label}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              {STRICTNESS_LABELS[strictness].blurb} Applies to this test only.
            </p>
          </div>

          <Button disabled={busy || cardCount === 0} onClick={() => void handleStart()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
            {busy ? "Building your test…" : "Start Practice Exam"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-background/90 sticky top-14 z-10 space-y-2 border-b py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {answered} of {questions.length} answered
            {paper.rephrased ? (
              <Badge variant="outline" className="ml-2">reworded</Badge>
            ) : null}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {remaining !== null ? (
              <Badge variant={remaining < 60_000 ? "destructive" : "secondary"} className="gap-1 tabular-nums">
                <Clock className="size-3" />
                {Math.floor(remaining / 60_000)}:
                {String(Math.floor((remaining % 60_000) / 1000)).padStart(2, "0")}
              </Badge>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              aria-pressed={calcOpen}
              onClick={() => setCalcOpen((value) => !value)}
            >
              <Calculator className="size-3.5" />
              Calculator
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={busy || rewriting}
              title="Write new wrong options for the multiple-choice questions. Questions stay the same."
              onClick={() => void handleRewrite()}
            >
              {rewriting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Rewrite options
            </Button>

            <Button size="sm" disabled={busy || rewriting} onClick={() => void handleSubmit()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              Submit
            </Button>
          </div>
        </div>
        <Progress value={(answered / Math.max(questions.length, 1)) * 100} />
        <TimeAnnouncer remaining={remaining} />
        {confirmBlank && answered < questions.length ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            <span>
              {questions.length - answered === 1
                ? "One question is"
                : `${questions.length - answered} questions are`}{" "}
              still blank. Blank answers are marked wrong.
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setConfirmBlank(false);
                  goToBlank(questions, answers);
                }}
              >
                Keep going
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void handleSubmit()}>
                Submit anyway
              </Button>
            </span>
          </div>
        ) : answered > 0 && answered < questions.length ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => goToBlank(questions, answers)}
            >
              <ArrowDown className="size-3" />
              Next unanswered
            </Button>
          </div>
        ) : null}
      </div>

      {questions.map((question) => (
        <Card key={question.id} id={`question-${question.id}`} className="scroll-mt-40">
          <CardHeader>
            <CardTitle
              id={`prompt-${question.id}`}
              className="text-base leading-snug break-words"
            >
              <span className="text-muted-foreground mr-2 tabular-nums">
                {question.position + 1}.
              </span>
              {question.prompt}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {question.format === "mcq" ? (
              <div
                role="radiogroup"
                aria-labelledby={`prompt-${question.id}`}
                className="space-y-2"
                onKeyDown={(event) => {
                  // 1-4 or A-D picks an option; arrows move between them.
                  const pick = optionForKey(event.key, question.options.length);
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]"),
                  ];
                  if (pick !== null) {
                    event.preventDefault();
                    choose(question.id, question.options[pick]);
                    buttons[pick]?.focus();
                    return;
                  }
                  const step =
                    event.key === "ArrowDown" || event.key === "ArrowRight"
                      ? 1
                      : event.key === "ArrowUp" || event.key === "ArrowLeft"
                        ? -1
                        : 0;
                  if (step === 0) return;
                  event.preventDefault();
                  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  const next = (Math.max(at, 0) + step + buttons.length) % buttons.length;
                  buttons[next]?.focus();
                }}
              >
                {question.options.map((option, i) => {
                  const selected = answers[question.id] === option;
                  const anySelected = question.options.includes(answers[question.id] ?? "");
                  return (
                    <Button
                      key={option}
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected || (!anySelected && i === 0) ? 0 : -1}
                      variant={selected ? "default" : "outline"}
                      className="h-auto w-full justify-start gap-3 py-2.5 text-left whitespace-normal"
                      onClick={() => choose(question.id, option)}
                    >
                      <span
                        aria-hidden
                        className={
                          selected
                            ? "border-primary-foreground/50 flex size-5 shrink-0 items-center justify-center rounded border text-[11px] font-semibold"
                            : "text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded border text-[11px] font-semibold"
                        }
                      >
                        {String.fromCharCode(65 + i)}
                      </span>
                      {option}
                    </Button>
                  );
                })}
              </div>
            ) : (
              <Textarea
                value={answers[question.id] ?? ""}
                placeholder="Your answer…"
                aria-labelledby={`prompt-${question.id}`}
                className="min-h-24"
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
                }
                onBlur={(event) => void answerQuestion(question.id, event.target.value)}
              />
            )}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap gap-2 pb-8">
        <Button disabled={busy} onClick={() => void handleSubmit()}>
          <Send className="size-4" />
          Submit paper
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            await abandon(examId, paper.id);
            router.refresh();
          }}
        >
          Discard
        </Button>
      </div>

      <CalculatorPanel open={calcOpen} onOpenChange={setCalcOpen} />
    </div>
  );
}

/** The option a key picks: 1-9 or A-I, within the options there are. */
function optionForKey(key: string, count: number): number | null {
  const index = /^[1-9]$/.test(key)
    ? Number(key) - 1
    : /^[a-i]$/i.test(key)
      ? key.toLowerCase().charCodeAt(0) - 97
      : -1;
  return index >= 0 && index < count ? index : null;
}

/** Scrolls to the first blank question and puts focus in it. */
function goToBlank(questions: Question[], answers: Record<string, string>) {
  const blank = questions.find((question) => (answers[question.id] ?? "").trim() === "");
  if (!blank) return;
  const card = document.getElementById(`question-${blank.id}`);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  card?.querySelector<HTMLElement>("textarea, [role=radio]")?.focus({ preventScroll: true });
}

/**
 * Says the time left aloud to a screen reader at five minutes and at one,
 * rather than every second the badge ticks.
 */
function TimeAnnouncer({ remaining }: { remaining: number | null }) {
  const message =
    remaining === null
      ? ""
      : remaining <= 60_000 && remaining > 0
        ? "One minute left."
        : remaining <= 5 * 60_000 && remaining > 60_000
          ? "Five minutes left."
          : "";
  return (
    <p aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
