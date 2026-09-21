"use client";

/**
 * The step before a conversation becomes cards.
 *
 * Nothing the tutor produces is saved until it has been read. Each draft is
 * editable and can be dropped, and a card whose answer came from the model
 * rather than from the lecture material says so — a deck whose provenance is
 * unclear is worse than a smaller one.
 */
import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ExtractedCard } from "@/lib/tutor/schemas";
import { saveTutorCardsAction } from "@/lib/tutor/actions";

export function CardConfirm({
  examId,
  slideId,
  cards,
  onClose,
}: {
  examId: string;
  slideId?: string | null;
  /** Null while there is nothing to confirm. */
  cards: ExtractedCard[] | null;
  onClose: (saved: boolean) => void;
}) {
  return (
    <Dialog
      open={cards !== null}
      onOpenChange={(open) => {
        if (!open) onClose(false);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {cards ? (
          // Remounted per extraction: the drafts are editable, and carrying
          // one batch's edits into the next would put words in the student's
          // mouth.
          <ConfirmBody
            examId={examId}
            slideId={slideId}
            cards={cards}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  examId,
  slideId,
  cards,
  onClose,
}: {
  examId: string;
  slideId?: string | null;
  cards: ExtractedCard[];
  onClose: (saved: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<ExtractedCard[]>(cards);
  const [saving, setSaving] = useState(false);

  function update(index: number, patch: Partial<ExtractedCard>) {
    setDrafts((current) =>
      current.map((card, i) => (i === index ? { ...card, ...patch } : card)),
    );
  }

  async function save() {
    setSaving(true);
    try {
      const count = await saveTutorCardsAction({
        examId,
        sourceSlideId: slideId ?? null,
        cards: drafts,
      });
      toast.success(`Added ${count} card${count === 1 ? "" : "s"} to this deck`);
      onClose(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
        <DialogHeader>
          <DialogTitle>
            {drafts.length} card{drafts.length === 1 ? "" : "s"} from this
            conversation
          </DialogTitle>
          <DialogDescription>
            These are not quoted from your slides the way generated cards are.
            Read them before they join the deck.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {drafts.map((card, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={card.fromMaterial ? "secondary" : "outline"}>
                  {card.fromMaterial
                    ? "From your material"
                    : "From the tutor's own knowledge"}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Drop this card"
                  onClick={() =>
                    setDrafts((current) => current.filter((_, index) => index !== i))
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="space-y-1">
                <Label htmlFor={`topic-${i}`} className="text-xs">
                  Topic
                </Label>
                <Input
                  id={`topic-${i}`}
                  value={card.topic}
                  onChange={(event) => update(i, { topic: event.target.value })}
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`question-${i}`} className="text-xs">
                  Question
                </Label>
                <Textarea
                  id={`question-${i}`}
                  value={card.question}
                  rows={2}
                  onChange={(event) => update(i, { question: event.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor={`answer-${i}`} className="text-xs">
                  Answer
                </Label>
                <Textarea
                  id={`answer-${i}`}
                  value={card.directAnswer}
                  rows={2}
                  onChange={(event) =>
                    update(i, { directAnswer: event.target.value })
                  }
                />
              </div>

              {card.essentialPoints.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Must say: {card.essentialPoints.join("; ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => void save()}
            disabled={saving || drafts.length === 0}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Add {drafts.length} card{drafts.length === 1 ? "" : "s"}
          </Button>
          <Button variant="ghost" onClick={() => onClose(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
    </>
  );
}
