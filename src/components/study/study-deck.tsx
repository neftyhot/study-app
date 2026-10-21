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
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FileText,
  Pencil,
  Shuffle,
  Sparkles,
  Star,
  Volume2,
  VolumeX,
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
import { CardStyleSwitch } from "@/components/study/card-style-switch";
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
import { canReadAloud, readAloud, speechText, stopReading } from "@/lib/speech/read-aloud";
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
  /** Scheduled for review today or earlier. */
  due?: boolean;
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
  /** The latest grade each card got in this session. */
  cardGrades: Record<string, Grade>;
};

type Counts = Record<Grade, number>;

/**
 * The tally after a card gets `grade`, given the grade it already had in this
 * session, if any. A regrade moves the card between counters instead of
 * counting it twice, matching what the server stores.
 */
function retally(counts: Counts, previous: Grade | undefined, grade: Grade): Counts {
  const next = { ...counts };
  if (previous) next[previous] = Math.max(0, next[previous] - 1);
  next[grade] += 1;
  return next;
}

/**
 * Stored positions index the session's full card order; the deck on screen
 * drops cards deleted since, so the two are converted at the boundary.
 */
function toQueueIndex(order: string[], live: (id: string) => boolean, stored: number) {
  return order.slice(0, stored).filter(live).length;
}

function toStoredIndex(order: string[], live: (id: string) => boolean, index: number) {
  let seen = 0;
  for (let i = 0; i < order.length; i++) {
    if (!live(order[i])) continue;
    if (seen === index) return i;
    seen++;
  }
  return order.length;
}

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
  const [position, setPosition] = useState(() =>
    initialSession
      ? toQueueIndex(
          initialSession.cardOrder,
          (id) => cards.some((card) => card.id === id),
          initialSession.position,
        )
      : 0,
  );
  const [revealed, setRevealed] = useState(false);
  const [detail, setDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [format, setFormat] = useState<FlashcardFormat>(initialFormat);
  const [calcOpen, setCalcOpen] = useState(false);
  const calcRef = useRef<CalculatorHandle>(null);
  const [counts, setCounts] = useState<Counts>({
    missed: initialSession?.missedCount ?? 0,
    difficult: initialSession?.difficultCount ?? 0,
    easy: initialSession?.easyCount ?? 0,
  });
  // Read and written synchronously, so two quick grades both see the first.
  const gradesRef = useRef<Record<string, Grade>>({
    ...(initialSession?.cardGrades ?? {}),
  });

  const tally = useCallback((cardId: string, value: Grade) => {
    const previous = gradesRef.current[cardId];
    gradesRef.current[cardId] = value;
    setCounts((prev) => retally(prev, previous, value));
  }, []);

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

  // "No clue" brings a card back later in the run, so the queue can hold a
  // card twice. Every count the student sees is of distinct cards.
  const uniqueTotal = useMemo(() => new Set(queue).size, [queue]);
  const uniqueSeen = useMemo(
    () => new Set(queue.slice(0, position + 1)).size,
    [queue, position],
  );
  const secondLook = current ? queue.indexOf(current.id) < position : false;

  const storedIndex = useCallback(
    (index: number) =>
      session ? toStoredIndex(session.cardOrder, (id) => byId.has(id), index) : index,
    [session, byId],
  );

  const move = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 0), queue.length);
      setPosition(clamped);
      setRevealed(false);
      setDetail(false);
      setEditing(false);
      if (session) void saveStudyPosition(session.id, storedIndex(clamped));
    },
    [queue.length, session, storedIndex],
  );

  const grade = useCallback(
    (value: Grade) => {
      if (!current || !revealed) return;

      void gradeStudyCard(current.id, value, session?.id ?? null);
      tally(current.id, value);
      setDeck((prev) =>
        prev.map((card) =>
          card.id === current.id ? { ...card, lastGrade: value } : card,
        ),
      );
      move(position + 1);
    },
    [current, revealed, session, move, position, tally],
  );

  /** "I know it": credit it and move on without flipping the card. */
  const knowIt = useCallback(() => {
    if (!current) return;
    void skipKnown(current.id, session?.id ?? null);
    tally(current.id, "easy");
    setDeck((prev) =>
      prev.map((card) =>
        card.id === current.id ? { ...card, lastGrade: "easy" } : card,
      ),
    );
    move(position + 1);
  }, [current, session, move, position, tally]);

  /** "No clue": show the answer, mark it missed, see it again this session. */
  const noClue = useCallback(async () => {
    if (!current) return;
    setRevealed(true);
    setDetail(true);

    tally(current.id, "missed");
    const result = await skipUnknown(
      current.id,
      session?.id ?? null,
      storedIndex(position),
    );
    setDeck((prev) =>
      prev.map((card) =>
        card.id === current.id ? { ...card, lastGrade: "missed" } : card,
      ),
    );

    // The card was re-inserted further down the queue; take the new order.
    if (result.cardOrder) {
      const order = result.cardOrder;
      setSession((prev) => (prev ? { ...prev, cardOrder: order } : prev));
    }
  }, [current, session, position, storedIndex, tally]);

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

  // Read aloud: the side being shown. Hidden where the system has no voices;
  // stops when the card changes so it never reads the next card's answer.
  const [canSpeak, setCanSpeak] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanSpeak(canReadAloud());
  }, []);
  useEffect(() => {
    stopReading();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeaking(false);
  }, [current?.id, revealed]);
  useEffect(() => () => stopReading(), []);
  const speak = useCallback(() => {
    if (!current || !canSpeak) return;
    if (speaking) {
      stopReading();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    readAloud(speechText(current, revealed ? "answer" : "question"), () => setSpeaking(false));
  }, [canSpeak, current, revealed, speaking]);

  // Keyboard shortcuts (PRD §4). Suppressed while typing so editing a card
  // does not grade it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        editing ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        target?.tagName === "SELECT" ||
        // Cmd+S, Ctrl+E and the like belong to the app, and keys pressed in
        // an open dialog or menu belong to it, not the card behind it.
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest?.("[role=dialog],[role=alertdialog],[role=menu]")
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
        case "r":
        case "R":
          speak();
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, editing, grade, knowIt, move, noClue, position, speak, star]);

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
    if (started.cardOrder.length === 0) {
      // Nothing to study: close it rather than open straight onto "done".
      void finishStudySession(started.id);
      toast.error("No cards match that filter");
      return;
    }
    setSession({
      ...started,
      scope: filter.scope,
      topic: filter.topic,
      shuffled: filter.shuffled,
      missedCount: 0,
      difficultCount: 0,
      easyCount: 0,
      cardGrades: {},
    });
    setCounts({ missed: 0, difficult: 0, easy: 0 });
    gradesRef.current = {};
    setPosition(0);
    setRevealed(false);
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
        total={uniqueTotal}
        onRestart={() => {
          // Closed so the next visit does not reopen the finished deck.
          void finishStudySession(session.id);
          setSession(null);
        }}
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
      {current.topic ? <Badge variant="secondary">{current.topic}</Badge> : null}
      <Badge variant="outline">{current.cardType}</Badge>
      {current.isUserEdited ? <Badge variant="outline">edited</Badge> : null}
    </div>
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-2">
      {badges}
      <div className="flex gap-1">
        {canSpeak ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={speak}
            aria-pressed={speaking}
            aria-label={speaking ? "Stop reading" : revealed ? "Read the answer aloud (R)" : "Read the question aloud (R)"}
            title={speaking ? "Stop reading" : "Read aloud (R)"}
          >
            {speaking ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
        ) : null}
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

  // Math help — the card's numbers and a calculator — only on cards with numbers.
  const tools = (
    <NumbersPanel
      key={current.id}
      rows={numbers}
      onPick={(value) => calcRef.current?.insert(value)}
      calculatorOpen={calcOpen}
      onCalculatorChange={setCalcOpen}
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
      <div className="mx-auto w-full max-w-lg space-y-4">
        {header}
        <FlipCard
          cardKey={current.id}
          revealed={revealed}
          onToggle={() => setRevealed((value) => !value)}
          front={
            <>
              <FaceLabel side="Question" topic={current.topic} />
              <CardQuestion
                card={current}
                className="text-xl leading-snug font-medium break-words sm:text-2xl"
              />
              {current.frontImage ? <CardImage cardId={current.id} side="front" /> : null}
              <p className="text-muted-foreground absolute inset-x-0 bottom-3 text-center text-xs">
                Click to flip · <kbd>space</kbd>
              </p>
            </>
          }
          back={
            <>
              <FaceLabel side="Answer" topic={current.topic} />
              {back}
            </>
          }
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
        <Progress aria-label="Progress through this deck" value={(position / Math.max(queue.length, 1)) * 100} />
        <div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
          <span title={`Card #${current.number} in lecture order`}>
            Card {uniqueSeen} of {uniqueTotal}
            {secondLook ? " · second look" : ""}
            {session.shuffled ? " · shuffled" : ""}
            {session.topic ? ` · ${session.topic}` : ""}
          </span>
          <span>
            {counts.missed} missed · {counts.difficult} difficult ·{" "}
            {counts.easy} easy
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <CardStyleSwitch
          value={format}
          onChange={(option) => {
            setFormat(option);
            setRevealed(false);
          }}
        />
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
  // The page's count, narrowed to the cards this filter still allows.
  const due = cards.some((card) => card.due !== undefined)
    ? testable.filter((card) => card.due).length
    : dueCount;
  const available = {
    all: testable.length,
    topic: testable.filter((card) => card.topic === topic).length,
    starred: testable.filter((card) => card.starred).length,
    missed: testable.filter((card) => card.lastGrade === "missed").length,
    due,
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
              <SelectItem value="due" disabled={due === 0}>
                Due for review{due > 0 ? ` (${due})` : ""}
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
              ? ` — today's session will take ${reviewCap === 1 ? "only the most overdue card" : `the ${reviewCap} longest overdue`}`
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
  counts: Counts;
  total: number;
  onFinish: () => Promise<void>;
  onRestart: () => void;
}) {
  // A session resumed from before grades were tracked per card can hold more
  // grades than cards; never claim more than were in the deck.
  const graded = Math.min(counts.missed + counts.difficult + counts.easy, total);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Session complete</CardTitle>
        <CardDescription>
          {graded} of {total} {total === 1 ? "card" : "cards"} graded —{" "}
          {counts.missed} missed,{" "}
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

/** The small heading in a flip card's corner, so a face is never bare. */
function FaceLabel({ side, topic }: { side: string; topic: string | null }) {
  return (
    <div className="text-muted-foreground absolute inset-x-5 top-4 flex justify-between gap-3 text-[11px] font-medium tracking-wide uppercase">
      <span>{side}</span>
      {topic ? <span className="truncate">{topic}</span> : null}
    </div>
  );
}
