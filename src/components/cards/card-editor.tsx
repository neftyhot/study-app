"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveCardEdit, undoCardEditAction } from "@/lib/study/actions";

/** How long the student has to stop typing before the card is saved. */
const AUTOSAVE_DELAY_MS = 1200;

export type EditedCard = {
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
};

type Status = "idle" | "dirty" | "saving" | "saved";

/**
 * The card editor used everywhere a card can be edited.
 *
 * It saves on its own once typing stops, so there is no state in which the
 * student's work exists only on screen. Undo is the safeguard that makes that
 * safe: every burst of typing is one restorable point, so autosave cannot
 * quietly cost them a card.
 */
export function CardEditor({
  cardId,
  card,
  canUndo,
  onSaved,
  onClose,
}: {
  cardId: string;
  card: EditedCard;
  canUndo?: boolean;
  onSaved: (card: EditedCard) => void;
  onClose?: () => void;
}) {
  const [question, setQuestion] = useState(card.question);
  const [directAnswer, setDirectAnswer] = useState(card.directAnswer);
  const [fullExplanation, setFullExplanation] = useState(
    card.fullExplanation ?? "",
  );
  const [status, setStatus] = useState<Status>("idle");
  const [undoAvailable, setUndoAvailable] = useState(canUndo ?? false);

  const valid = question.trim().length > 0 && directAnswer.trim().length > 0;

  async function save() {
    // Closes over this render's values; the autosave effect re-runs whenever
    // they change, so the timer that fires always carries the latest text.
    const fields = { question, directAnswer, fullExplanation };
    setStatus("saving");

    try {
      const result = await saveCardEdit(cardId, fields);
      if (result?.undoAvailable) setUndoAvailable(true);
      setStatus("saved");
      onSaved({
        question: fields.question.trim(),
        directAnswer: fields.directAnswer.trim(),
        fullExplanation: fields.fullExplanation.trim() || null,
      });
    } catch (error) {
      setStatus("dirty");
      toast.error(error instanceof Error ? error.message : "Could not save");
    }
  }

  // Autosave once typing stops. Saving on every keystroke would be a write per
  // character; saving only on close would lose work if the tab went away.
  useEffect(() => {
    if (status !== "dirty" || !valid) return;

    const timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, directAnswer, fullExplanation, status, valid]);

  function change(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      setter(event.target.value);
      setStatus("dirty");
    };
  }

  async function undo() {
    const result = await undoCardEditAction(cardId);
    if (!result) {
      toast.error("Nothing left to undo");
      setUndoAvailable(false);
      return;
    }

    setQuestion(result.question);
    setDirectAnswer(result.directAnswer);
    setFullExplanation(result.fullExplanation ?? "");
    setUndoAvailable(result.undoAvailable);
    setStatus("idle");
    onSaved({
      question: result.question,
      directAnswer: result.directAnswer,
      fullExplanation: result.fullExplanation,
    });
    toast.success("Reverted to the previous version");
  }

  return (
    <div className="space-y-3">
      <Field
        id={`question-${cardId}`}
        label="Question"
        value={question}
        onChange={change(setQuestion)}
      />
      <Field
        id={`answer-${cardId}`}
        label="Answer"
        value={directAnswer}
        onChange={change(setDirectAnswer)}
      />
      <Field
        id={`detail-${cardId}`}
        label="Detail (optional)"
        value={fullExplanation}
        onChange={change(setFullExplanation)}
      />

      <div className="flex flex-wrap items-center gap-2">
        {onClose ? (
          <Button
            size="sm"
            disabled={!valid}
            onClick={async () => {
              if (status === "dirty") await save();
              onClose();
            }}
          >
            Done
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => void undo()}
          disabled={!undoAvailable}
        >
          <Undo2 className="size-3.5" />
          Undo edit
        </Button>

        <span className="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
          {!valid ? (
            "A question and an answer are required"
          ) : status === "saving" ? (
            <>
              <Loader2 className="size-3 animate-spin" />
              Saving…
            </>
          ) : status === "saved" ? (
            <>
              <Check className="size-3" />
              Saved
            </>
          ) : status === "dirty" ? (
            "Unsaved changes"
          ) : (
            "Saves as you type"
          )}
        </span>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        onChange={onChange}
        className="min-h-16 text-sm"
      />
    </div>
  );
}
