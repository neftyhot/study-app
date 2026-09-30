"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FileText,
  Pencil,
  Shuffle,
  Sparkles,
  Star,
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
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Grade } from "@/lib/study/grade";
import type { StudyScope } from "@/lib/study/queue";
import { CardEditor } from "@/components/cards/card-editor";
import { SourceViewer } from "@/components/sources/source-viewer";
import { CardImage, CardQuestion } from "@/components/cards/card-face";
import {
  CalculationsBox,
  CalculatorPanel,
  NumbersPanel,
  cardNumberRows,
  type CalculatorHandle,
} from "@/components/cards/number-tools";
import { FlipCard, SwipeCard } from "@/components/study/card-formats";
import { FlashcardFormatPreview } from "@/components/study/format-preview";
import {
  DEFAULT_FLASHCARD_FORMAT,
  FLASHCARD_FORMATS,
  FLASHCARD_FORMAT_LABELS,
  type FlashcardFormat,
} from "@/lib/settings-shared";
import { setFlashcardFormat } from "@/lib/settings-actions";
import type { CalculationStep, NumberGiven } from "@/lib/primer/types";
import { cn } from "@/lib/utils";
import {
  ExplainButton,
  MisconceptionList,
} from "@/components/cards/explain-button";
import {
  beginStudySession,
  finishStudySession,
  gradeStudyCard,
  saveStudyPosition,
  skipKnown,
  skipUnknown,
  toggleCardStar,
} from "@/lib/study/actions";

export type StudyCardView = {
  id: string;
  /** Position in lecture order, as the card list and the tutor number it. */
  number: number;
  topic: string | null;
  question: string;
  directAnswer: string;
  /** Whether the card carries an attached picture on each side. */
  frontImage?: boolean;
  backImage?: boolean;
  fullExplanation: string | null;
  cardType: string;
  starred: boolean;
  excluded: boolean;
  isUserEdited: boolean;
  /** An earlier edit is still restorable. */
  canUndo: boolean;
  hasAiSupplement: boolean;
  essentialPoints: string[];
  /** Empty until an explanation is written, by a full run or on request. */
  commonMisconceptions?: string[];
  lastGrade: Grade | null;
  /** Every number the question needs, each with what it is. */
  givens?: NumberGiven[];
  /** The working from those numbers to the answer, step by step. */
  calculations?: CalculationStep[];
  source: {
    slideId: string;
    label: string;
    excerpt: string | null;
    title: string | null;
    text: string;
    speakerNotes: string | null;
  } | null;
};

export type SessionView = {
  id: string;
  cardOrder: string[];
  position: number;
  scope: StudyScope;
  topic: string | null;
  shuffled: boolean;
  missedCount: number;
  difficultCount: number;
  easyCount: number;
};

const GRADE_LABELS: Record<Grade, string> = {
  missed: "Missed",
  difficult: "Difficult",
  easy: "Easy",
};

export function StudyDeck({
  examId,
  cards,
  topics,
  dueCount,
  reviewCap,
  session: initialSession,
  initialFormat = DEFAULT_FLASHCARD_FORMAT,
}: {
  examId: string;
  cards: StudyCardView[];
  topics: string[];
  dueCount: number;
  reviewCap: number | null;
  session: SessionView | null;
  initialFormat?: FlashcardFormat;
}) {
  const [deck, setDeck] = useState(cards);
  const [session, setSession] = useState(initialSession);
  const [position, setPosition] = useState(initialSession?.position ?? 0);
  const [revealed, setRevealed] = useState(false);
  const [detail, setDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [format, setFormat] = useState<FlashcardFormat>(initialFormat);
  const [calcOpen, setCalcOpen] = useState(false);
  const calcRef = useRef<CalculatorHandle>(null);
  const [counts, setCounts] = useState({
    missed: initialSession?.missedCount ?? 0,
    difficult: initialSession?.difficultCount ?? 0,
    easy: initialSession?.easyCount ?? 0,
  });

  // True only for the session handed over by the server: once the student
  // starts a new deck in this tab there is nothing to resume.
  const resumed =
    session?.id === initialSession?.id && (initialSession?.position ?? 0) > 0;

  const byId = useMemo(
    () => new Map(deck.map((card) => [card.id, card])),
    [deck],
  );

  // A session's queue can outlive the cards in it; drop ids that no longer
  // resolve rather than resuming onto a blank card.
  const queue = useMemo(
    () => (session?.cardOrder ?? []).filter((id) => byId.has(id)),
    [session, byId],
  );

  const current = position < queue.length ? byId.get(queue[position]) : undefined;

  const move = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), queue.length);
      setPosition(clamped);
      setRevealed(false);
      setDetail(false);
      setEditing(false);
      if (session) void saveStudyPosition(session.id, clamped);
    },
    [queue.length, session],
  );

  const grade = useCallback(
    (value: Grade) => {
      if (!current || !revealed) return;

      void gradeStudyCard(current.id, value, session?.id ?? null);
      setCounts((prev) => ({ ...prev, [value]: prev[value] + 1 }));
      setDeck((prev) =>
        prev.map((card) =>
          card.id === current.id ? { ...card, lastGrade: value } : card,
        ),
      );
      move(position + 1);
    },
    [current, revealed, session, move, position],
  );

  /** "I know it": credit it and move on without flipping the card. */
  const knowIt = useCallback(() => {
    if (!current) return;
    void skipKnown(current.id, session?.id ?? null);
    setCounts((prev) => ({ ...prev, easy: prev.easy + 1 }));
    setDeck((prev) =>
      prev.map((card) =>
        card.id === current.id ? { ...card, lastGrade: "easy" } : card,
      ),
    );
    move(position + 1);
  }, [current, session, move, position]);

  /** "No clue": show the answer, mark it missed, see it again this session. */
  const noClue = useCallback(async () => {
    if (!current) return;
    setRevealed(true);
    setDetail(true);

    const result = await skipUnknown(current.id, session?.id ?? null);
    setCounts((prev) => ({ ...prev, missed: prev.missed + 1 }));
    setDeck((prev) =>
      prev.map((card) =>
        card.id === current.id ? { ...card, lastGrade: "missed" } : card,
      ),
    );

    // The card was re-inserted further down the queue; take the new order.
    if (result.cardOrder && session) {
      setSession({ ...session, cardOrder: result.cardOrder });
    }
  }, [current, session]);

  const star = useCallback(() => {
    if (!current) return;
    const id = current.id;
    setDeck((prev) =>
      prev.map((card) =>
        card.id === id ? { ...card, starred: !card.starred } : card,
      ),
    );
    void toggleCardStar(id);
  }, [current]);

  // Keyboard shortcuts (PRD §4). Suppressed while typing so editing a card
  // does not grade it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        editing ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!current) return;

      switch (event.key) {
        case " ":
          event.preventDefault();
          setRevealed((value) => !value);
          break;
        case "1":
          grade("missed");
          break;
        case "2":
          grade("difficult");
          break;
        case "3":
          grade("easy");
          break;
        case "ArrowRight":
          move(position + 1);
          break;
        case "ArrowLeft":
          move(position - 1);
          break;
        case "s":
        case "S":
          star();
          break;
        case "e":
        case "E":
          event.preventDefault();
          setEditing(true);
          break;
        case "k":
        case "K":
          knowIt();
          break;
        case "d":
        case "D":
          void noClue();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, editing, grade, knowIt, move, noClue, position, star]);

  async function start(
    filter: {
      scope: StudyScope;
      topic: string | null;
      shuffled: boolean;
      includeApplication: boolean;
    },
    chosen: FlashcardFormat,
  ) {
    if (chosen !== format) {
      setFormat(chosen);
      // Remembered as the new default, as choosing it in settings would be.
      void setFlashcardFormat(chosen);
    }
    const started = await beginStudySession(examId, filter);
    setSession({
      ...started,
      scope: filter.scope,
      topic: filter.topic,
      shuffled: filter.shuffled,
      missedCount: 0,
      difficultCount: 0,
      easyCount: 0,
    });
    setCounts({ missed: 0, difficult: 0, easy: 0 });
    setPosition(0);
    setRevealed(false);

    if (started.cardOrder.length === 0) {
      toast.error("No cards match that filter");
    }
  }

  if (!session) {
    return (
      <DeckPicker
        cards={deck}
        topics={topics}
        dueCount={dueCount}
        reviewCap={reviewCap}
        format={format}
        onStart={start}
      />
    );
  }

  if (!current) {
    return (
      <SessionSummary
        counts={counts}
        total={queue.length}
        onRestart={() => setSession(null)}
        onFinish={async () => {
          await finishStudySession(session.id);
          setSession(null);
        }}
      />
    );
  }

  const layout: FlashcardFormat = editing ? "classic" : format;
  const numbers = cardNumberRows(current, revealed);
  const remaining = queue.length - position - 1;

  const badges = (
    <div className="flex flex-wrap gap-1.5">
      <Badge variant="outline" className="font-mono">
        #{current.number}
      </Badge>
      {current.topic ? <Badge variant="secondary">{current.topic}</Badge> : null}
      <Badge variant="outline">{current.cardType}</Badge>
      {current.isUserEdited ? <Badge variant="outline">edited</Badge> : null}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      {badges}
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={star}
          aria-label={current.starred ? "Unstar card" : "Star card"}
        >
          <Star className={current.starred ? "size-4 fill-current" : "size-4"} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setEditing(true)}
          aria-label="Edit card"
        >
          <Pencil className="size-4" />
        </Button>
      </div>
    </div>
  );

  // The flip card's front never fills in a cloze card's blanks: its back does.
  const front = (
    <>
      <CardQuestion card={current} revealed={layout === "flip" ? false : revealed} />
      {current.frontImage ? <CardImage cardId={current.id} side="front" /> : null}
    </>
  );

  // A calculator on every card, and every number the card mentions.
  const tools = (
    <NumbersPanel
      rows={numbers}
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
  );

  const back = (
    <div className="space-y-3 text-left">
      {layout === "flip" && current.cardType === "cloze" ? (
        <CardQuestion card={current} revealed />
      ) : null}

      <p className="text-base break-words">{current.directAnswer}</p>

      {current.backImage ? <CardImage cardId={current.id} side="back" /> : null}

      <CalculationsBox steps={current.calculations ?? []} />

      {!current.fullExplanation ? (
        <ExplainButton
          key={current.id}
          cardId={current.id}
          onExplained={(result) => {
            setDeck((prev) =>
              prev.map((card) =>
                card.id === result.cardId
                  ? {
                      ...card,
                      fullExplanation: result.fullExplanation,
                      hasAiSupplement: result.hasAiSupplement,
                      commonMisconceptions: result.commonMisconceptions,
                    }
                  : card,
              ),
            );
            setDetail(true);
          }}
        />
      ) : null}

      {current.fullExplanation || current.essentialPoints.length ? (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="px-0"
            onClick={() => setDetail((value) => !value)}
          >
            {detail ? "Hide detail" : "More detail"}
          </Button>

          {detail ? (
            <div className="space-y-2 pt-1 text-sm">
              {current.fullExplanation ? (
                <p className="text-muted-foreground whitespace-pre-line">
                  {current.fullExplanation}
                  {current.hasAiSupplement ? (
                    <Badge variant="outline" className="ml-2 gap-1 align-middle">
                      <Sparkles className="size-3" />
                      AI context
                    </Badge>
                  ) : null}
                </p>
              ) : null}
              {current.essentialPoints.length > 0 ? (
                <div>
                  <p className="text-xs font-medium">Must include</p>
                  <ul className="text-muted-foreground list-disc pl-5 text-xs">
                    {current.essentialPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <MisconceptionList items={current.commonMisconceptions ?? []} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const revealControls = (
    <div className="space-y-2">
      <Button
        variant="secondary"
        onClick={() => setRevealed(true)}
        className="w-full"
      >
        {layout === "flip" ? "Flip card" : "Show answer"}
        <kbd className="text-muted-foreground ml-1 text-xs">space</kbd>
      </Button>

      {/* Skipping without flipping: the two honest shortcuts. */}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" className="text-xs sm:text-sm" onClick={knowIt}>
          <CircleCheck className="size-4" />
          I know it
          <kbd className="ml-1 text-xs opacity-70">k</kbd>
        </Button>
        <Button
          variant="outline"
          className="text-xs sm:text-sm"
          onClick={() => void noClue()}
        >
          <CircleHelp className="size-4" />
          No clue
          <kbd className="ml-1 text-xs opacity-70">d</kbd>
        </Button>
      </div>
    </div>
  );

  const gradeButtons =
    revealed && !editing ? (
      <div className="grid grid-cols-3 gap-2">
        {(["missed", "difficult", "easy"] as const).map((value, i) => (
          <Button
            key={value}
            variant={value === "missed" ? "destructive" : "outline"}
            className="text-xs sm:text-sm"
            onClick={() => grade(value)}
          >
            {GRADE_LABELS[value]}
            <kbd className="ml-1 text-xs opacity-70">{i + 1}</kbd>
          </Button>
        ))}
      </div>
    ) : null;

  let body: ReactNode;
  if (layout === "flip") {
    body = (
      <div className="mx-auto w-full max-w-xl space-y-4">
        {header}
        <FlipCard
          cardKey={current.id}
          revealed={revealed}
          onToggle={() => setRevealed((value) => !value)}
          front={
            <>
              {front}
              <p className="text-muted-foreground text-xs">Click the card to flip it</p>
            </>
          }
          back={back}
        />
        {tools}
        {revealed ? gradeButtons : revealControls}
      </div>
    );
  } else if (layout === "stack") {
    body = (
      <div className="mx-auto w-full max-w-xl space-y-4">
        {header}
        <SwipeCard
          cardKey={current.id}
          revealed={revealed}
          behind={Math.min(remaining, 2)}
          onReveal={() => setRevealed(true)}
          onSwipe={(direction) => grade(direction === "right" ? "easy" : "missed")}
        >
          {front}
          {revealed ? (
            <>
              {back}
              <p className="text-muted-foreground text-xs">
                Drag right if you knew it, left if you missed it, or use the buttons.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Tap the card to see the answer</p>
          )}
        </SwipeCard>
        {tools}
        {revealed ? gradeButtons : revealControls}
      </div>
    );
  } else {
    body = (
      <>
        <Card>
          <CardHeader>{header}</CardHeader>

          <CardContent className="space-y-4">
            {editing ? (
              <CardEditor
                cardId={current.id}
                card={{
                  question: current.question,
                  directAnswer: current.directAnswer,
                  fullExplanation: current.fullExplanation,
                }}
                canUndo={current.canUndo}
                onClose={() => setEditing(false)}
                onSaved={(fields) =>
                  setDeck((prev) =>
                    prev.map((card) =>
                      card.id === current.id
                        ? { ...card, ...fields, isUserEdited: true }
                        : card,
                    ),
                  )
                }
              />
            ) : (
              <>
                {front}
                {tools}
                {revealed ? back : revealControls}
              </>
            )}
          </CardContent>
        </Card>

        {gradeButtons}
      </>
    );
  }

  return (
    <div className="space-y-4">
      {resumed ? (
        <p className="text-muted-foreground text-sm">
          Picked up where you left off, same deck and same order.
        </p>
      ) : null}

      <div className="space-y-2">
        <Progress value={(position / Math.max(queue.length, 1)) * 100} />
        <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
          <span>
            Card {position + 1} of {queue.length}
            {session.shuffled ? " · shuffled" : ""}
            {session.topic ? ` · ${session.topic}` : ""}
          </span>
          <span>
            {counts.missed} missed · {counts.difficult} difficult ·{" "}
            {counts.easy} easy
          </span>
        </div>
      </div>

      {body}

      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2",
          layout !== "classic" && "mx-auto w-full max-w-xl",
        )}
      >
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => move(position - 1)}
            disabled={position === 0}
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          <Button variant="ghost" size="sm" onClick={() => move(position + 1)}>
            Skip
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await finishStudySession(session.id);
              setSession(null);
            }}
          >
            New deck
          </Button>
        </div>

        {current.source ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSourceOpen(true)}
          >
            <FileText className="size-4" />
            Show original slide
          </Button>
        ) : null}
      </div>

      <SourceViewer
        slideId={current.source?.slideId ?? null}
        excerpt={current.source?.excerpt}
        open={sourceOpen}
        onOpenChange={setSourceOpen}
      />

      <CalculatorPanel ref={calcRef} open={calcOpen} onOpenChange={setCalcOpen} />
    </div>
  );
}

function DeckPicker({
  cards,
  topics,
  dueCount,
  reviewCap,
  format: savedFormat,
  onStart,
}: {
  cards: StudyCardView[];
  topics: string[];
  dueCount: number;
  /** Reviews the stated daily budget allows, if one is set. */
  reviewCap: number | null;
  format: FlashcardFormat;
  onStart: (
    filter: {
      scope: StudyScope;
      topic: string | null;
      shuffled: boolean;
      includeApplication: boolean;
    },
    format: FlashcardFormat,
  ) => Promise<void>;
}) {
  const [format, setFormat] = useState<FlashcardFormat>(savedFormat);
  const [scope, setScope] = useState<StudyScope>("all");
  const [topic, setTopic] = useState<string>(topics[0] ?? "");
  const [shuffled, setShuffled] = useState(false);
  const [application, setApplication] = useState(true);
  const [starting, setStarting] = useState(false);

  const testable = cards.filter(
    (card) =>
      !card.excluded && (application || card.cardType !== "application"),
  );
  const applicationCount = cards.filter(
    (card) => !card.excluded && card.cardType === "application",
  ).length;
  const available = {
    all: testable.length,
    topic: testable.filter((card) => card.topic === topic).length,
    starred: testable.filter((card) => card.starred).length,
    missed: testable.filter((card) => card.lastGrade === "missed").length,
    due: dueCount,
  }[scope];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Start a session</CardTitle>
        <CardDescription>
          Space reveals the answer, 1/2/3 grades it, K skips one you know, D
          reveals one you do not, arrows move, S stars, E edits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as StudyScope)}
          >
            <SelectTrigger className="sm:w-56">
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
              <SelectTrigger className="sm:w-56">
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
            <Checkbox
              id="shuffle"
              checked={shuffled}
              onCheckedChange={(value) => setShuffled(value === true)}
            />
            <Label htmlFor="shuffle" className="text-sm font-normal">
              <Shuffle className="size-3.5" />
              Shuffle
            </Label>
          </div>
        </div>

        {applicationCount > 0 ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="study-application"
              checked={application}
              onCheckedChange={(value) => setApplication(value === true)}
            />
            <Label
              htmlFor="study-application"
              className="text-muted-foreground text-sm font-normal"
            >
              Include {applicationCount} application question
              {applicationCount === 1 ? "" : "s"}
            </Label>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="flashcard-format" className="text-sm font-normal">
              Card style
            </Label>
            <Select
              value={format}
              onValueChange={(value) => setFormat(value as FlashcardFormat)}
            >
              <SelectTrigger id="flashcard-format" className="sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLASHCARD_FORMATS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FLASHCARD_FORMAT_LABELS[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {format !== DEFAULT_FLASHCARD_FORMAT ? (
            <FlashcardFormatPreview key={format} format={format} />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={available === 0 || starting}
            onClick={async () => {
              setStarting(true);
              await onStart(
                {
                  scope,
                  topic: scope === "topic" ? topic : null,
                  shuffled,
                  includeApplication: application,
                },
                format,
              );
              setStarting(false);
            }}
          >
            Start studying
          </Button>
          <span className="text-muted-foreground text-sm">
            {available} card{available === 1 ? "" : "s"} in this deck
            {scope === "due" && reviewCap && available > reviewCap
              ? ` — today's session will take the ${reviewCap} longest overdue`
              : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionSummary({
  counts,
  total,
  onFinish,
  onRestart,
}: {
  counts: { missed: number; difficult: number; easy: number };
  total: number;
  onFinish: () => Promise<void>;
  onRestart: () => void;
}) {
  const graded = counts.missed + counts.difficult + counts.easy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Session complete</CardTitle>
        <CardDescription>
          {graded} of {total} cards graded — {counts.missed} missed,{" "}
          {counts.difficult} difficult, {counts.easy} easy.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={() => void onFinish()}>Finish</Button>
        <Button variant="outline" onClick={onRestart}>
          Start another deck
        </Button>
      </CardContent>
    </Card>
  );
}
