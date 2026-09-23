"use client";

/**
 * Typing a deck in, card after card.
 *
 * The shape is Quizlet's, because it is the fastest one there is for this: a
 * numbered list of front/back pairs, "Add card" at the bottom, and Tab out of
 * the last back to start the next card without touching the mouse. Simple
 * mode is just that. Detailed adds a topic, an explanation, images and an
 * "important" star to each card, for the ones that need them.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ImageField, type Attachment } from "@/components/cards/card-builder";
import { DetailToggle, useDetailMode } from "@/components/cards/detail-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  createCardSetAction,
  createDeckAction,
  type SetCardInput,
} from "@/lib/cards/actions";
import { createCourseAction } from "@/lib/manage/actions";

type Row = {
  key: number;
  front: string;
  back: string;
  topic: string;
  explanation: string;
  important: boolean;
  frontImage: Attachment | null;
  backImage: Attachment | null;
};

const NEW_SUBJECT = "__new_subject__";
const STARTING_ROWS = 3;

let nextKey = 0;
function blankRow(): Row {
  nextKey += 1;
  return {
    key: nextKey,
    front: "",
    back: "",
    topic: "",
    explanation: "",
    important: false,
    frontImage: null,
    backImage: null,
  };
}

function filled(row: Row) {
  return row.front.trim() !== "" || row.back.trim() !== "";
}

export function CardSetEditor(
  props:
    | {
        /** Adding to a deck that exists. */
        examId: string;
        deckTitle: string;
      }
    | {
        /** Making a new deck; the subjects it can go in. */
        courses: { id: string; title: string }[];
        defaultCourseId?: string;
      },
) {
  const router = useRouter();
  const existing = "examId" in props;

  const [mode, setMode] = useDetailMode();
  const detailed = mode === "detailed";

  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: STARTING_ROWS }, blankRow),
  );
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState(
    existing
      ? ""
      : (props.defaultCourseId ?? props.courses[0]?.id ?? NEW_SUBJECT),
  );
  const [newSubject, setNewSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState<Set<number>>(new Set());

  // Created on first need — the first image attached, or the save — and then
  // reused, so attaching an image and saving never make two decks.
  const deckId = useRef<string | null>(existing ? props.examId : null);
  const focusKey = useRef<number | null>(null);
  const saved = useRef(false);

  const count = rows.filter(filled).length;

  // Typing in forty cards and closing the window by accident should ask first.
  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!saved.current && rows.some(filled)) event.preventDefault();
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [rows]);

  useEffect(() => {
    if (focusKey.current === null) return;
    document.getElementById(`front-${focusKey.current}`)?.focus();
    focusKey.current = null;
  }, [rows]);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
    if (invalid.has(key)) {
      setInvalid((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function addRow() {
    const row = blankRow();
    focusKey.current = row.key;
    setRows((current) => [...current, row]);
  }

  function removeRow(key: number) {
    setRows((current) =>
      current.length === 1 ? [blankRow()] : current.filter((row) => row.key !== key),
    );
  }

  async function ensureDeck(): Promise<string | undefined> {
    if (deckId.current) return deckId.current;
    if (existing) return props.examId;

    const name = title.trim();
    if (!name) {
      toast.error("Give the deck a name first.");
      document.getElementById("set-title")?.focus();
      return undefined;
    }

    let subject = courseId;
    if (subject === NEW_SUBJECT) {
      if (!newSubject.trim()) {
        toast.error("Name the new subject, or pick one.");
        return undefined;
      }
      const course = await createCourseAction({ title: newSubject });
      subject = course.id;
      setCourseId(course.id);
    }

    const deck = await createDeckAction({ courseId: subject, title: name });
    if (!deck) {
      toast.error("Could not create that deck.");
      return undefined;
    }
    deckId.current = deck.id;
    return deck.id;
  }

  async function save() {
    const half = rows.filter(
      (row) => filled(row) && (!row.front.trim() || !row.back.trim()),
    );
    if (half.length > 0) {
      setInvalid(new Set(half.map((row) => row.key)));
      toast.error(
        half.length === 1
          ? "One card is missing a side."
          : `${half.length} cards are missing a side.`,
      );
      document.getElementById(`front-${half[0].key}`)?.scrollIntoView({ block: "center" });
      return;
    }
    if (count === 0) {
      toast.error("Add at least one card.");
      return;
    }

    setSaving(true);
    try {
      const target = await ensureDeck();
      if (!target) return;

      const toSave = rows.filter(filled);
      const cards: SetCardInput[] = toSave.map((row) =>
        detailed
          ? {
              question: row.front,
              directAnswer: row.back,
              topic: row.topic,
              fullExplanation: row.explanation,
              professorEmphasis: row.important,
              starred: row.important,
              frontImagePath: row.frontImage?.path ?? null,
              backImagePath: row.backImage?.path ?? null,
            }
          : { question: row.front, directAnswer: row.back },
      );

      const result = await createCardSetAction(target, cards);
      if (!result.ok) {
        setInvalid(new Set(result.problems.map((problem) => toSave[problem.index]?.key)));
        for (const problem of result.problems.slice(0, 3)) {
          toast.error(`Card ${problem.index + 1}: ${problem.problems.join(" ")}`);
        }
        return;
      }

      saved.current = true;
      toast.success(
        `${existing ? "Added" : "Created the deck with"} ${result.created} card${result.created === 1 ? "" : "s"}`,
      );
      router.push(`/exams/${target}/cards`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 pb-16">
      <div className="bg-background/90 sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {existing ? `Add cards to ${props.deckTitle}` : "Create a deck"}
          </h1>
          <p className="text-muted-foreground text-sm tabular-nums">
            {count} card{count === 1 ? "" : "s"} ·{" "}
            <kbd className="font-sans">Tab</kbd> from the last back adds another
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DetailToggle value={mode} onChange={setMode} />
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {existing ? "Add cards" : "Create"}
          </Button>
        </div>
      </div>

      {existing ? null : (
        <div className="space-y-3">
          <Input
            id="set-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder='Name, e.g. "Cranial nerves"'
            aria-label="Deck name"
            className="h-12 text-lg"
            autoFocus
          />
          <div className="flex flex-wrap gap-3">
            <Select value={courseId} onValueChange={setCourseId}>
              <SelectTrigger className="w-64" aria-label="Subject">
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                {props.courses.map((course) => (
                  <SelectItem key={course.id} value={course.id}>
                    {course.title}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_SUBJECT}>New subject…</SelectItem>
              </SelectContent>
            </Select>
            {courseId === NEW_SUBJECT ? (
              <Input
                value={newSubject}
                onChange={(event) => setNewSubject(event.target.value)}
                placeholder="Subject name"
                aria-label="New subject name"
                className="w-64"
              />
            ) : null}
          </div>
        </div>
      )}

      <ol className="space-y-4">
        {rows.map((row, index) => (
          <li key={row.key}>
            <Card
              className={
                invalid.has(row.key) ? "ring-destructive ring-2" : undefined
              }
            >
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm font-medium tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    {detailed ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-pressed={row.important}
                        aria-label={row.important ? "Unmark important" : "Mark important"}
                        onClick={() => update(row.key, { important: !row.important })}
                      >
                        <Star
                          className={row.important ? "fill-current text-amber-500" : ""}
                        />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete card ${index + 1}`}
                      onClick={() => removeRow(row.key)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Side
                    id={`front-${row.key}`}
                    label="Front"
                    value={row.front}
                    placeholder="Term or question"
                    onChange={(front) => update(row.key, { front })}
                  />
                  <Side
                    id={`back-${row.key}`}
                    label="Back"
                    value={row.back}
                    placeholder="Definition or answer"
                    onChange={(back) => update(row.key, { back })}
                    onTabOut={
                      index === rows.length - 1 ? () => addRow() : undefined
                    }
                  />
                </div>

                {detailed ? (
                  <div className="grid gap-4 border-t pt-3 sm:grid-cols-2">
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor={`topic-${row.key}`} className="text-xs">
                          Topic
                        </Label>
                        <Input
                          id={`topic-${row.key}`}
                          value={row.topic}
                          placeholder="e.g. Cranial nerves"
                          onChange={(event) =>
                            update(row.key, { topic: event.target.value })
                          }
                        />
                      </div>
                      <ImageField
                        label="Image on the front"
                        resolveExamId={ensureDeck}
                        value={row.frontImage}
                        onChange={(frontImage) => update(row.key, { frontImage })}
                      />
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor={`explain-${row.key}`} className="text-xs">
                          Explanation (optional)
                        </Label>
                        <Textarea
                          id={`explain-${row.key}`}
                          value={row.explanation}
                          rows={2}
                          onChange={(event) =>
                            update(row.key, { explanation: event.target.value })
                          }
                        />
                      </div>
                      <ImageField
                        label="Image on the back"
                        resolveExamId={ensureDeck}
                        value={row.backImage}
                        onChange={(backImage) => update(row.key, { backImage })}
                      />
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={addRow}
        className="text-muted-foreground hover:text-foreground hover:border-primary flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 text-sm font-medium transition-colors"
      >
        <Plus className="size-4" />
        Add card
      </button>

      <div className="flex justify-end">
        <Button size="lg" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {existing ? "Add cards" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function Side({
  id,
  label,
  value,
  placeholder,
  onChange,
  onTabOut,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  /** Tab from here makes a new card — only on the last card's back. */
  onTabOut?: () => void;
}) {
  return (
    <div className="space-y-1">
      <Textarea
        id={id}
        value={value}
        rows={2}
        placeholder={placeholder}
        className="min-h-12 resize-y"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (onTabOut && event.key === "Tab" && !event.shiftKey) {
            event.preventDefault();
            onTabOut();
          }
        }}
      />
      <Label
        htmlFor={id}
        className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
      >
        {label}
      </Label>
    </div>
  );
}
