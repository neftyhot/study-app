"use client";

import { useState } from "react";
import { CircleCheck, CircleX, Dices, Loader2 } from "lucide-react";
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
  answerMultipleChoice,
  answerTyped,
  beginLearnSession,
  endLearnSession,
  nextLearnRound,
  skipToTypedRecall,
  type LearnStatus,
  type Reveal,
} from "@/lib/learn/actions";
import type { StudyScope } from "@/lib/study/queue";

const STAGE_LABELS: Record<string, string> = {
  mcq: "Recognize",
  typed_immediate: "Recall",
  typed_interleaved: "Recall after a gap",
  typed_delayed: "Delayed check",
};

export function LearnMode({
  examId,
  topics,
  cardCount,
  initialSessionId,
  initialStatus,
}: {
  examId: string;
  topics: string[];
  cardCount: number;
  initialSessionId: string | null;
  initialStatus: LearnStatus | null;
}) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [status, setStatus] = useState(initialStatus);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [busy, setBusy] = useState(false);
  const [guessing, setGuessing] = useState(false);
  const [typed, setTyped] = useState("");

  if (!sessionId || !status) {
    return (
      <LearnPicker
        topics={topics}
        cardCount={cardCount}
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
    setReveal(result.reveal);
    setStatus(result.status);
  }

  function continueAfterReveal() {
    setReveal(null);
    setTyped("");
    setGuessing(false);
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
            toast.success("Every concept in this deck has been through a round");
            setSessionId(null);
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
            Round {status.roundNumber} of {status.roundCount} ·{" "}
            {status.remaining} concept{status.remaining === 1 ? "" : "s"} left
          </span>
          <span>{status.mastered} recalled without help</span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {prompt.topic ? (
              <Badge variant="secondary">{prompt.topic}</Badge>
            ) : null}
            <Badge variant="outline">{STAGE_LABELS[prompt.stage]}</Badge>
            {/* Being honest about what this attempt can prove. */}
            <Badge variant={prompt.countsTowardMastery ? "default" : "outline"}>
              {prompt.countsTowardMastery ? "Counts" : "Practice"}
            </Badge>
          </div>
          <CardTitle className="pt-2 text-lg leading-snug">
            {prompt.question}
          </CardTitle>
          {prompt.remediate && prompt.breakdown?.length ? (
            <div className="bg-muted/60 mt-2 rounded p-3">
              <p className="text-xs font-medium">
                Take it one piece at a time — this answer needs:
              </p>
              <ul className="text-muted-foreground mt-1 list-disc pl-5 text-xs">
                {prompt.breakdown.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {reveal ? (
            <RevealPanel reveal={reveal} onContinue={continueAfterReveal} />
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
                placeholder="Answer from memory…"
                className="min-h-24"
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void submitTyped();
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
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
    </div>
  );
}

function RevealPanel({
  reveal,
  onContinue,
}: {
  reveal: Reveal;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
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
      </div>

      {reveal.debrief ? (
        <p className="text-muted-foreground text-sm">{reveal.debrief}</p>
      ) : null}

      {reveal.grade ? (
        <div className="space-y-2 text-sm">
          {reveal.grade.metPoints.length > 0 ? (
            <div>
              <p className="text-xs font-medium">You got</p>
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {reveal.grade.metPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {reveal.grade.missedPoints.length > 0 ? (
            <div>
              <p className="text-xs font-medium">Still missing</p>
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {reveal.grade.missedPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="bg-muted/50 space-y-2 rounded p-3 text-sm">
        <p>{reveal.directAnswer}</p>
        {reveal.fullExplanation ? (
          <p className="text-muted-foreground text-xs">
            {reveal.fullExplanation}
          </p>
        ) : null}
        {reveal.sourceExcerpt ? (
          <blockquote className="text-muted-foreground border-l-2 pl-2 text-xs italic">
            {reveal.sourceExcerpt}
          </blockquote>
        ) : null}
      </div>

      <Button onClick={onContinue}>Continue</Button>
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
        {last ? null : (
          <Button onClick={() => void onNext()}>Next round</Button>
        )}
        <Button variant={last ? "default" : "outline"} onClick={() => void onFinish()}>
          Finish session
        </Button>
      </CardContent>
    </Card>
  );
}

function LearnPicker({
  topics,
  cardCount,
  onStart,
}: {
  topics: string[];
  cardCount: number;
  onStart: (filter: {
    scope: StudyScope;
    topic: string | null;
    shuffled: boolean;
    roundSize: number;
  }) => Promise<void>;
}) {
  const [scope, setScope] = useState<StudyScope>("all");
  const [topic, setTopic] = useState(topics[0] ?? "");
  const [roundSize, setRoundSize] = useState(6);
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

          <Select
            value={String(roundSize)}
            onValueChange={(value) => setRoundSize(Number(value))}
          >
            <SelectTrigger className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 6, 7, 8].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} concepts per round
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
