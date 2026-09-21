"use client";

/**
 * Writing a card by hand.
 *
 * A student's own card is not a lesser card — it goes in the same deck, is
 * scheduled by the same scheduler, and is graded against the same kind of
 * rubric. So the form asks for the same things generation produces, with
 * everything past the question and answer optional: a card worth writing in
 * ten seconds should take ten seconds.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, ImagePlus, Loader2, Plus, Star, X } from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/tutor/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { clozeQuestion } from "@/lib/cards/cloze";
import { createCardAction, createDeckAction } from "@/lib/cards/actions";

export type DeckOption = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
};

const CARD_TYPES = [
  { id: "atomic", label: "Atomic — one fact" },
  { id: "process", label: "Process — a step or a sequence" },
  { id: "integration", label: "Integration — how two things relate" },
  { id: "cloze", label: "Cloze — fill in the blank" },
] as const;

type CardType = (typeof CARD_TYPES)[number]["id"];

const NEW_DECK = "__new__";

export function CardBuilder({
  decks,
  defaultExamId,
  trigger,
}: {
  decks: DeckOption[];
  defaultExamId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="size-4" />
            New card
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          // Remounted each time it opens, so a half-written card does not come
          // back days later as a surprise.
          <BuilderForm
            decks={decks}
            defaultExamId={defaultExamId}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BuilderForm({
  decks,
  defaultExamId,
  onSaved,
}: {
  decks: DeckOption[];
  defaultExamId?: string;
  onSaved: () => void;
}) {
  const [examId, setExamId] = useState(defaultExamId ?? decks[0]?.id ?? "");
  const [newDeckTitle, setNewDeckTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [cardType, setCardType] = useState<CardType>("atomic");
  const [emphasis, setEmphasis] = useState(false);
  const [essential, setEssential] = useState("");
  const [optional, setOptional] = useState("");
  const [misconceptions, setMisconceptions] = useState("");
  const [showRubric, setShowRubric] = useState(false);
  const [preview, setPreview] = useState(false);
  const [front, setFront] = useState<Attachment | null>(null);
  const [back, setBack] = useState<Attachment | null>(null);
  const [saving, setSaving] = useState(false);

  const creatingDeck = examId === NEW_DECK;
  const cloze = cardType === "cloze";

  async function save() {
    setSaving(true);
    try {
      let targetId = examId;

      if (creatingDeck) {
        const title = newDeckTitle.trim();
        if (!title) {
          toast.error("Give the new deck a name.");
          return;
        }
        // A deck with no uploaded material behind it is a perfectly good deck.
        const created = await createDeckAction({
          courseId: decks[0]?.courseId ?? "",
          title,
        });
        if (!created) {
          toast.error("Could not create that deck.");
          return;
        }
        targetId = created.id;
      }

      const result = await createCardAction({
        examId: targetId,
        topic,
        question,
        directAnswer: answer,
        fullExplanation: explanation,
        cardType,
        professorEmphasis: emphasis,
        starred: emphasis,
        frontImagePath: front?.path ?? null,
        backImagePath: back?.path ?? null,
        essentialPoints: lines(essential),
        optionalPoints: lines(optional),
        commonMisconceptions: lines(misconceptions),
      });

      if (!result.ok) {
        for (const problem of result.problems) toast.error(problem);
        return;
      }

      toast.success("Card added");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>New card</DialogTitle>
        <DialogDescription>
          Yours, not the model&apos;s — so regenerating this deck will leave it
          alone.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="deck">Deck</Label>
            <Select value={examId} onValueChange={setExamId}>
              <SelectTrigger id="deck">
                <SelectValue placeholder="Choose a deck" />
              </SelectTrigger>
              <SelectContent>
                {decks.map((deck) => (
                  <SelectItem key={deck.id} value={deck.id}>
                    {deck.courseTitle} · {deck.title}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_DECK}>Create a new deck…</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="topic">Topic</Label>
            <Input
              id="topic"
              value={topic}
              placeholder="e.g. ADH"
              onChange={(event) => setTopic(event.target.value)}
            />
          </div>
        </div>

        {creatingDeck ? (
          <div className="space-y-1">
            <Label htmlFor="new-deck">New deck name</Label>
            <Input
              id="new-deck"
              value={newDeckTitle}
              placeholder="e.g. Things I keep forgetting"
              onChange={(event) => setNewDeckTitle(event.target.value)}
            />
          </div>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="card-type">Card type</Label>
          <Select
            value={cardType}
            onValueChange={(value) => setCardType(value as CardType)}
          >
            <SelectTrigger id="card-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CARD_TYPES.map((type) => (
                <SelectItem key={type.id} value={type.id}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="question">
              {cloze ? "Sentence, with {{the answer}} in braces" : "Question"}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPreview((current) => !current)}
            >
              <Eye className="size-3.5" />
              {preview ? "Edit" : "Preview"}
            </Button>
          </div>

          {preview ? (
            <div className="min-h-20 rounded-md border p-3">
              <Markdown>
                {cloze ? clozeQuestion(question) : question || "_Nothing yet._"}
              </Markdown>
            </div>
          ) : (
            <Textarea
              id="question"
              value={question}
              rows={3}
              placeholder={
                cloze
                  ? "ADH is released from the {{posterior pituitary}}."
                  : "What triggers ADH release?"
              }
              onChange={(event) => setQuestion(event.target.value)}
            />
          )}
          <p className="text-muted-foreground text-xs">
            Markdown works here, and $x$ for maths.
          </p>
        </div>

        <ImageField
          label="Image on the front"
          examId={creatingDeck ? decks[0]?.id : examId}
          value={front}
          onChange={setFront}
        />

        <div className="space-y-1">
          <Label htmlFor="answer">
            Answer{cloze ? " (optional — the braces already say it)" : ""}
          </Label>
          <Textarea
            id="answer"
            value={answer}
            rows={2}
            placeholder="The posterior pituitary."
            onChange={(event) => setAnswer(event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="explanation">Explanation (optional)</Label>
          <Textarea
            id="explanation"
            value={explanation}
            rows={2}
            placeholder="Why it works this way."
            onChange={(event) => setExplanation(event.target.value)}
          />
        </div>

        <ImageField
          label="Image on the back"
          examId={creatingDeck ? decks[0]?.id : examId}
          value={back}
          onChange={setBack}
        />

        <Button
          type="button"
          variant={emphasis ? "secondary" : "outline"}
          size="sm"
          onClick={() => setEmphasis((current) => !current)}
        >
          <Star className={emphasis ? "size-4 fill-current" : "size-4"} />
          {emphasis ? "Professor emphasised" : "Mark professor emphasis"}
        </Button>

        <div className="space-y-2 rounded-md border p-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setShowRubric((current) => !current)}
          >
            {showRubric ? "Hide rubric" : "Add a rubric (optional)"}
          </Button>

          {showRubric ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">
                One per line. Without a rubric, the answer itself is the
                standard a typed answer is checked against.
              </p>
              <RubricField
                id="essential"
                label="Must include"
                value={essential}
                onChange={setEssential}
              />
              <RubricField
                id="optional"
                label="Worth credit, not required"
                value={optional}
                onChange={setOptional}
              />
              <RubricField
                id="misconceptions"
                label="Common wrong answers"
                value={misconceptions}
                onChange={setMisconceptions}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving || !question.trim()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          Add card
        </Button>
      </div>
    </>
  );
}

type Attachment = { path: string; preview: string };

function ImageField({
  label,
  examId,
  value,
  onChange,
}: {
  label: string;
  examId?: string;
  value: Attachment | null;
  onChange: (value: Attachment | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!examId) {
      toast.error("Choose a deck first, so the image has somewhere to live.");
      return;
    }

    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/exams/${examId}/card-image`, {
        method: "POST",
        body,
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "That image could not be attached.");
        return;
      }

      onChange({ path: payload.path, preview: URL.createObjectURL(file) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {value ? (
        <div className="relative w-fit">
          {/* A local object URL for something just chosen, not a remote asset. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="" className="h-20 rounded border" />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => onChange(null)}
            className="bg-background absolute -top-2 -right-2 rounded-full border p-0.5"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : (
        <label className="inline-flex">
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <span className="hover:bg-muted/60 inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
            Attach
          </span>
        </label>
      )}
    </div>
  );
}

function RubricField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
