"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Pencil,
  Shuffle,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  beginStudySession,
  finishStudySession,
  gradeStudyCard,
  saveStudyPosition,
  toggleCardStar,
} from "@/lib/study/actions";

export type StudyCardView = {
  id: string;
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  starred: boolean;
  excluded: boolean;
  isUserEdited: boolean;
  /** An earlier edit is still restorable. */
  canUndo: boolean;
  hasAiSupplement: boolean;
  essentialPoints: string[];
  lastGrade: Grade | null;
  source: {
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
  session: initialSession,
}: {
  examId: string;
  cards: StudyCardView[];
  topics: string[];
  dueCount: number;
  session: SessionView | null;
}) {
  const [deck, setDeck] = useState(cards);
  const [session, setSession] = useState(initialSession);
  const [position, setPosition] = useState(initialSession?.position ?? 0);
  const [revealed, setRevealed] = useState(false);
  const [detail, setDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
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
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, editing, grade, move, position, star]);

  async function start(filter: {
    scope: StudyScope;
    topic: string | null;
    shuffled: boolean;
  }) {
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

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {current.topic ? (
                <Badge variant="secondary">{current.topic}</Badge>
              ) : null}
              <Badge variant="outline">{current.cardType}</Badge>
              {current.isUserEdited ? (
                <Badge variant="outline">edited</Badge>
              ) : null}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={star}
                aria-label={current.starred ? "Unstar card" : "Star card"}
              >
                <Star
                  className={
                    current.starred ? "size-4 fill-current" : "size-4"
                  }
                />
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
        </CardHeader>

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
              <p className="text-lg leading-snug font-medium break-words">
                {current.question}
              </p>

              {revealed ? (
                <div className="space-y-3">
                  <p className="text-base break-words">
                    {current.directAnswer}
                  </p>

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
                            <p className="text-muted-foreground">
                              {current.fullExplanation}
                              {current.hasAiSupplement ? (
                                <Badge
                                  variant="outline"
                                  className="ml-2 gap-1 align-middle"
                                >
                                  <Sparkles className="size-3" />
                                  AI context
                                </Badge>
                              ) : null}
                            </p>
                          ) : null}
                          {current.essentialPoints.length > 0 ? (
                            <div>
                              <p className="text-xs font-medium">
                                Must include
                              </p>
                              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                                {current.essentialPoints.map((point) => (
                                  <li key={point}>{point}</li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setRevealed(true)}
                  className="w-full"
                >
                  Show answer
                  <kbd className="text-muted-foreground ml-1 text-xs">space</kbd>
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {revealed && !editing ? (
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
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
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

      <Dialog open={sourceOpen} onOpenChange={setSourceOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{current.source?.label}</DialogTitle>
            <DialogDescription>
              The exact source this card was built from.
            </DialogDescription>
          </DialogHeader>

          {current.source?.excerpt ? (
            <blockquote className="border-l-2 pl-3 text-sm italic break-words">
              {current.source.excerpt}
            </blockquote>
          ) : null}

          <div className="bg-muted/50 space-y-2 rounded p-3 text-sm">
            {current.source?.title ? (
              <p className="font-medium">{current.source.title}</p>
            ) : null}
            <p className="whitespace-pre-wrap">{current.source?.text}</p>
            {current.source?.speakerNotes ? (
              <p className="text-muted-foreground whitespace-pre-wrap text-xs">
                Speaker notes: {current.source.speakerNotes}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeckPicker({
  cards,
  topics,
  dueCount,
  onStart,
}: {
  cards: StudyCardView[];
  topics: string[];
  dueCount: number;
  onStart: (filter: {
    scope: StudyScope;
    topic: string | null;
    shuffled: boolean;
  }) => Promise<void>;
}) {
  const [scope, setScope] = useState<StudyScope>("all");
  const [topic, setTopic] = useState<string>(topics[0] ?? "");
  const [shuffled, setShuffled] = useState(false);
  const [starting, setStarting] = useState(false);

  const testable = cards.filter((card) => !card.excluded);
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
          Space reveals the answer, 1/2/3 grades it, arrows move, S stars, E
          edits.
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

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={available === 0 || starting}
            onClick={async () => {
              setStarting(true);
              await onStart({
                scope,
                topic: scope === "topic" ? topic : null,
                shuffled,
              });
              setStarting(false);
            }}
          >
            Start studying
          </Button>
          <span className="text-muted-foreground text-sm">
            {available} card{available === 1 ? "" : "s"} in this deck
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
