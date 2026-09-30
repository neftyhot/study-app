"use client";

/** A small working sample of a flashcard format, to try before choosing it. */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  FLASHCARD_FORMAT_LABELS,
  type FlashcardFormat,
} from "@/lib/settings-shared";
import { FlipCard, SwipeCard } from "@/components/study/card-formats";

const SAMPLE = {
  question:
    "A firm has fixed costs of $5,000, sells each unit for $45 and spends $25 making it. How many units does it need to sell to break even?",
  answer: "250 units",
  working: "$5,000 ÷ ($45 − $25) = 250",
};

export function FlashcardFormatPreview({ format }: { format: FlashcardFormat }) {
  const [revealed, setRevealed] = useState(false);
  const [round, setRound] = useState(0);
  const [swiped, setSwiped] = useState<string | null>(null);

  const answer = (
    <div className="space-y-1 text-left text-sm">
      <p className="font-medium">{SAMPLE.answer}</p>
      <p className="text-muted-foreground font-mono text-xs">{SAMPLE.working}</p>
    </div>
  );

  return (
    <div className="bg-muted/30 space-y-2 rounded-lg border border-dashed p-3">
      <p className="text-muted-foreground text-xs">
        Preview: {FLASHCARD_FORMAT_LABELS[format].blurb} Try it.
      </p>

      {format === "flip" ? (
        <FlipCard
          cardKey="sample"
          revealed={revealed}
          onToggle={() => setRevealed((value) => !value)}
          faceClassName="min-h-40 p-4"
          front={
            <>
              <p className="text-sm">{SAMPLE.question}</p>
              <p className="text-muted-foreground text-xs">Click to flip</p>
            </>
          }
          back={answer}
        />
      ) : format === "stack" ? (
        <SwipeCard
          cardKey={`sample-${round}`}
          revealed={revealed}
          behind={2}
          onReveal={() => setRevealed(true)}
          onSwipe={(direction) => {
            setSwiped(direction === "right" ? "Marked easy" : "Marked missed");
            setRevealed(false);
            setRound((value) => value + 1);
          }}
          className="px-1"
        >
          <p className="text-sm">{SAMPLE.question}</p>
          {revealed ? (
            <>
              {answer}
              <p className="text-muted-foreground text-xs">
                Drag right if you knew it, left if you missed it.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Tap to see the answer</p>
          )}
        </SwipeCard>
      ) : (
        <div className="bg-card space-y-3 rounded-xl border p-4">
          <p className="text-sm">{SAMPLE.question}</p>
          {revealed ? (
            answer
          ) : (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => setRevealed(true)}>
              Show answer
            </Button>
          )}
        </div>
      )}

      {swiped ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          {swiped}. Here is the next card.
        </p>
      ) : null}
    </div>
  );
}
