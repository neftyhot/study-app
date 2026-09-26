"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { FileUp, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  QUICK_ACCEPT,
  deckNameFrom,
  guessRole,
  isAccepted,
  type QuickRole as Role,
} from "@/lib/ingest/quick-start";
import { createCourseAction, createExamAction } from "@/lib/manage/actions";
import { cn } from "@/lib/utils";

const NEW_SUBJECT = "__new__";

type Picked = { file: File; role: Role };

/**
 * The home screen's one big action: drop slides, press Generate Study Set.
 *
 * Makes the subject and deck, uploads each file under its role, starts card
 * generation, and lands on the deck — the same steps a student could take by
 * hand, done in order.
 */
export function QuickStart({
  courses,
}: {
  courses: { id: string; title: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? NEW_SUBJECT);
  const [subjectName, setSubjectName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function add(files: FileList | null) {
    if (!files) return;
    const all = Array.from(files);
    const usable = all.filter((file) => isAccepted(file.name));
    if (usable.length < all.length) {
      toast.error("Only PDF, PowerPoint (.pptx) and Word (.docx) files can go here.");
    }
    if (usable.length === 0) return;
    setPicked((previous) => [
      ...previous,
      ...usable
        .filter((file) => !previous.some((p) => p.file.name === file.name))
        .map((file) => ({ file, role: guessRole(file.name) })),
    ]);
    if (!deckName) {
      const firstSlides = usable.find((file) => guessRole(file.name) === "slides");
      setDeckName(deckNameFrom((firstSlides ?? usable[0]).name));
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) add(event.dataTransfer.files);
  }

  async function uploadRole(examId: string, role: Role) {
    const files = picked.filter((p) => p.role === role);
    if (files.length === 0) return 0;
    const body = new FormData();
    body.set("role", role);
    for (const { file } of files) body.append("files", file);
    const response = await fetch(`/api/exams/${examId}/files`, {
      method: "POST",
      body,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Upload failed");
    return (payload.results as { status: string }[]).filter(
      (r) => r.status === "ready" || r.status === "unchanged",
    ).length;
  }

  async function generate() {
    const title = deckName.trim() || "My study set";
    const newSubject = courseId === NEW_SUBJECT;
    if (newSubject && !subjectName.trim()) {
      toast.error("Give the subject a name, like “Biology 101”.");
      return;
    }

    let examId: string | null = null;
    try {
      setBusy("Setting up your deck…");
      const course = newSubject
        ? await createCourseAction({ title: subjectName.trim() })
        : { id: courseId };
      const exam = await createExamAction({ courseId: course.id, title });
      examId = exam.id;

      setBusy("Reading your files…");
      const ready =
        (await uploadRole(exam.id, "slides")) +
        (await uploadRole(exam.id, "study_guide"));
      if (ready === 0) {
        toast.error("We couldn't read any of those files. Try another copy.");
        router.push(`/exams/${exam.id}/sources`);
        return;
      }

      setBusy("Starting your flashcards…");
      const response = await fetch(`/api/exams/${exam.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "append" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        toast.error(
          payload.error ??
            "Your files are in, but the flashcards couldn't start. Try again from the deck.",
        );
      } else {
        toast.success("Making your study set. It keeps going if you look around.");
      }
      router.push(`/exams/${exam.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
      if (examId) router.push(`/exams/${examId}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Make a new study set</CardTitle>
        <CardDescription>
          Drop in your lecture slides (and your study guide, if you have one).
          We&apos;ll turn them into a study guide, flashcards and a practice exam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Add PDF or PowerPoint files"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
            "hover:border-primary focus-visible:border-primary focus-visible:outline-none",
            dragging && "border-primary bg-accent",
          )}
        >
          <FileUp className="text-primary size-8" />
          <p className="font-medium">Drag your PDF or PowerPoint files here</p>
          <p className="text-muted-foreground text-sm">or click to choose them</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={QUICK_ACCEPT}
            className="hidden"
            onChange={(event) => add(event.target.files)}
          />
        </div>

        {picked.length > 0 ? (
          <ul className="space-y-2">
            {picked.map((item, index) => (
              <li
                key={item.file.name}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                <Select
                  value={item.role}
                  onValueChange={(role) =>
                    setPicked((previous) =>
                      previous.map((p, i) =>
                        i === index ? { ...p, role: role as Role } : p,
                      ),
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-36" aria-label="What is this file?">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slides">Lecture slides</SelectItem>
                    <SelectItem value="study_guide">Study guide</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() =>
                    setPicked((previous) => previous.filter((_, i) => i !== index))
                  }
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {picked.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quick-deck">Name</Label>
              <Input
                id="quick-deck"
                value={deckName}
                onChange={(event) => setDeckName(event.target.value)}
                placeholder="Midterm 1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quick-subject">Subject</Label>
              {courses.length > 0 ? (
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger id="quick-subject" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.title}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_SUBJECT}>New subject…</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {courseId === NEW_SUBJECT ? (
                <Input
                  id={courses.length > 0 ? undefined : "quick-subject"}
                  value={subjectName}
                  onChange={(event) => setSubjectName(event.target.value)}
                  placeholder="Biology 101"
                  aria-label="New subject name"
                />
              ) : null}
            </div>
          </div>
        ) : null}

        <Button
          size="lg"
          className="w-full text-base"
          disabled={picked.length === 0 || busy !== null}
          onClick={() => void generate()}
        >
          {busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Sparkles className="size-5" />
          )}
          {busy ?? "Generate Study Set"}
        </Button>
      </CardContent>
    </Card>
  );
}
