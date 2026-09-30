"use client";

import { useEffect, useRef, useState } from "react";
import {
  Calculator,
  CircleCheck,
  CircleHelp,
  CircleX,
  Dices,
  FileText,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Sparkles,
} from "lucide-react";
import { toast } from "@/lib/notify";

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
import { Input } from "@/components/ui/input";
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
  clampRoundSize,
  DEFAULT_ROUND_SIZE,
  MAX_ROUND_SIZE,
  MIN_ROUND_SIZE,
} from "@/lib/learn/round-size";
import {
  answerMultipleChoice,
  answerTyped,
  askForHelp,
  beginLearnSession,
  endLearnSession,
  nextLearnRound,
  overrideAnswer,
  practiceMissedPoints,
  skipKnownConcept,
  skipToTypedRecall,
  skipUnknownConcept,
  type AssistResult,
  type LearnPrompt,
  type LearnStatus,
  type Reveal,
} from "@/lib/learn/actions";
import type { AssistKind } from "@/lib/assist";
import type { LearnMode as LearnModeName } from "@/lib/learn/ladder";
import type { TypedGrade } from "@/lib/learn/typed";
import { CardEditor } from "@/components/cards/card-editor";
import { SourceViewer } from "@/components/sources/source-viewer";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import {
  ExplainButton,
  MisconceptionList,
} from "@/components/cards/explain-button";
import type { StudyScope } from "@/lib/study/queue";
import { usePrewarmGrading } from "@/components/learn/use-prewarm-grading";
import {
  CalculatorPanel,
  NumbersPanel,
  numberRows,
  type CalculatorHandle,
} from "@/components/cards/number-tools";

/** PRD §14's assistance buttons, in the order a stuck student wants them. */
const AIDS: { kind: AssistKind; label: string }[] = [
  { kind: "hint", label: "Hint" },
  { kind: "simpler", label: "Explain simply" },
  { kind: "example", label: "Give an example" },
  { kind: "compare", label: "Compare concepts" },
  { kind: "prerequisite", label: "Easier prerequisite" },
  { kind: "source", label: "Show original slide" },
];

const DIAGNOSIS_LABELS: Record<string, string> = {
  missing_prerequisite: "Looks like a missing prerequisite",
  term_confusion: "Looks like two terms getting swapped",
  defective_question: "This card may be the problem, not you",
  not_learned_yet: "Not learned yet",
};

const ERROR_LABELS: Record<string, string> = {
  directionality: "direction reversed",
  mechanism: "wrong mechanism or site",
  incomplete: "incomplete",
  unrelated: "does not answer the question",
};

const STAGE_LABELS: Record<string, string> = {
  mcq: "Recognize",
  typed_immediate: "Recall",
  typed_interleaved: "Recall after a gap",
  typed_delayed: "Delayed check",
};

/** A card the student can choose to begin from. */
export type StartCard = {
  id: string;
  number: number;
  topic: string | null;
  question: string;
};

export function LearnMode({
  examId,
  topics,
  cards,
  cardCount,
  dueCount,
  initialSessionId,
  initialStatus,
}: {
  examId: string;
  topics: string[];
  cards: StartCard[];
  cardCount: number;
  dueCount: number;
  initialSessionId: string | null;
  initialStatus: LearnStatus | null;
}) {
  usePrewarmGrading();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [status, setStatus] = useState(initialStatus);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  /**
   * The question that was actually answered.
   *
   * `status` advances the moment an answer is submitted, so without this the
   * card above the reveal would already be the NEXT question — and clicking
   * Continue would appear to change nothing.
   */
  const [answered, setAnswered] = useState<LearnPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [guessing, setGuessing] = useState(false);
  const [typed, setTyped] = useState("");
  const [helps, setHelps] = useState<AssistResult[]>([]);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [helping, setHelping] = useState<AssistKind | null>(null);
  const [calcOpen, setCalcOpen] = useState(false);
  const calcRef = useRef<CalculatorHandle>(null);

  if (!sessionId || !status) {
    return (
      <LearnPicker
        topics={topics}
        cards={cards}
        cardCount={cardCount}
        dueCount={dueCount}
        onStart={async (filter) => {
          const started = await beginLearnSession(examId, filter);
          setSessionId(started.sessionId);
          setStatus(started.status);
          if (!started.status.prompt) toast.error("No cards match that filter");
        }}
      />
    );
  }

  const prompt = status.prompt;

  async function submitChoice(text: string) {
    if (!sessionId || !prompt) return;
    setBusy(true);
    const result = await answerMultipleChoice(
      sessionId,
      prompt.cardId,
      text,
      guessing,
    );
    setBusy(false);
    if (!result) return;
    setAnswered(prompt);
    setReveal(result.reveal);
    setStatus(result.status);
  }

  async function submitTyped() {
    if (!sessionId || !prompt) return;
    setBusy(true);
    const result = await answerTyped(
      sessionId,
      prompt.cardId,
      typed,
      guessing,
    );
    setBusy(false);
    if (!result) return;
    setAnswered(prompt);
    setReveal(result.reveal);
    setStatus(result.status);
  }

  function continueAfterReveal() {
    setReveal(null);
    setAnswered(null);
    setTyped("");
    setGuessing(false);
    setHelps([]);
  }

  /** "I know it": drop the concept and move on, without typing it out. */
  async function knowIt() {
    if (!sessionId || !prompt) return;
    setBusy(true);
    const result = await skipKnownConcept(sessionId, prompt.cardId);
    setBusy(false);
    if (!result) return;

    setStatus(result.status);
    setHelps([]);
    setTyped("");
    toast.success(`Marked known — the answer was: ${result.directAnswer}`);
  }

  /** "No clue": reveal it now and come back to it later in the round. */
  async function noClue() {
    if (!sessionId || !prompt) return;
    setBusy(true);
    const result = await skipUnknownConcept(sessionId, prompt.cardId);
    setBusy(false);
    if (!result) return;

    setAnswered(prompt);
    setReveal(result.reveal);
    setStatus(result.status);
  }

  async function help(kind: AssistKind) {
    if (!sessionId || !prompt) return;
    setHelping(kind);

    const result = await askForHelp(sessionId, prompt.cardId, kind);
    setHelping(null);

    if ("error" in result) {
      toast.error(result.error);
      return;
    }

    setHelps((previous) => [
      ...previous.filter((item) => item.kind !== kind),
      result,
    ]);
    // The excerpt stays in the aids list; the whole file opens at its page.
    if (kind === "source" && prompt.sourceSlideId) setSourceOpen(true);
    // Using an aid changes what this attempt can prove; say so immediately.
    setStatus(result.status);
  }

  if (!prompt) {
    return (
      <RoundSummary
        status={status}
        onNext={async () => {
          if (!sessionId) return;
          const result = await nextLearnRound(sessionId);
          setStatus(result.status);
          setReveal(null);
          if (!result.more) {
            toast.error("No concepts left to study in this session");
            setSessionId(null);
          } else if (result.status.roundNumber === 1) {
            toast.success("Every concept has had a round — starting again from the top");
          }
        }}
        onFinish={async () => {
          if (!sessionId) return;
          await endLearnSession(sessionId);
          setSessionId(null);
          setStatus(null);
        }}
      />
    );
  }

  const roundTotal = status.remaining + status.mastered + status.struggled;

  // While a reveal is showing, the screen belongs to the question just
  // answered; the next one appears when the student continues.
  const shown = reveal && answered ? answered : prompt;

  // The ladder deliberately re-asks a concept as typed recall straight after
  // recognizing it. Saying so turns a confusing repeat into an understood one.
  const repeatsConcept =
    !reveal &&
    answered !== null &&
    answered.cardId === prompt.cardId &&
    answered.stage !== prompt.stage;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Progress
          value={
            roundTotal === 0
              ? 0
              : ((roundTotal - status.remaining) / roundTotal) * 100
          }
        />
        <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
          <span>
            Round {status.roundNumber} of {status.roundCount}
            {status.pass > 1 ? ` (pass ${status.pass})` : ""} ·{" "}
            {status.remaining} concept{status.remaining === 1 ? "" : "s"} left
          </span>
          <span>{status.mastered} recalled without help</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {shown.topic ? (
              <Badge variant="secondary">{shown.topic}</Badge>
            ) : null}
            <Badge variant="outline">{STAGE_LABELS[shown.stage]}</Badge>
            {/* Being honest about what this attempt can prove. */}
            <Badge variant={shown.countsTowardMastery ? "default" : "outline"}>
              {shown.countsTowardMastery ? "Counts" : "Practice"}
            </Badge>
          </div>
          <CardTitle className="pt-2 text-lg leading-snug break-words">
            {shown.question}
          </CardTitle>
          {repeatsConcept ? (
            <p className="text-muted-foreground pt-1 text-sm">
              Same concept — now from memory, without the options.
            </p>
          ) : null}
          {shown.remediate && shown.breakdown && shown.breakdown.length > 0 ? (
            <div className="bg-muted/60 mt-2 rounded p-3">
              <p className="text-xs font-medium">
                Take it one piece at a time — this answer needs:
              </p>
              <ul className="text-muted-foreground mt-1 list-disc pl-5 text-xs">
                {shown.breakdown.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* A calculator on every question, and the numbers it gives. */}
          <NumbersPanel
            key={shown.cardId}
            rows={numberRows(shown.givens ?? [], shown.question, [], false)}
            onPick={(value) => calcRef.current?.insert(value)}
            actions={
              <Button
                variant="outline"
                size="sm"
                aria-pressed={calcOpen}
                onClick={() => setCalcOpen((value) => !value)}
              >
                <Calculator className="size-4" />
                Calculator
              </Button>
            }
          />

          {!reveal ? (
            <AssistBar
              helps={helps}
              helping={helping}
              onAsk={(kind) =>
                kind === "source" && helps.some((item) => item.kind === "source")
                  ? setSourceOpen(true)
                  : void help(kind)
              }
            />
          ) : null}

          {reveal ? (
            <RevealPanel
              key={`${shown.cardId}:${reveal.attemptId ?? reveal.directAnswer}`}
              examId={examId}
              sourceSlideId={shown.sourceSlideId}
              reveal={reveal}
              cardId={shown.cardId}
              question={shown.question}
              canUndo={shown.canUndo}
              onShowSource={
                shown.sourceSlideId ? () => setSourceOpen(true) : undefined
              }
              onContinue={continueAfterReveal}
              onOverride={async () => {
                if (!sessionId || !reveal.attemptId) return;
                const result = await overrideAnswer(sessionId, reveal.attemptId);
                if (!result.applied) {
                  toast.error("That grade cannot be overridden");
                  return;
                }
                setStatus(result.status);
                toast.success("Marked correct — the ladder moved on with you");
                continueAfterReveal();
              }}
            />
          ) : prompt.options ? (
            <div className="space-y-2">
              {prompt.options.map((option) => (
                <Button
                  key={option.text}
                  variant="outline"
                  className="h-auto w-full justify-start py-3 text-left whitespace-normal"
                  disabled={busy}
                  onClick={() => void submitChoice(option.text)}
                >
                  {option.text}
                </Button>
              ))}

              <div className="flex flex-wrap gap-2 pt-1">
                <SkipControls
                  busy={busy}
                  onKnow={() => void knowIt()}
                  onNoClue={() => void noClue()}
                />
                <Button
                  variant={guessing ? "destructive" : "ghost"}
                  size="sm"
                  onClick={() => setGuessing((value) => !value)}
                >
                  <Dices className="size-3.5" />
                  {guessing ? "Marking as a guess" : "I'm guessing"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    if (!sessionId) return;
                    setStatus(await skipToTypedRecall(sessionId, prompt.cardId));
                  }}
                >
                  I know this — let me type it
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="Answer from memory… (Enter to check, Shift+Enter for a new line)"
                className="min-h-24"
                disabled={busy}
                onKeyDown={(event) => {
                  // Enter checks; Shift+Enter starts a new line.
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (!busy && typed.trim()) void submitTyped();
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <SkipControls
                  busy={busy}
                  onKnow={() => void knowIt()}
                  onNoClue={() => void noClue()}
                />
                <Button
                  disabled={busy || typed.trim().length === 0}
                  onClick={() => void submitTyped()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                  Check answer
                </Button>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="guessed"
                    checked={guessing}
                    onCheckedChange={(value) => setGuessing(value === true)}
                  />
                  <Label
                    htmlFor="guessed"
                    className="text-muted-foreground text-sm font-normal"
                  >
                    I guessed
                  </Label>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <SourceViewer
        slideId={shown.sourceSlideId}
        excerpt={
          reveal?.sourceExcerpt ??
          helps.find((item) => item.kind === "source")?.body
        }
        open={sourceOpen}
        onOpenChange={setSourceOpen}
      />
      <CalculatorPanel ref={calcRef} open={calcOpen} onOpenChange={setCalcOpen} />
    </div>
  );
}

function RevealPanel({
  examId,
  sourceSlideId,
  reveal,
  cardId,
  question,
  canUndo,
  onShowSource,
  onContinue,
  onOverride,
}: {
  examId: string;
  sourceSlideId: string | null;
  reveal: Reveal;
  cardId: string;
  question: string;
  canUndo: boolean;
  onShowSource?: () => void;
  onContinue: () => void;
  onOverride: () => Promise<void>;
}) {
  const [drilling, setDrilling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  // Written on request when the deck was built without explanations.
  const [explained, setExplained] = useState<{
    fullExplanation: string | null;
    commonMisconceptions: string[];
  } | null>(null);
  const fullExplanation = reveal.fullExplanation ?? explained?.fullExplanation;

  const missed = reveal.grade?.missedPoints ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {reveal.correct ? (
          <>
            <CircleCheck className="size-4" />
            Correct
          </>
        ) : (
          <>
            <CircleX className="size-4" />
            Not quite
          </>
        )}
        {reveal.grade && reveal.grade.errorType !== "none" ? (
          <Badge variant="outline">
            {ERROR_LABELS[reveal.grade.errorType] ?? reveal.grade.errorType}
          </Badge>
        ) : null}
      </div>

      {reveal.grade?.feedback ? (
        <p className="text-sm">{reveal.grade.feedback}</p>
      ) : null}

      {reveal.debrief ? (
        <p className="text-muted-foreground text-sm">{reveal.debrief}</p>
      ) : null}

      {reveal.diagnosis ? (
        <div className="space-y-1 rounded-md border p-3 text-sm">
          <p className="text-xs font-medium">
            {DIAGNOSIS_LABELS[reveal.diagnosis.category] ??
              reveal.diagnosis.category}
          </p>
          <p className="text-muted-foreground">
            {reveal.diagnosis.explanation}
          </p>
          <p>{reveal.diagnosis.suggestion}</p>
        </div>
      ) : null}

      {reveal.grade ? (
        <div className="space-y-2 text-sm">
          {reveal.grade.metPoints.length > 0 ? (
            <PointList title="You got" points={reveal.grade.metPoints} />
          ) : null}
          {missed.length > 0 ? (
            <PointList title="Still missing" points={missed} />
          ) : null}
          {reveal.grade.creditedOptional.length > 0 ? (
            <PointList
              title="Extra credit"
              points={reveal.grade.creditedOptional}
            />
          ) : null}
          {reveal.grade.provisional ? (
            <p className="text-muted-foreground text-xs">
              Matched on keywords, not meaning — add an API key in Settings
              for semantic grading.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="bg-muted/50 space-y-2 rounded p-3 text-sm">
        <p>{reveal.directAnswer}</p>
        {fullExplanation ? (
          <p className="text-muted-foreground text-xs whitespace-pre-line">
            {fullExplanation}
          </p>
        ) : (
          <ExplainButton
            cardId={cardId}
            onExplained={(result) =>
              setExplained({
                fullExplanation: result.fullExplanation,
                commonMisconceptions: result.commonMisconceptions,
              })
            }
          />
        )}
        {explained ? (
          <MisconceptionList items={explained.commonMisconceptions} />
        ) : null}
        {reveal.sourceExcerpt ? (
          <blockquote className="text-muted-foreground border-l-2 pl-2 text-xs italic">
            {reveal.sourceExcerpt}
          </blockquote>
        ) : null}
      </div>

      {drilling ? (
        <PracticeDrill
          cardId={cardId}
          points={missed}
          onClose={() => setDrilling(false)}
        />
      ) : null}

      {editing ? (
        <div className="rounded-md border p-3">
          <CardEditor
            cardId={cardId}
            card={{
              question,
              directAnswer: reveal.directAnswer,
              fullExplanation: fullExplanation ?? null,
            }}
            canUndo={canUndo}
            onClose={() => setEditing(false)}
            onSaved={() => undefined}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onContinue}>Continue</Button>

        {onShowSource ? (
          <Button variant="outline" onClick={onShowSource}>
            <FileText className="size-3.5" />
            Show original slide
          </Button>
        ) : null}

        <TutorPanel
          examId={examId}
          slideId={sourceSlideId}
          focus={`I'm studying this flashcard.\nQuestion: ${question}\nAnswer: ${reveal.directAnswer}`}
          trigger={
            <Button variant="outline">
              <MessageCircleQuestion className="size-3.5" />
              Ask a question
            </Button>
          }
        />

        {reveal.attemptId && !reveal.correct ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onOverride();
              setBusy(false);
            }}
          >
            My answer was correct
          </Button>
        ) : null}

        {missed.length > 0 && !drilling ? (
          <Button variant="ghost" onClick={() => setDrilling(true)}>
            Practice what I missed
          </Button>
        ) : null}

        {!editing ? (
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Edit card
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The help buttons and whatever help has been given so far.
 *
 * Deliberately sits above the answer box rather than behind a menu: a student
 * who is stuck should not have to go looking, and every one of these is
 * recorded so the attempt that follows is counted as assisted practice.
 */
/**
 * The two skips (PRD skip controls).
 *
 * Both are honest about their cost: "I know it" credits the card as recall
 * today and pushes its review out, but can never claim multi-day retention;
 * "no clue" counts as a miss, leaves the due date alone, and brings the
 * concept back later in this round.
 */
function SkipControls({
  busy,
  onKnow,
  onNoClue,
}: {
  busy: boolean;
  onKnow: () => void;
  onNoClue: () => void;
}) {
  return (
    <>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onKnow}>
        <CircleCheck className="size-3.5" />
        I know it
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={onNoClue}>
        <CircleHelp className="size-3.5" />
        No clue
      </Button>
    </>
  );
}

function AssistBar({
  helps,
  helping,
  onAsk,
}: {
  helps: AssistResult[];
  helping: AssistKind | null;
  onAsk: (kind: AssistKind) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {AIDS.map((aid) => (
          <Button
            key={aid.kind}
            size="sm"
            variant="ghost"
            className="text-muted-foreground h-7 px-2 text-xs"
            disabled={helping !== null}
            onClick={() => onAsk(aid.kind)}
          >
            {helping === aid.kind ? (
              <Loader2 className="size-3 animate-spin" />
            ) : aid.kind === "source" ? (
              <FileText className="size-3" />
            ) : null}
            {aid.label}
          </Button>
        ))}
      </div>

      {helps.map((item) => (
        <div
          key={item.kind}
          className="bg-muted/50 space-y-1 rounded-md border p-3 text-sm"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium">
            {AIDS.find((aid) => aid.kind === item.kind)?.label ?? item.kind}
            {item.usesOutsideKnowledge ? (
              <Badge variant="outline" className="gap-1">
                <Sparkles className="size-3" />
                beyond your notes
              </Badge>
            ) : null}
          </p>
          <p className="whitespace-pre-wrap">{item.body}</p>
        </div>
      ))}

      {helps.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Answering after help counts as practice, not recall.
        </p>
      ) : null}
    </div>
  );
}

function PointList({ title, points }: { title: string; points: string[] }) {
  return (
    <div>
      <p className="text-xs font-medium">{title}</p>
      <ul className="text-muted-foreground list-disc pl-5 text-xs">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Drilling the specific sub-points an answer missed (PRD §7).
 *
 * Graded, never scored: it is practice on a known gap, so it cannot promote
 * the concept — the ladder still has to be climbed.
 */
function PracticeDrill({
  cardId,
  points,
  onClose,
}: {
  cardId: string;
  points: string[];
  onClose: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<TypedGrade | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium">
        Just this part — no score either way:
      </p>
      <ul className="text-muted-foreground list-disc pl-5 text-xs">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>

      <Textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        className="min-h-16 text-sm"
        placeholder="Try just the missing piece…"
        disabled={busy}
      />

      {result ? (
        <p className="text-sm">
          {result.verdict === "correct" ? "That's it." : result.feedback}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || answer.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            setResult(await practiceMissedPoints(cardId, answer, points));
            setBusy(false);
          }}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Check
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

function RoundSummary({
  status,
  onNext,
  onFinish,
}: {
  status: LearnStatus;
  onNext: () => Promise<void>;
  onFinish: () => Promise<void>;
}) {
  const last = status.roundNumber >= status.roundCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Round {status.roundNumber} complete
        </CardTitle>
        <CardDescription>
          {status.mastered} concept{status.mastered === 1 ? "" : "s"} recalled
          without help
          {status.struggled > 0
            ? `, ${status.struggled} set aside after repeated misses`
            : ""}
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={() => void onNext()}>
          {last ? "Keep going — recycle the deck" : "Next round"}
        </Button>
        <Button variant="outline" onClick={() => void onFinish()}>
          Finish session
        </Button>
      </CardContent>
    </Card>
  );
}

const MODE_CHOICES: { mode: LearnModeName; title: string; body: string }[] = [
  {
    mode: "longterm",
    title: "Long-term",
    body: "Spaced repetition, like Anki: reviews spread out over days and weeks so it sticks for the final.",
  },
  {
    mode: "cram",
    title: "Cram",
    body: "Exam in a day or two: tighter repeats, an extra check on anything missed, and every card back tomorrow.",
  },
];

function LearnPicker({
  topics,
  cards,
  cardCount,
  dueCount,
  onStart,
}: {
  topics: string[];
  cards: StartCard[];
  cardCount: number;
  dueCount: number;
  onStart: (filter: {
    scope: StudyScope;
    topic: string | null;
    shuffled: boolean;
    roundSize: number;
    includeApplication: boolean;
    mode: LearnModeName;
    startAt: string | null;
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<LearnModeName>("longterm");
  const [startAt, setStartAt] = useState<StartCard | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [scope, setScope] = useState<StudyScope>("all");
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [roundSizeText, setRoundSizeText] = useState(String(DEFAULT_ROUND_SIZE));
  const roundSize = clampRoundSize(Number(roundSizeText || DEFAULT_ROUND_SIZE));
  const [application, setApplication] = useState(true);
  const [starting, setStarting] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Start learning</CardTitle>
        <CardDescription>
          Each concept is introduced as a multiple choice question, then typed
          from memory, then asked again after other concepts have intervened.
          Typing an answer you were just shown does not count as knowing it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Study mode">
          {MODE_CHOICES.map((choice) => (
            <button
              key={choice.mode}
              type="button"
              role="radio"
              aria-checked={mode === choice.mode}
              onClick={() => setMode(choice.mode)}
              className={`focus-visible:ring-ring rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                mode === choice.mode
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/60"
              }`}
            >
              <span className="block text-sm font-medium">{choice.title}</span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {choice.body}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as StudyScope)}
          >
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Whole deck</SelectItem>
              <SelectItem value="topic" disabled={topics.length === 0}>
                By topic
              </SelectItem>
              <SelectItem value="due" disabled={dueCount === 0}>
                Due for review{dueCount > 0 ? ` (${dueCount})` : ""}
              </SelectItem>
              <SelectItem value="starred">Starred</SelectItem>
              <SelectItem value="missed">Missed</SelectItem>
            </SelectContent>
          </Select>

          {scope === "topic" ? (
            <Select value={topic} onValueChange={setTopic}>
              <SelectTrigger className="sm:w-48">
                <SelectValue placeholder="Pick a topic" />
              </SelectTrigger>
              <SelectContent>
                {topics.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="flex items-center gap-2">
            <Input
              id="learn-round-size"
              type="number"
              inputMode="numeric"
              min={MIN_ROUND_SIZE}
              max={MAX_ROUND_SIZE}
              value={roundSizeText}
              onChange={(event) => setRoundSizeText(event.target.value)}
              onBlur={() => setRoundSizeText(String(roundSize))}
              className="w-20"
            />
            <Label htmlFor="learn-round-size" className="font-normal whitespace-nowrap">
              concepts per round
            </Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="learn-application"
            checked={application}
            onCheckedChange={(value) => setApplication(value === true)}
          />
          <Label
            htmlFor="learn-application"
            className="text-muted-foreground text-sm font-normal"
          >
            Include application / higher-order questions
          </Label>
        </div>

        <StartAtPicker
          cards={cards}
          selected={startAt}
          open={browsing}
          onOpenChange={setBrowsing}
          onSelect={(card) => {
            setStartAt(card);
            setBrowsing(false);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={cardCount === 0 || starting}
            onClick={async () => {
              setStarting(true);
              await onStart({
                scope,
                topic: scope === "topic" ? topic : null,
                shuffled: false,
                roundSize,
                includeApplication: application,
                mode,
                startAt: startAt?.id ?? null,
              });
              setStarting(false);
            }}
          >
            Start learning
          </Button>
          <span className="text-muted-foreground text-sm">
            {cardCount} cards available
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Begin anywhere in the deck: the cards in lecture order, grouped under their
 * topics, to scroll through and pick the one to start from.
 */
function StartAtPicker({
  cards,
  selected,
  open,
  onOpenChange,
  onSelect,
}: {
  cards: StartCard[];
  selected: StartCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (card: StartCard | null) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) selectedRef.current?.scrollIntoView({ block: "center" });
  }, [open]);

  if (cards.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {selected ? (
          <>
            <span>
              Starting at{" "}
              <span className="font-medium">#{selected.number}</span>
              <span className="text-muted-foreground">
                {" "}
                — {truncate(selected.question, 70)}
              </span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              Start from the beginning
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => onOpenChange(!open)}>
          {open
            ? "Close"
            : selected
              ? "Choose a different card"
              : "Start at a specific card"}
        </Button>
      </div>

      {open ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {cards.map((card, index) => {
            const heading =
              index === 0 || cards[index - 1].topic !== card.topic
                ? (card.topic ?? "Untitled")
                : null;
            const isSelected = selected?.id === card.id;
            return (
              <div key={card.id}>
                {heading ? (
                  <div className="bg-muted/80 text-muted-foreground sticky top-0 px-3 py-1.5 text-xs font-medium backdrop-blur">
                    {heading}
                  </div>
                ) : null}
                <button
                  ref={isSelected ? selectedRef : undefined}
                  type="button"
                  onClick={() => onSelect(card)}
                  className={`flex w-full gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 ${
                    isSelected ? "bg-primary/10" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="text-muted-foreground w-10 shrink-0 font-mono text-xs leading-5">
                    #{card.number}
                  </span>
                  <span className="min-w-0">{card.question}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
